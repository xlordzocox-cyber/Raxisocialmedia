// B2 PREPARATION ONLY. Import is inert. No DDL, deployment, users or provider calls.
import { stagingTarget } from './staging-target.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export function runtimeStagingGate(env,args) {
 if(!args.includes('--run')||env.RAXI_STAGING_RUNTIME_ACK!=='RUN_SUPERVISED_SIMULATION_B2')throw Error('B2 human approval required');
 const target=stagingTarget(env);
 if(!/^[a-f0-9]{64}$/.test(env.RAXI_STAGING_APPROVAL_SHA256??'')||!env.RAXI_STAGING_APPROVAL_FILE)throw Error('Bound approval manifest required');
 return target;
}
export function verifyStagingEvidence(target,manifest,project) {
 // These fields are compared with an authenticated Management API response, not
 // accepted as a label/env assertion. No production clone is authorized by this runner.
 if(manifest.kind!=='SUPERVISED_B2_SIMULATION'||manifest.projectRef!==target.ref||project.id!==target.ref||
  project.status!=='ACTIVE_HEALTHY'||!manifest.organizationId||project.organization_id!==manifest.organizationId||
  !manifest.createdAt||project.created_at!==manifest.createdAt||!Number.isFinite(Date.parse(manifest.expiresAt))||
  Date.parse(manifest.expiresAt)<=Date.now()||manifest.providers!=='SIMULATED_ONLY'||manifest.productionClone!==false||
  manifest.baseCommit!=='55eecc4ef7a6e6eb748c61ea1c1e2b30c4657247')throw Error('Staging evidence not confirmed');
}
export async function runStagingRuntime(env,args) {
 const target=runtimeStagingGate(env,args); // BEFORE files, credentials, builds or network.
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const approval=await readFile(env.RAXI_STAGING_APPROVAL_FILE);
 if(createHash('sha256').update(approval).digest('hex')!==env.RAXI_STAGING_APPROVAL_SHA256)throw Error('Approval digest mismatch');
 const manifest=JSON.parse(approval);
 if(manifest.kind!=='SUPERVISED_B2_SIMULATION'||manifest.providers!=='SIMULATED_ONLY'||manifest.productionClone!==false||
  manifest.projectRef!==target.ref||!Number.isFinite(Date.parse(manifest.expiresAt))||Date.parse(manifest.expiresAt)<=Date.now())throw Error('Approval expired or incompatible');
 if(!env.RAXI_STAGING_MANAGEMENT_TOKEN)throw Error('Read-only project management authorization required');
 const response=await fetch(`https://api.supabase.com/v1/projects/${target.ref}`,{headers:{Authorization:`Bearer ${env.RAXI_STAGING_MANAGEMENT_TOKEN}`},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Project metadata unavailable');
 verifyStagingEvidence(target,manifest,await response.json());
 const required=name=>{if(!env[name])throw Error('Missing B2 configuration');return env[name];};
 const {createClient}=await import('@supabase/supabase-js');
 const {Client}=await import('pg');const assert=(await import('node:assert/strict')).default;
 const db=[0,1].map(()=>new Client({connectionString:target.database,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,query_timeout:10000}));
 try {
  await Promise.all(db.map(c=>c.connect()));
  const pids=await Promise.all(db.map(c=>c.query('select pg_backend_pid() id')));assert.notEqual(pids[0].rows[0].id,pids[1].rows[0].id);
  const inventory=await db[0].query("select version from supabase_migrations.schema_migrations order by version");
  assert.deepEqual(inventory.rows.map(r=>r.version),manifest.migrations,'Schema manifest must match actual migration history');
  const data=await db[0].query('select (select count(*)::integer from auth.users) users,(select count(*)::integer from public.raxi_ideas) ideas,(select count(*)::integer from public.raxi_campaigns) campaigns');
  assert.deepEqual(data.rows[0],{users:2,ideas:0,campaigns:0},'Dedicated two-account test project required; no production data clone');
  const functions=await db[0].query("select count(*)::integer n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('raxi_supervised_host_command','raxi_supervised_host_identity') and not p.prosecdef");assert.equal(functions.rows[0].n,2);
  const {build}=await import('esbuild');
  const root=fileURLToPath(new URL('../../..',import.meta.url));
  const out=resolve(root,'apps/raxi-hq/.validation/b2');
  await build({entryPoints:[resolve(root,'server/agent-runtime/supabaseSupervisedAuth.ts'),resolve(root,'server/agent-runtime/supervisedHostHandler.ts')],outdir:out,outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm'});
  const {pathToFileURL}=await import('node:url');
  const {supabaseSupervisedAuth}=await import(pathToFileURL(resolve(out,'supabaseSupervisedAuth.mjs')).href);
  const {createSupabaseSupervisedHost}=await import(pathToFileURL(resolve(out,'supervisedHostHandler.mjs')).href);
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  const user=createClient(target.api,required('RAXI_STAGING_PUBLISHABLE_KEY'),options);
  const other=createClient(target.api,required('RAXI_STAGING_PUBLISHABLE_KEY'),options);
  const writer=createClient(target.api,required('RAXI_STAGING_SERVER_KEY'),options);
  const a=await user.auth.signInWithPassword({email:required('RAXI_STAGING_EMAIL_A'),password:required('RAXI_STAGING_PASSWORD_A')});
  const b=await other.auth.signInWithPassword({email:required('RAXI_STAGING_EMAIL_B'),password:required('RAXI_STAGING_PASSWORD_B')});
  assert.ok(!a.error&&!b.error&&a.data.session&&b.data.session);assert.notEqual(a.data.user.id,b.data.user.id);
  const identify=supabaseSupervisedAuth({projectRef:target.ref,auth:user.auth,server:writer});
  const workspace=required('RAXI_STAGING_WORKSPACE_A');
  await identify(a.data.session.access_token,workspace);
  await assert.rejects(identify(b.data.session.access_token,workspace));
  const host=createSupabaseSupervisedHost({identify,server:writer,liveEnabled:false});
  const call=async body=>{const r=await host(new Request('https://in-process.test',{method:'POST',headers:{Authorization:`Bearer ${a.data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal(r.status,200);return r.json();};
  const prepared=await call({action:'prepare',workspaceId:workspace,key:crypto.randomUUID(),stage:'DIRECTOR',spec:{question:'B2 approved simulation only',externalResearch:false,provider:'simulated',model:required('RAXI_STAGING_SIMULATED_MODEL'),authorization:{confirmed:true,maxCostMicros:10,expiresAt:new Date(Date.now()+300000).toISOString()}}});
  const task=prepared.task,scopeDigest=task.input_snapshot.supervised.scopeDigest;
  await call({action:'approve',workspaceId:workspace,taskId:task.id,key:crypto.randomUUID(),scopeDigest,confirmed:true});
  const command={action:'execute',workspaceId:workspace,taskId:task.id,key:crypto.randomUUID(),confirmed:true};
  const done=await call(command);assert.equal(done.task.status,'COMPLETED');assert.equal(done.execution,'SIMULATED');await call(command);
  await user.auth.signOut({scope:'local'});await assert.rejects(identify(a.data.session.access_token,workspace));
  console.log(JSON.stringify({kind:'B2_PARTIAL_ACCEPTANCE',host:'IN_PROCESS',providers:'SIMULATED_ONLY',physicalConnections:2,ddl:false,deployment:false,fullB2MatrixComplete:false}));
 }finally {await Promise.allSettled(db.map(c=>c.end()));}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 runStagingRuntime(process.env,process.argv.slice(2)).catch(()=>{console.error('B2 not authorized or acceptance not confirmed; sensitive details suppressed');process.exitCode=1;});
}
