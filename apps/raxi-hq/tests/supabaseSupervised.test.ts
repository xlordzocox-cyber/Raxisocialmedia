/** LOCAL TEST DOUBLES, not hosted Auth, JWT signatures or physical PostgreSQL connections. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {campaignDatabase} from './campaignDatabase';
import {supabaseSupervisedAuth,type UserAuthPort,type ServerRpcPort} from '../../../server/agent-runtime/supabaseSupervisedAuth';
import {supabaseSupervisedRepository} from '../../../server/agent-runtime/supabaseSupervisedRepository';
import {createSupabaseSupervisedHost} from '../../../server/agent-runtime/supervisedHostHandler';
import {runOne,type TaskSpec} from '../../../server/agent-runtime/runtime';
import {simulatedProvider} from '../../../server/agent-runtime/providers';
// @ts-ignore Existing .mjs script has no declaration; this test exercises its real exports.
import {runtimeStagingGate,verifyStagingEvidence,runStagingRuntime,verifyHostedSessionRevocation} from '../scripts/staging-runtime-acceptance.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',workspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const session='cccccccc-cccc-4ccc-8ccc-cccccccccccc',foreign='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ref='abcdefghijklmnopqrst';
async function fixture(disk=false) {
 const dir=disk?mkdtempSync(join(tmpdir(),'raxi-host-b-')):undefined;
 let db=await campaignDatabase(false,dir);
 await db.exec('alter table auth.users add column is_anonymous boolean not null default false;create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz)');
 for(const name of ['agent_runtime','supervised_host_stage_a','supervised_host_stage_b'])await db.exec(readFileSync('../../supabase/proposals/'+name+'.sql','utf8'));
 await db.query('insert into auth.users(id) values($1),($2)',[owner,foreign]);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
 await db.query("insert into public.raxi_workspaces(id,owner_user_id,slug,name) values($1,$2,'stage-b','LOCAL B FIXTURE')",[workspace,owner]);
 await db.query("insert into public.raxi_runtime_policies(workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,max_tasks,expires_at) values($1,true,true,'simulated','fixture-model',30,10,3,clock_timestamp()+interval '1 hour')",[workspace]);
 await db.exec('set role service_role');
 const claims:Record<string,unknown>={sub:owner,session_id:session,iss:`https://${ref}.supabase.co/auth/v1`,aud:'authenticated',role:'authenticated',is_anonymous:false,iat:Math.floor(Date.now()/1000)-1,exp:Math.floor(Date.now()/1000)+600};
 let user={id:owner,is_anonymous:false}, lost=false, failure=false,calls=0;
 const auth:UserAuthPort={async getClaims(token){return {data:token==='test-session-handle'?{claims:structuredClone(claims)}:null,error:null};},async getUser(){return {data:{user},error:null};}};
 const server:ServerRpcPort={async rpc(name,args){
  assert.ok(['raxi_supervised_host_identity','raxi_supervised_host_command'].includes(name),'No generic runtime RPC');
  try {
   if(failure&&args.p_action==='step'&&(args.p_args as {kind:string}).kind==='finish'){failure=false;throw Error('fixture before commit');}
   const values=Object.values(args).map(v=>typeof v==='object'?JSON.stringify(v):v);
   const r=await db.query<{v:unknown}>(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) v`,values);
   if(lost&&args.p_action==='step'&&(args.p_args as {kind:string}).kind==='finish'){lost=false;throw Error('fixture commit body lost');}
   return {data:r.rows[0]?.v??null,error:null};
  }catch(error){return {data:null,error};}
 }};
 const identify=supabaseSupervisedAuth({projectRef:ref,auth,server});
 const identity=await identify('test-session-handle',workspace);
 const repo=()=>supabaseSupervisedRepository({server,identity,revalidate:()=>identify('test-session-handle',workspace),liveEnabled:false});
 const spec:TaskSpec={question:'Inspect local staging fixture only',provider:'simulated',model:'fixture-model',externalResearch:false,
  authorization:{confirmed:true,maxCostMicros:10,expiresAt:new Date(Date.now()+300000).toISOString()}};
 const prepare=(stage:'DIRECTOR'|'RESEARCHER'='DIRECTOR',parent:string|null=null,key=crypto.randomUUID())=>repo().prepare(key,stage,spec,parent);
 const approve=async(id:string,key=crypto.randomUUID())=>{const t=await repo().readTask(id);return repo().approve(id,key,t.input_snapshot.supervised.scopeDigest);};
 const executionKeys=new Map<string,string>();
 const execute=async(id:string)=>{const key=executionKeys.get(id)??crypto.randomUUID();executionKeys.set(id,key);await repo().bindExecution(id,key);
  return runOne({repository:repo().repository,providers:new Map([['simulated',{...simulatedProvider,async start(...a:Parameters<typeof simulatedProvider.start>){calls++;return simulatedProvider.start(...a);}}]]),workerId:'LOCAL-B-TEST',liveEnabled:false},id);};
 const run=async(id:string)=>(await db.query<{id:string}>('select id from public.raxi_agent_runs where task_id=$1',[id])).rows[0].id;
 return {claims,auth,server,identify,identity,repo,spec,prepare,approve,execute,run,get db(){return db;},get calls(){return calls;},
  changeUser(){user={id:foreign,is_anonymous:false};},lose(){lost=true;},fail(){failure=true;},
  async admin(sql:string,values:unknown[]=[]){await db.exec('reset role');try{return await db.query(sql,values);}finally{await db.exec('set role service_role');}},
  async restart(){assert.ok(dir);await db.close();db=new PGlite(dir);await db.exec('set role service_role');},
  async close(){await db.close();if(dir){assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}}};
}
test('B1 denies missing/invalid tokens, expired/future/foreign claims, anonymous users and account changes (Auth doubles)',async()=>{
 const f=await fixture();try{
  for(const token of ['', 'invalid', 'with whitespace'])await assert.rejects(f.identify(token,workspace));
  const original=structuredClone(f.claims);
  for(const patch of [{exp:0},{iat:Math.floor(Date.now()/1000)+300},{iss:'https://jrkefsylpfriiqefcmzq.supabase.co/auth/v1'},
   {is_anonymous:true},{session_id:null},{aud:'other'},{role:'service_role'},{nbf:'invalid'},{user_metadata:{permissions:['all']},sub:foreign}]){
   Object.assign(f.claims,patch);await assert.rejects(f.identify('test-session-handle',workspace));Object.keys(f.claims).forEach(k=>delete f.claims[k]);Object.assign(f.claims,original);
  }
  f.changeUser();await assert.rejects(f.identify('test-session-handle',workspace));
 }finally{await f.close();}
});
test('B1 fresh session lookup rejects revoked/expired sessions and foreign workspace even with valid claim doubles',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.identify('test-session-handle',crypto.randomUUID()));
  await f.admin("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[session]);
  await assert.rejects(f.identify('test-session-handle',workspace));
  await f.admin('delete from auth.sessions where id=$1',[session]);await assert.rejects(f.repo().prepare(crypto.randomUUID(),'DIRECTOR',f.spec));
 }finally{await f.close();}
});
test('B1 same command is idempotent; approval scope and per-task budgets cannot change',async()=>{
 const f=await fixture();try{
  const key=crypto.randomUUID(),[a,b]=await Promise.all([f.prepare('DIRECTOR',null,key),f.prepare('DIRECTOR',null,key)]);assert.equal(a.id,b.id);
  await assert.rejects(f.repo().prepare(key,'DIRECTOR',{...f.spec,question:'changed approved scope'}));
  await assert.rejects(f.repo().approve(a.id,crypto.randomUUID(),'f'.repeat(64)));
  const ak=crypto.randomUUID();await f.approve(a.id,ak);await f.approve(a.id,ak);
  assert.equal((await f.db.query<{n:number}>('select reserved_micros n from public.raxi_runtime_policies')).rows[0].n,10);
  const result=await Promise.all([f.execute(a.id),f.execute(a.id)]);assert.equal(result.filter(v=>v.claimed).length,1);assert.equal(f.calls,1);
  assert.equal((await f.db.query('select id from public.raxi_agent_tasks')).rows.length,1,'No automatic Researcher');
  const researcher=await f.prepare('RESEARCHER',await f.run(a.id));assert.equal(researcher.status,'WAITING_APPROVAL');
  const own=await f.repo().readTask(researcher.id);await assert.rejects(f.repo().approve(researcher.id,crypto.randomUUID(),a.input_snapshot.supervised.scopeDigest));
  await f.approve(researcher.id);await f.execute(researcher.id);assert.equal(f.calls,2);assert.equal(own.status,'WAITING_APPROVAL');
 }finally{await f.close();}
});
test('B1 revocation, approval expiry and insufficient budget produce ZERO simulated provider calls',async()=>{
 const f=await fixture();try{
  const a=await f.prepare();await f.approve(a.id);await f.repo().approve(a.id,crypto.randomUUID(),a.input_snapshot.supervised.scopeDigest,true);
  await assert.rejects(f.execute(a.id));assert.equal(f.calls,0);
  const expired=await f.prepare();await f.db.query("update public.raxi_agent_tasks set input_snapshot=jsonb_set(input_snapshot,'{spec,authorization,expiresAt}','\"2000-01-01T00:00:00Z\"') where id=$1",[expired.id]);await assert.rejects(f.approve(expired.id));
  await f.db.exec('update public.raxi_runtime_policies set total_budget_micros=reserved_micros');
  const b=await f.prepare();await assert.rejects(f.approve(b.id));assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('B1 lost finish confirmation recovers after disk restart with original operation, digests and one effect',async()=>{
 const f=await fixture(true);try{
  const t=await f.prepare();await f.approve(t.id);f.lose();assert.equal((await f.execute(t.id)).uncertain,true);assert.equal(f.calls,1);
  const id=await f.run(t.id);await f.restart();const found=await f.repo().reconcile(t.id,id+':finish');assert.equal(found.status,'FOUND');
  assert.equal((found.confirmation as {lease_token?:string}).lease_token,undefined);
  assert.equal((await f.execute(t.id)).claimed,false);assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('B1 P2 journal integrity and append-only protection survive hosted RPC path',async()=>{
 const f=await fixture();try{
  const t=await f.prepare();await f.approve(t.id);await f.execute(t.id);const id=await f.run(t.id),ref='SUPERVISED_JOURNAL:'+id+':finish';
  await assert.rejects(f.db.query('delete from public.raxi_agent_events where source_ref=$1',[ref]),/append-only/);
  const original=(await f.db.query<{payload:unknown}>('select payload from public.raxi_agent_events where source_ref=$1',[ref])).rows[0].payload;
  await f.db.exec('reset role;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable');
  await f.db.query("update public.raxi_agent_events set payload=jsonb_set(payload,'{confirmation,journal_digest}','\"altered\"') where source_ref=$1",[ref]);
  await f.db.exec('alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;set role service_role');
  assert.equal((await f.repo().reconcile(t.id,id+':finish')).status,'CONFLICT');assert.equal(f.calls,1);
  await f.db.exec('reset role;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable');
  await f.db.query('update public.raxi_agent_events set payload=$1 where source_ref=$2',[JSON.stringify(original),ref]);
  await f.db.exec('alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;set role service_role');
  assert.equal((await f.repo().reconcile(t.id,id+':finish')).status,'FOUND');
 }finally{await f.close();}
});
test('B1 persistence failure retains uncertainty/receipt; session revocation prevents dispatch but not receipt capture',async()=>{
 const f=await fixture();try{
  const t=await f.prepare();await f.approve(t.id);f.fail();assert.equal((await f.execute(t.id)).uncertain,true);const id=await f.run(t.id);
  assert.equal((await f.repo().reconcile(t.id,id+':ack')).status,'FOUND');assert.equal((await f.repo().reconcile(t.id,id+':finish')).status,'MISSING');assert.equal(f.calls,1);
  const next=await f.prepare();await f.approve(next.id);await f.repo().bindExecution(next.id,crypto.randomUUID());const claim=await f.repo().repository.claim(next.id,'fixture');assert.ok(claim);
  await f.admin('delete from auth.sessions where id=$1',[session]);
  await assert.rejects(f.repo().repository.step(claim.run.id,claim.run.lease_token,'dispatch'));assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('B1 session revoked after dispatch cannot erase a simulated receipt or permit a new call',async()=>{
 const f=await fixture();try{
  const t=await f.prepare();await f.approve(t.id);const port=f.repo();await port.bindExecution(t.id,crypto.randomUUID());
  const claim=await port.repository.claim(t.id,'fixture');assert.ok(claim);
  await port.repository.step(claim.run.id,claim.run.lease_token,'dispatch');
  await f.admin('delete from auth.sessions where id=$1',[session]);
  await port.repository.step(claim.run.id,claim.run.lease_token,'ack',undefined,'SIMULATED:'+claim.run.id);
  await port.repository.step(claim.run.id,claim.run.lease_token,'finish',{summary:'fixture receipt retained',simulated:true},undefined,0);
  assert.equal((await f.db.query<{status:string}>('select status from public.raxi_agent_runs where id=$1',[claim.run.id])).rows[0].status,'SUCCEEDED');
  await assert.rejects(port.repository.claim(t.id,'fixture'));assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('B2 runner requires explicit authorization, matching project metadata and unexpired hashed-manifest configuration before any network',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Forbidden');};
 try {
  await assert.rejects(runStagingRuntime({},[]));
  const ref='zvhxjindgyvtasstfjut';
  const env={RAXI_STAGING_REF:ref,RAXI_STAGING_URL:`https://${ref}.supabase.co`,RAXI_STAGING_DATABASE_URL:`postgresql://postgres:fixture-only@db.${ref}.supabase.co:5432/postgres`,RAXI_STAGING_ACK:'RUN_ISOLATED_STAGING_ACCEPTANCE',RAXI_STAGING_RUNTIME_ACK:'RUN_SUPERVISED_SIMULATION_B2',RAXI_STAGING_APPROVAL_FILE:'not-read',RAXI_STAGING_APPROVAL_SHA256:'a'.repeat(64)};
  assert.throws(()=>runtimeStagingGate({...env,RAXI_STAGING_REF:'jrkefsylpfriiqefcmzq'},['--run']));
  assert.throws(()=>runtimeStagingGate({...env,RAXI_STAGING_APPROVAL_SHA256:''},['--run']));
  const target=runtimeStagingGate(env,['--run']);
  const manifest={kind:'SUPERVISED_B2_SIMULATION',projectRef:ref,organizationId:'qpjzdqkvjzgqwvismeku',createdAt:'2026-10-26T00:00:00Z',expiresAt:new Date(Date.now()+60000).toISOString(),providers:'SIMULATED_ONLY',productionClone:false,baseCommit:'b56b26567bc97078fa58ef16385b851d890d6408'};
  const project={id:ref,name:'raxi-hq-staging',region:'us-east-2',organization_id:manifest.organizationId,created_at:manifest.createdAt,status:'ACTIVE_HEALTHY'};
  verifyStagingEvidence(target,manifest,project);
  for(const p of [{id:'jrkefsylpfriiqefcmzq'},{organization_id:'other'},{created_at:'other'},{status:'UNKNOWN'}])assert.throws(()=>verifyStagingEvidence(target,manifest,{...project,...p}));
  assert.throws(()=>verifyStagingEvidence(target,{...manifest,expiresAt:'2000-01-01T00:00:00Z'},project));
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});
test('B1 handler is closed, disabled for REAL, no client secrets/lease exposed and no network during local flow',async()=>{
 const f=await fixture(),old=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network');};
 try{
  const host=createSupabaseSupervisedHost({identify:f.identify,server:f.server,liveEnabled:false});
  const send=(body:object,token='test-session-handle')=>host(new Request('http://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const base={action:'prepare',workspaceId:workspace,key:crypto.randomUUID(),stage:'DIRECTOR',spec:f.spec};
  assert.equal((await send({...base,actorId:owner})).status,403);
  assert.equal((await send({...base,spec:{...f.spec,provider:'openai'}})).status,403);
  const response=await send(base);assert.equal(response.status,200);const data=await response.json();assert.equal(data.liveEnabled,false);assert.equal(data.execution,'SIMULATED');
  assert.equal(JSON.stringify(data).includes('lease_token'),false);assert.equal(network,0);
  assert.throws(()=>createSupabaseSupervisedHost({identify:f.identify,server:f.server,liveEnabled:true as false}));
  assert.throws(()=>supabaseSupervisedAuth({projectRef:'jrkefsylpfriiqefcmzq',auth:f.auth,server:f.server}));
  await f.db.exec('reset role;set role authenticated');
  await assert.rejects(f.db.query('select public.raxi_supervised_host_identity($1)',[JSON.stringify(f.identity)]),/permission denied/);
 }finally{globalThis.fetch=old;await f.close();}
});

test('P2 revocation acceptance uses SQL session removal, live claim doubles and the real adapter rejection path (local only)',async()=>{
 const f=await fixture();try{
  let logouts=0;
  const auth={...f.auth,async signOut(options:{scope:string}){assert.equal(options.scope,'local');logouts++;await f.admin('delete from auth.sessions where id=$1',[session]);return {error:null};}};
  const result=await verifyHostedSessionRevocation({auth,server:f.server,sql:f.db,token:'test-session-handle',workspaceId:workspace,
   createIdentify:(server:ServerRpcPort)=>supabaseSupervisedAuth({projectRef:ref,auth,server})});
  assert.deepEqual(result,{logoutConfirmed:true,sessionAbsent:true,jwtUnexpired:true,rejectionSource:'SESSION_RPC'});assert.equal(logouts,1);assert.equal(f.calls,0);
 }finally{await f.close();}
});

/** All ports below are LOCAL DOUBLES. They cannot contact Auth or remove a real session. */
function revocationDouble(fault='',afterLogout=()=>{}) {
 let present=true,signedOut=false,claimsAfter=0,usersAfter=0,sqlReads=0;
 const claims={sub:owner,session_id:session,iss:`https://${ref}.supabase.co/auth/v1`,aud:'authenticated',role:'authenticated',is_anonymous:false,
  iat:Math.floor(Date.now()/1000)-1,exp:Math.floor(Date.now()/1000)+600};
 const auth={
  async getClaims(){
   if(signedOut){claimsAfter++;
    if(fault==='claims_network'||fault==='logout_and_auth_down'||fault==='identify_claims_network'&&claimsAfter===2)throw Error('fixture network');
    if(fault==='claims_error')return {data:null,error:{code:'fixture_auth_unavailable'}};
   }
   return {data:{claims:{...claims,...(signedOut&&fault==='changed_expiry'?{exp:claims.exp+1}:{})}},error:null};
  },
  async getUser(){
   if(signedOut){usersAfter++;
    if(fault==='user_network'||fault==='identify_user_network'&&usersAfter===2)throw Error('fixture network');
    if(fault==='user_error')return {data:{user:null},error:{code:'fixture_auth_unavailable'}};
   }
   return {data:{user:{id:signedOut&&fault==='changed_user'?foreign:owner,is_anonymous:false}},error:null};
  },
  async signOut(){
   signedOut=true;if(fault!=='session_remains')present=false;afterLogout();
   if(fault==='logout_throw')throw Error('fixture logout unavailable');
   return {error:['logout_error','logout_and_auth_down'].includes(fault)?{code:'fixture_logout_failure'}:null};
  },
 };
 const server:ServerRpcPort={async rpc(){
  if(!signedOut)return {data:true,error:null};
  if(fault==='rpc_throw')throw Error('fixture transport unavailable');
  if(fault==='rpc_network')return {data:null,error:{code:'',message:'fixture network'}};
  if(fault==='rpc_permission')return {data:null,error:{code:'42501',message:'permission denied for function'}};
  if(fault==='rpc_missing')return {data:null,error:{code:'PGRST202',message:'function unavailable'}};
  if(fault==='rpc_accepts')return {data:true,error:null};
  return {data:null,error:{code:'42501',message:'session or workspace denied'}};
 }};
 const sql={async query(statement:string,params:unknown[]){
  sqlReads++;assert.match(statement,/auth\.sessions/);assert.deepEqual(params,[session,owner,workspace]);
  if(fault==='sql_before'&&!signedOut||fault==='sql_after'&&signedOut)throw Error('fixture SQL unavailable');
  return {rows:[{present:fault==='no_initial_session'?false:present,user_matches:present,owner_matches:!(signedOut&&fault==='owner_changed')}]};
 }};
 const createIdentify=(server:ServerRpcPort)=>supabaseSupervisedAuth({projectRef:ref,auth,server});
 return {auth,server,sql,token:'test-session-handle',workspaceId:workspace,createIdentify,get sqlReads(){return sqlReads;},claims};
}
test('P2 old generic rejection accepts logout plus Auth outage, corrected acceptance rejects that false positive',async()=>{
 const original=revocationDouble('logout_and_auth_down');
 await original.auth.signOut();await assert.rejects(original.createIdentify(original.server)(original.token,workspace));
 const corrected=revocationDouble('logout_and_auth_down');await assert.rejects(verifyHostedSessionRevocation(corrected),/Logout not confirmed/);
 assert.equal(corrected.sqlReads,1,'No post-logout acceptance evidence after failed logout');
});
for(const fault of ['logout_error','logout_throw','session_remains','sql_before','sql_after','claims_network','claims_error',
 'user_network','user_error','identify_claims_network','identify_user_network','rpc_throw','rpc_network','rpc_permission','rpc_missing',
 'rpc_accepts','changed_expiry','changed_user','no_initial_session','owner_changed']) {
 test(`P2 revocation evidence fails closed for ${fault} (local doubles)`,async()=>{
  await assert.rejects(verifyHostedSessionRevocation(revocationDouble(fault)));
 });
}
test('P2 JWT at exact expiry after logout cannot be accepted as session-revocation evidence',async()=>{
 const actualNow=Date.now;let now=actualNow();Date.now=()=>now;
 try {
  const f=revocationDouble('',()=>{now=f.claims.exp*1000;});
  await assert.rejects(verifyHostedSessionRevocation(f),/JWT must remain unexpired/);
 }finally{Date.now=actualNow;}
});
