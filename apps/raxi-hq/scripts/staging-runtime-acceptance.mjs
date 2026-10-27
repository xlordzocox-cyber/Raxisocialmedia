// B2 PREPARATION ONLY. Import is inert. No DDL, deployment, users or provider calls.
import { stagingTarget } from './staging-target.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {assertPinnedTarget,verifyObservedProject,loadPreparationManifest,verifyExecutionApproval,inspectRaxiSchema,verifyObservedSchema} from './staging-manifest.mjs';
export function runtimeStagingGate(env,args) {
 if(!args.includes('--run')||env.RAXI_STAGING_RUNTIME_ACK!=='RUN_SUPERVISED_SIMULATION_B2')throw Error('B2 human approval required');
 const target=stagingTarget(env);
 assertPinnedTarget(target);
 if(!/^[a-f0-9]{64}$/.test(env.RAXI_STAGING_APPROVAL_SHA256??'')||!env.RAXI_STAGING_APPROVAL_FILE)throw Error('Bound approval manifest required');
 return target;
}
export function verifyStagingEvidence(target,manifest,project) {
 // These fields are compared with an authenticated Management API response, not
 // accepted as a label/env assertion. No production clone is authorized by this runner.
 assertPinnedTarget(target);verifyObservedProject(project);
 if(manifest.kind!=='SUPERVISED_B2_SIMULATION'||manifest.projectRef!==target.ref||project.id!==target.ref||
  project.status!=='ACTIVE_HEALTHY'||!manifest.organizationId||project.organization_id!==manifest.organizationId||
  !manifest.createdAt||project.created_at!==manifest.createdAt||!Number.isFinite(Date.parse(manifest.expiresAt))||
  Date.parse(manifest.expiresAt)<=Date.now()||manifest.providers!=='SIMULATED_ONLY'||manifest.productionClone!==false||
  manifest.baseCommit!=='b56b26567bc97078fa58ef16385b851d890d6408')throw Error('Staging evidence not confirmed');
}
export async function runStagingRuntime(env,args) {
 const target=runtimeStagingGate(env,args); // BEFORE files, credentials, builds or network.
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const approval=await readFile(env.RAXI_STAGING_APPROVAL_FILE);
 if(createHash('sha256').update(approval).digest('hex')!==env.RAXI_STAGING_APPROVAL_SHA256)throw Error('Approval digest mismatch');
 const manifest=JSON.parse(approval);
 const preparation=await loadPreparationManifest();
 verifyExecutionApproval(preparation,manifest); // Current manifest blocks here, BEFORE any hosted access.
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
  const schema=await inspectRaxiSchema(db[0]);
  verifyObservedSchema(preparation,'READY',{postgresMajor:schema.postgresMajor,migrations:inventory.rows.map(r=>r.version),schema});
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
  const revocation=await verifyHostedSessionRevocation({auth:user.auth,server:writer,sql:db[0],token:a.data.session.access_token,workspaceId:workspace,
   createIdentify:server=>supabaseSupervisedAuth({projectRef:target.ref,auth:user.auth,server})});
  console.log(JSON.stringify({kind:'B2_PARTIAL_ACCEPTANCE',host:'IN_PROCESS',providers:'SIMULATED_ONLY',physicalConnections:2,revocation,ddl:false,deployment:false,fullB2MatrixComplete:false}));
 }finally {await Promise.allSettled(db.map(c=>c.end()));}
}
/** Acceptance evidence only, NOT an authorization mechanism. All ports are trusted
 * server infrastructure. No JWT, session UUID, user data or raw error is returned/logged.
 * SQL is the already-authorized B2 connection, never a new connection or DDL.
 */
export async function verifyHostedSessionRevocation({auth,server,sql,token,workspaceId,createIdentify}) {
 const assert=(await import('node:assert/strict')).default;
 const before=await createIdentify(server)(token,workspaceId);
 const expires=Date.parse(before.expiresAt);
 const live=()=>assert.ok(Number.isFinite(expires)&&expires>Date.now(),'JWT must remain unexpired throughout revocation evidence');
 live();
 const sessionState=async()=>{
  const r=await sql.query(`select exists(select 1 from auth.sessions where id=$1::uuid) as present,
   exists(select 1 from auth.sessions where id=$1::uuid and user_id=$2::uuid) as user_matches,
   exists(select 1 from public.raxi_workspaces where id=$3::uuid and owner_user_id=$2::uuid) as owner_matches`,
   [before.sessionId,before.actorId,workspaceId]);
  assert.equal(r.rows.length,1,'Session evidence missing');
  assert.equal(r.rows[0].owner_matches,true,'Workspace ownership changed');return r.rows[0];
 };
 const initial=await sessionState();assert.equal(initial.present,true,'Session must exist before logout');assert.equal(initial.user_matches,true,'Session owner mismatch');
 const logout=await auth.signOut({scope:'local'});
 assert.ok(logout&&logout.error===null,'Logout not confirmed');
 const removed=await sessionState();assert.equal(removed.present,false,'Remote session was not removed');
 live();
 // Availability and signature probes use the SAME retained access token, explicitly.
 // A signOut response or a generic identify rejection alone cannot prove revocation.
 const claims=await auth.getClaims(token);
 assert.ok(!claims.error&&claims.data?.claims,'Claims verification unavailable');
 const c=claims.data.claims;
 assert.equal(c.sub,before.actorId);assert.equal(c.session_id,before.sessionId);
 assert.equal(c.iss,`https://${before.projectRef}.supabase.co/auth/v1`);
 assert.equal(c.aud,'authenticated');assert.equal(c.role,'authenticated');assert.equal(c.is_anonymous,false);
 assert.ok(Number.isSafeInteger(c.exp)&&c.exp*1000===expires,'JWT expiry or identity changed');live();
 const user=await auth.getUser(token);
 assert.ok(!user.error&&user.data?.user,'Auth did not confirm user: session-RPC attribution unavailable');
 assert.equal(user.data.user.id,before.actorId);assert.equal(user.data.user.is_anonymous,false);
 let calls=0,sessionDenied=false;
 const observed={async rpc(name,args){
  assert.equal(name,'raxi_supervised_host_identity');
  assert.equal(args.p_identity.actorId,before.actorId);assert.equal(args.p_identity.sessionId,before.sessionId);
  assert.equal(args.p_identity.workspaceId,workspaceId);assert.equal(args.p_identity.projectRef,before.projectRef);
  live();calls++;
  const r=await server.rpc(name,args);
  // Match the function's deliberate rejection, not PostgREST transport failures,
  // timeouts, missing grants/functions or a generic Error from Auth.
  sessionDenied=r.error?.code==='42501'&&r.error?.message==='session or workspace denied'&&r.data===null;
  return r;
 }};
 let rejection;
 try {await createIdentify(observed)(token,workspaceId);}catch(error){rejection=error;}
 live();
 assert.ok(rejection instanceof Error&&rejection.message==='Session or owner not confirmed','Expected session-check rejection');
 assert.equal(calls,1,'Rejection must reach exactly one session RPC');assert.equal(sessionDenied,true,'Session-specific database rejection required');
 // An independent read confirms that no concurrent login restored this session and
 // that ownership still matches when the rejection is attributed to revocation.
 assert.equal((await sessionState()).present,false);live();
 return Object.freeze({logoutConfirmed:true,sessionAbsent:true,jwtUnexpired:true,rejectionSource:'SESSION_RPC'});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 runStagingRuntime(process.env,process.argv.slice(2)).catch(()=>{console.error('B2 not authorized or acceptance not confirmed; sensitive details suppressed');process.exitCode=1;});
}
