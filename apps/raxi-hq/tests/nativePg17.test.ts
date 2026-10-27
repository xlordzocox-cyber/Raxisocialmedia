// OPT-IN native PG17 only. Never part of npm test. Synthetic identity, no provider.
import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import {localSupervisedRepository} from '../../../server/agent-runtime/localSupervisedRepository';
// @ts-ignore Local opt-in harness.
import {labExec,labPort,openLabSession,observeWait,bindFixtureSql,LAB,closeNativePorts} from '../scripts/native-pg17-lab.mjs';
const admin=labPort('raxi_local'),port=labPort(),id=()=>crypto.randomUUID();
let failed=false;
const test=(name:string,body:()=>Promise<void>)=>nodeTest(name,async()=>{
 if(failed)throw Error('Native validation stopped after earlier failure; no SQL issued');
 try{await body();}catch(e){failed=true;throw e;}finally{await closeNativePorts();}
});
async function fixture() {
 const owner=id(),foreign=id(),workspace=id();
 await labExec(bindFixtureSql(`insert into auth.users(id) values($1),($2);
 insert into public.raxi_workspaces(id,owner_user_id,slug,name) values($3,$1,'native-pg17','LOCAL PG17 ONLY');
 insert into public.raxi_runtime_policies(workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,max_tasks,expires_at)
 values($3,true,true,'simulated','fixture-model',100,10,8,clock_timestamp()+interval '1 hour');`,[owner,foreign,workspace]),'raxi_local');
 const spec={question:'Native PostgreSQL fixture only',externalResearch:false,provider:'simulated',model:'fixture-model',
  authorization:{confirmed:true,maxCostMicros:10,expiresAt:new Date(Date.now()+600000).toISOString()}};
 const repo=()=>localSupervisedRepository(labPort(),owner);
 const prepare=(key=id())=>repo().prepare(workspace,key,'DIRECTOR',spec);
 const approve=(t:any)=>repo().approve(t.id,id(),t.input_snapshot.supervised.scopeDigest);
 const scalar=async(sql:string,values:unknown[]=[])=> (await port.query(sql,values)).rows[0];
 return {owner,foreign,workspace,spec,repo,prepare,approve,scalar};
}
test('native PG17 identity and seven-source catalog compile with closed permissions',async()=>{
 const s=openLabSession();const proof=await s.ready;await s.finish();assert.equal(proof.version,170011);assert.equal(proof.db,LAB.database);
 const {rows}=await admin.query(`select p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') a,has_function_privilege('authenticated',p.oid,'EXECUTE') u
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'raxi_supervised_%'`);
 assert.ok(rows.length>8);assert.ok(rows.every((r:any)=>!r.prosecdef&&!r.a&&!r.u&&r.proconfig.includes('search_path=""')));
 const r=await admin.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'");
 assert.ok(r.rows.length>=18);assert.ok(r.rows.every((v:any)=>v.relrowsecurity));
 for(const role of ['anon','authenticated'])await assert.rejects(labPort(role).query("select public.raxi_supervised_host_identity('{}')"),{code:'42501'});
});
test('native RLS isolates synthetic actors; another owner cannot prepare or approve',async()=>{
 const f=await fixture(),t=await f.prepare();
 const mine=await labPort('authenticated',{sub:f.owner}).query('select id from public.raxi_workspaces where id=$1',[f.workspace]);
 const other=await labPort('authenticated',{sub:f.foreign}).query('select id from public.raxi_workspaces where id=$1',[f.workspace]);
 assert.equal(mine.rows.length,1);assert.equal(other.rows.length,0);
 const foreign=localSupervisedRepository(port,f.foreign);
 await assert.rejects(foreign.prepare(f.workspace,id(),'DIRECTOR',f.spec));
 await assert.rejects(foreign.approve(t.id,id(),t.input_snapshot.supervised.scopeDigest));
});
test('native B helpers check synthetic session deletion/expiry/owner; not hosted Auth',async()=>{
 const f=await fixture(),session=id(),identity={provenance:'SUPABASE_AUTH_STAGING',actorId:f.owner,sessionId:session,workspaceId:f.workspace,
  projectRef:'abcdefghijklmnopqrst',expiresAt:f.spec.authorization.expiresAt};
 await labExec(bindFixtureSql('insert into auth.sessions(id,user_id) values($1,$2)',[session,f.owner]),'raxi_local');
 const check=(i=identity)=>port.query('select public.raxi_supervised_host_identity($1)',[JSON.stringify(i)]);
 await check();await assert.rejects(check({...identity,actorId:f.foreign}),{code:'42501'});
 await assert.rejects(check({...identity,expiresAt:'2000-01-01T00:00:00Z'}),{code:'42501'});
 await labExec(bindFixtureSql("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[session]),'raxi_local');
 await assert.rejects(check(),{code:'42501'});
 await labExec(bindFixtureSql('delete from auth.sessions where id=$1',[session]),'raxi_local');await assert.rejects(check(),{code:'42501'});
});
test('native duplicate preparation and approval are idempotent; changed payload conflicts',async()=>{
 const f=await fixture(),key=id(),a=await f.prepare(key),b=await f.prepare(key);assert.equal(a.id,b.id);
 await assert.rejects(f.repo().prepare(f.workspace,key,'DIRECTOR',{...f.spec,question:'Changed'}));
 const k=id();await f.repo().approve(a.id,k,a.input_snapshot.supervised.scopeDigest);await f.repo().approve(a.id,k,a.input_snapshot.supervised.scopeDigest);
 assert.equal((await f.scalar('select reserved_micros from public.raxi_runtime_policies where workspace_id=$1',[f.workspace])).reserved_micros,10);
 await assert.rejects(f.repo().approve(a.id,id(),'0'.repeat(64)));
});
test('native physical connections wait on workspace lock; duplicate approval reserves once and claim wins once',async()=>{
 const f=await fixture(),key=id();
 const a=openLabSession(),b=openLabSession(),pa=await a.ready,pb=await b.ready;assert.notEqual(pa.pid,pb.pid);
 // A holds the workspace row and prepares without committing; B must physically wait.
 const command=bindFixtureSql('select public.raxi_supervised_prepare($1,$2,$3,$4,$5,$6,$7)',
  [f.owner,f.workspace,key,'DIRECTOR',JSON.stringify(f.spec),JSON.stringify(f.spec),null]);
 a.send('begin;set role service_role;'+command+';');
 // Observe A idle in transaction before issuing B, no timing-based claim of concurrency.
 for(let i=0;i<60;i++){const r=await admin.query('select state from pg_stat_activity where pid=$1',[pa.pid]);if(r.rows[0]?.state==='idle in transaction')break;await new Promise(r=>setTimeout(r,50));}
 b.send('set role service_role;'+command+';');
 try {const wait=await observeWait(pb.pid,pa.pid);console.log('PG17 physical concurrency',JSON.stringify(wait));await a.finish('commit;');await b.finish();}
 catch(e){await Promise.allSettled([a.finish('rollback;'),b.finish()]);throw e;}
 assert.equal((await f.scalar('select count(*)::int n from public.raxi_agent_tasks where workspace_id=$1',[f.workspace])).n,1);
 const t=await f.prepare(key),approvalKey=id();
 await Promise.all([f.repo().approve(t.id,approvalKey,t.input_snapshot.supervised.scopeDigest),f.repo().approve(t.id,approvalKey,t.input_snapshot.supervised.scopeDigest)]);
 assert.equal((await f.scalar('select reserved_micros from public.raxi_runtime_policies where workspace_id=$1',[f.workspace])).reserved_micros,10);
 const claims=await Promise.all([f.repo().repository.claim(t.id,'native-a'),f.repo().repository.claim(t.id,'native-b')]);
 assert.equal(claims.filter(Boolean).length,1);
 assert.equal((await f.scalar('select count(*)::int n from public.raxi_agent_runs where task_id=$1',[t.id])).n,1);
});
test('native revocation, expired scope, changed policy and budgets prevent dispatch; ZERO provider calls',async()=>{
 for(const mode of ['revoked','expired','budget','real']){
  const f=await fixture(),t=await f.prepare();
  if(mode==='budget'){
   await labExec(bindFixtureSql('update public.raxi_runtime_policies set total_budget_micros=9 where workspace_id=$1',[f.workspace]));
   await assert.rejects(f.approve(t));continue;
  }
  await f.approve(t);const c=await f.repo().repository.claim(t.id,'native');assert.ok(c);
  if(mode==='revoked')await f.repo().approve(t.id,id(),t.input_snapshot.supervised.scopeDigest,true);
  if(mode==='expired')await labExec(bindFixtureSql("update public.raxi_runtime_policies set expires_at=clock_timestamp()-interval '1 second' where workspace_id=$1",[f.workspace]));
  if(mode==='real')await labExec(bindFixtureSql('update public.raxi_runtime_policies set simulated=false where workspace_id=$1',[f.workspace]));
  await assert.rejects(f.repo().repository.step(c.run.id,c.run.lease_token,'dispatch'));
 }
});
async function finished(loseFinishResponse=false) {
 const f=await fixture(),t=await f.prepare();await f.approve(t);const c=await f.repo().repository.claim(t.id,'native');assert.ok(c);
 const r=f.repo();await r.repository.step(c.run.id,c.run.lease_token,'dispatch');
 assert.equal((await f.scalar('select status from public.raxi_agent_runs where id=$1',[c.run.id])).status,'CLAIMED');
 await r.repository.step(c.run.id,c.run.lease_token,'ack',undefined,'SIMULATED:'+c.run.id);
 const result={summary:'Synthetic local SQL receipt, no provider called',simulated:true};
 if(loseFinishResponse){
  let lost=false;
  const lossy=localSupervisedRepository({provenance:'LOCAL_POSTGRES_FIXTURE',async query<T>(sql:string,values?:unknown[]){
   const answer=await labPort().query(sql,values);
   if(!lost&&sql.includes('raxi_supervised_step')&&values?.[5]==='finish'){lost=true;throw Error('Injected response loss AFTER local commit');}
   return answer as {rows:T[]};
  }},f.owner);
  await assert.rejects(lossy.repository.step(c.run.id,c.run.lease_token,'finish',result,undefined,0),/AFTER local commit/);
  assert.equal(lost,true);
 }else await r.repository.step(c.run.id,c.run.lease_token,'finish',result,undefined,0);
 return {...f,t,c,result,op:c.run.id+':finish',ref:'SUPERVISED_JOURNAL:'+c.run.id+':finish'};
}
test('native durable confirmed finish survives new clients and lost-body replay without another effect',async()=>{
 const f=await finished(true); // genuine injected transport failure after SQL commit
 const r=f.repo(),found=await r.journal.reconcile(f.op);assert.equal(found.status,'FOUND');assert.ok(found.write);
 assert.equal((await r.journal.commit(found.write)).version,3);
 await r.repository.step(f.c.run.id,f.c.run.lease_token,'finish',f.result,undefined,0);
 assert.equal((await r.repository.claim(f.t.id,'another')),null);
 assert.equal((await f.scalar('select count(*)::int n from public.raxi_agent_tasks where workspace_id=$1',[f.workspace])).n,1,'No automatic Researcher');
 const e=await port.query('select source_kind,evidence_status from public.raxi_agent_events where workspace_id=$1',[f.workspace]);
 assert.ok(e.rows.every((v:any)=>v.source_kind==='MOCK'&&v.evidence_status==='UNVERIFIED'));
 await assert.rejects(r.repository.step(f.c.run.id,f.c.run.lease_token,'finish',{...f.result,summary:'changed'},undefined,0));
});
test('native Researcher needs separate task, approval and reservation after confirmed Director',async()=>{
 const f=await finished(),r=f.repo();
 const researcher=await r.prepare(f.workspace,id(),'RESEARCHER',f.spec,f.c.run.id);
 assert.notEqual(researcher.id,f.t.id);assert.equal(await r.repository.claim(researcher.id,'native-researcher'),null);
 await r.approve(researcher.id,id(),researcher.input_snapshot.supervised.scopeDigest);
 const claim=await r.repository.claim(researcher.id,'native-researcher');assert.ok(claim);
 assert.equal(claim.run.stage,'RESEARCHER');
 assert.equal((await f.scalar('select reserved_micros from public.raxi_runtime_policies where workspace_id=$1',[f.workspace])).reserved_micros,20);
 assert.equal((await f.scalar('select count(*)::int n from public.raxi_approvals where workspace_id=$1',[f.workspace])).n,2);
});
test('native journal trigger blocks mutation/delete/truncate/relabel while unrelated rows remain writable',async()=>{
 const f=await finished();
 for(const sql of ['update public.raxi_agent_events set payload=\'{}\' where source_ref=$1','delete from public.raxi_agent_events where source_ref=$1'])
  await assert.rejects(labExec(bindFixtureSql(sql,[f.ref])),{code:'42501'});
 await assert.rejects(labExec('truncate public.raxi_agent_events'),{code:'42501'});
 await assert.rejects(labExec('alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable'),{code:'42501'});
 await assert.rejects(labExec(bindFixtureSql("update public.raxi_agent_events set event_type='SUPERVISED_LOCAL_JOURNAL' where task_id=$1 and event_type='RUNTIME_ACKNOWLEDGED'",[f.t.id])),{code:'42501'});
 await labExec(bindFixtureSql("update public.raxi_agent_events set source_ref='LOCAL-UNRELATED' where task_id=$1 and event_type='RUNTIME_ACKNOWLEDGED';delete from public.raxi_agent_events where task_id=$1 and source_ref='LOCAL-UNRELATED'",[f.t.id]));
 assert.equal((await f.repo().journal.reconcile(f.op)).status,'FOUND');
});
test('native journal P2 detects command/digest/confirmation tamper and recovers intact record',async()=>{
 const f=await finished(),original=(await f.scalar('select payload from public.raxi_agent_events where source_ref=$1',[f.ref])).payload;
 const variants=[structuredClone(original),structuredClone(original),structuredClone(original),structuredClone(original)];
 variants[0].command.result.summary='tampered';delete variants[1].confirmation.journal_digest;
 variants[2].confirmation.journal_digest='0'.repeat(64);variants[3].confirmation.cost_micros=17;
 for(const payload of variants){
  await labExec(bindFixtureSql(`begin;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable;
   update public.raxi_agent_events set payload=$1 where source_ref=$2;alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;commit;`,[payload,f.ref]),'raxi_local');
  const repo=f.repo();assert.equal((await repo.journal.reconcile(f.op)).status,'CONFLICT');await assert.rejects(repo.confirmation(f.op),{code:'P1901'});
  await assert.rejects(repo.repository.step(f.c.run.id,f.c.run.lease_token,'finish',f.result,undefined,0),{code:'P1901'});
 }
 await labExec(bindFixtureSql(`begin;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable;
 update public.raxi_agent_events set payload=$1 where source_ref=$2;alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;commit;`,[original,f.ref]),'raxi_local');
 assert.equal((await f.repo().journal.reconcile(f.op)).status,'FOUND');
});
test('native failed transaction rolls back approval/reservation/audit together',async()=>{
 const f=await fixture(),t=await f.prepare();
 const before=await f.scalar('select count(*)::int n from public.raxi_audit_events where workspace_id=$1',[f.workspace]);
 await assert.rejects(labExec(bindFixtureSql(`begin;select public.raxi_supervised_approve($1,$2,$3,$4,false);select 1/0;commit;`,[f.owner,t.id,id(),t.input_snapshot.supervised.scopeDigest])),{code:'22012'});
 assert.equal((await f.scalar('select reserved_micros from public.raxi_runtime_policies where workspace_id=$1',[f.workspace])).reserved_micros,0);
 assert.equal((await f.scalar('select count(*)::int n from public.raxi_approvals where subject_id=$1',[t.id])).n,0);
 assert.deepEqual(await f.scalar('select count(*)::int n from public.raxi_audit_events where workspace_id=$1',[f.workspace]),before);
});
test('native late journal transaction failure preserves acknowledged receipt and rolls back finish/event/audit',async()=>{
 const f=await fixture(),t=await f.prepare();await f.approve(t);const c=await f.repo().repository.claim(t.id,'native');assert.ok(c);
 await f.repo().repository.step(c.run.id,c.run.lease_token,'dispatch');
 await f.repo().repository.step(c.run.id,c.run.lease_token,'ack',undefined,'SIMULATED:'+c.run.id);
 const before=await f.scalar('select count(*)::int n from public.raxi_audit_events where workspace_id=$1',[f.workspace]);
 await assert.rejects(labExec(bindFixtureSql(`begin;select public.raxi_supervised_step($1,$2,$3,$4,2,'finish',$5,null,0);select 1/0;commit;`,
  [f.owner,c.run.id,c.run.lease_token,c.run.id+':finish',JSON.stringify({summary:'Must roll back',simulated:true})])),{code:'22012'});
 const fresh=f.repo();assert.equal((await fresh.journal.reconcile(c.run.id+':finish')).status,'MISSING');
 assert.equal((await fresh.journal.reconcile(c.run.id+':ack')).status,'FOUND');
 assert.equal((await f.scalar('select status from public.raxi_agent_runs where id=$1',[c.run.id])).status,'RUNNING');
 assert.deepEqual(await f.scalar('select count(*)::int n from public.raxi_audit_events where workspace_id=$1',[f.workspace]),before);
});
