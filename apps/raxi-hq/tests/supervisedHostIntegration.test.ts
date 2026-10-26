import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {campaignDatabase} from './campaignDatabase';
import {createLocalSupervisedHost} from '../../../server/agent-runtime/supervisedHostHandler';
import {localSupervisedRepository,type LocalPostgresPort} from '../../../server/agent-runtime/localSupervisedRepository';
import type {LocalOperatorEvidence} from '../../../server/agent-runtime/supervisedHostContracts';
import {simulatedProvider} from '../../../server/agent-runtime/providers';
import {runOne,type TaskSpec} from '../../../server/agent-runtime/runtime';
import {projectRuntime} from '../src/runtime/runtimeOfficeStore';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',workspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const foreign='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function fixture(persistent=false) {
 const dir=persistent?mkdtempSync(join(tmpdir(),'raxi-host-a-')):undefined;
 let db=await campaignDatabase(false,dir);
 await db.exec(readFileSync('../../supabase/proposals/agent_runtime.sql','utf8'));
 await db.exec(readFileSync('../../supabase/proposals/supervised_host_stage_a.sql','utf8'));
 await db.query('insert into auth.users(id) values($1),($2)',[owner,foreign]);
 await db.query("insert into public.raxi_workspaces(id,owner_user_id,slug,name) values($1,$2,'local-stage-a','LOCAL FIXTURE')",[workspace,owner]);
 await db.query("insert into public.raxi_runtime_policies(workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,max_tasks,expires_at) values($1,true,true,'simulated','fixture-model',100,10,8,clock_timestamp()+interval '1 hour')",[workspace]);
 await db.exec('set role service_role');
 let lose:string|undefined,fail:string|undefined;let calls=0;
 const matches=(marker:string,sql:string,values?:unknown[])=>{const [name,kind]=marker.split(':');return sql.includes(name)&&(!kind||values?.[5]===kind);};
 const port:LocalPostgresPort={provenance:'LOCAL_POSTGRES_FIXTURE',async query<T>(sql:string,values?:unknown[]){
  if(fail&&matches(fail,sql,values)){fail=undefined;throw Error('Local persistence unavailable before commit');}
  const r=await db.query<T>(sql,values);
  if(lose&&matches(lose,sql,values)){lose=undefined;throw Error('Commit accepted; response lost');}
  return r;
 }};
 const spec:TaskSpec={question:'Compare local fixture notes only',externalResearch:false,provider:'simulated',model:'fixture-model',
  authorization:{confirmed:true,maxCostMicros:10,expiresAt:new Date(Date.now()+600000).toISOString()}};
 const proof:LocalOperatorEvidence={provenance:'LOCAL_FIXTURE',operatorId:owner,ownerId:owner,workspaceId:workspace,
  anonymous:false,capabilities:['TEXT_RESEARCH'],expiresAt:spec.authorization.expiresAt};
 const identify=async(session:string)=>session==='fixture-session'?structuredClone(proof):null;
 const host=()=>createLocalSupervisedHost({database:port,identify});
 const repo=()=>localSupervisedRepository(port,owner);
 const provider={...simulatedProvider,async start(...args:Parameters<typeof simulatedProvider.start>){calls++;return simulatedProvider.start(...args);}};
 const execute=(id:string,r=repo())=>runOne({repository:r.repository,providers:new Map([['simulated',provider]]),workerId:'LOCAL-TEST'},id);
 const prepare=async(stage:'DIRECTOR'|'RESEARCHER'='DIRECTOR',parent:string|null=null,key=crypto.randomUUID())=>repo().prepare(workspace,key,stage,spec,parent);
 const approve=async(id:string,key=crypto.randomUUID())=>{const r=repo(),t=await r.readTask(id);return r.approve(id,key,t.input_snapshot.supervised.scopeDigest);};
 const count=async(table:string)=>Number((await db.query<{n:string}>(`select count(*) n from public.${table}`)).rows[0].n);
 const runId=async(task:string)=>(await db.query<{id:string}>('select id from public.raxi_agent_runs where task_id=$1',[task])).rows[0]?.id;
 return {port,spec,proof,repo,host,prepare,approve,execute,count,runId,get db(){return db;},get calls(){return calls;},
  loseNext(name:string){lose=name;},failNext(name:string){fail=name;},
  async restart(){assert.ok(dir);await db.close();db=new PGlite(dir);await db.exec('set role service_role');},
  async close(){await db.close();if(dir){const absolute=resolve(dir);assert.ok(absolute.startsWith(resolve(tmpdir())+sep)&&basename(absolute).startsWith('raxi-host-a-'));rmSync(absolute,{recursive:true,force:true});}},
 };
}
async function post(f:Awaited<ReturnType<typeof fixture>>,body:object,token='fixture-session') {
 const response=await f.host()(new Request('http://local.test/handler',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {status:response.status,body:await response.json()};
}

test('Stage A handler authenticates only identified local fixtures and rejects authority injection without side effects',async()=>{
 const f=await fixture();try{
 const base={action:'prepare',workspaceId:workspace,key:crypto.randomUUID(),stage:'DIRECTOR',spec:f.spec};
 assert.equal((await post(f,base,'unknown')).status,403);
 for(const change of [{anonymous:true},{provenance:'SUPABASE_AUTH'},{ownerId:foreign},{operatorId:foreign},{capabilities:[]},{expiresAt:'2020-01-01T00:00:00Z'}]){
  const original={...f.proof};Object.assign(f.proof,change);
  assert.equal((await post(f,base)).status,403);Object.assign(f.proof,original);
 }
 for(const change of [{actor:owner},{permissions:['all']},{liveEnabled:true},{spec:{...f.spec,provider:'openai'}},{stage:'OTHER'}])
  assert.equal((await post(f,{...base,...change})).status,403);
 assert.equal(await f.count('raxi_agent_tasks'),0);assert.equal(await f.count('raxi_approvals'),0);
 assert.equal((await f.host()(new Request('http://local.test/handler',{method:'POST'}))).status,401);
 const ok=await post(f,base);assert.equal(ok.status,200);assert.equal(ok.body.kind,'LOCAL_SIMULATION_ONLY');
 assert.equal(ok.body.persistence,'LOCAL_POSTGRES');assert.equal(ok.body.liveEnabled,false);
 const task=ok.body.task;assert.equal(task.status,'WAITING_APPROVAL');
 assert.equal((await post(f,{action:'approve',workspaceId:workspace,key:crypto.randomUUID(),taskId:task.id,scopeDigest:task.input_snapshot.supervised.scopeDigest})).status,403);
 assert.equal((await post(f,{action:'approve',workspaceId:workspace,key:crypto.randomUUID(),taskId:task.id,scopeDigest:task.input_snapshot.supervised.scopeDigest,confirmed:true})).status,200);
 const command={action:'execute',workspaceId:workspace,key:crypto.randomUUID(),taskId:task.id,confirmed:true};
 assert.equal((await post(f,command)).status,200);assert.equal((await post(f,command)).status,200);
 assert.equal(await f.count('raxi_agent_runs'),1);
 }finally{await f.close();}
});
test('Director and Researcher have independent tasks, approvals, reservations and keys; completion never queues the other stage',async()=>{
 const f=await fixture();try{
 const d=await f.prepare();assert.equal((await f.execute(d.id)).claimed,false);assert.equal(f.calls,0);
 await f.approve(d.id);assert.equal((await f.execute(d.id)).stage,'DIRECTOR');assert.equal(f.calls,1);
 assert.equal((await f.repo().readTask(d.id)).status,'COMPLETED');
 assert.equal((await f.execute(d.id)).claimed,false);assert.equal(await f.count('raxi_agent_tasks'),1);
 const i=await f.prepare('RESEARCHER',await f.runId(d.id));assert.notEqual(i.id,d.id);
 assert.equal((await f.execute(i.id)).claimed,false);assert.equal(f.calls,1);
 await f.approve(i.id);assert.equal((await f.execute(i.id)).stage,'RESEARCHER');assert.equal(f.calls,2);
 assert.equal((await f.repo().readTask(i.id)).status,'COMPLETED');
 assert.equal(await f.count('raxi_approvals'),2);
 assert.equal((await f.db.query<{reserved_micros:number}>('select reserved_micros from public.raxi_runtime_policies')).rows[0].reserved_micros,20);
 const projected=projectRuntime({workspaceId:workspace,ownerId:owner,serverTime:new Date().toISOString(),tasks:[],events:[]},owner,workspace);
 assert.deepEqual(projected.hq.agents,{});
 const events=await f.db.query<{source_kind:string;evidence_status:string}>('select source_kind,evidence_status from public.raxi_agent_events');
 assert.ok(events.rows.every(e=>e.source_kind==='MOCK'&&e.evidence_status==='UNVERIFIED'));
 }finally{await f.close();}
});
test('Researcher cannot use missing/foreign/changed Director evidence or an approval for another task',async()=>{
 const f=await fixture();try{
 await assert.rejects(f.prepare('RESEARCHER',crypto.randomUUID()));
 const d=await f.prepare();await f.approve(d.id);await f.execute(d.id);
 const id=await f.runId(d.id),i=await f.prepare('RESEARCHER',id);
 await assert.rejects(f.repo().approve(i.id,crypto.randomUUID(),d.input_snapshot.supervised.scopeDigest));
 await f.approve(i.id);
 await f.db.query("update public.raxi_agent_runs set result=jsonb_set(result,'{summary}','\"mutated\"') where id=$1",[id]);
 await assert.rejects(f.execute(i.id));assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('concurrent duplicate preparation, approval and claim produce one reservation and one simulated effect',async()=>{
 const f=await fixture();try{
 const key=crypto.randomUUID(),tasks=await Promise.all([f.prepare('DIRECTOR',null,key),f.prepare('DIRECTOR',null,key)]);
 assert.equal(tasks[0].id,tasks[1].id);
 const approval=crypto.randomUUID();await Promise.all([f.approve(tasks[0].id,approval),f.approve(tasks[0].id,approval)]);
 const results=await Promise.all([f.execute(tasks[0].id),f.execute(tasks[0].id)]);
 assert.equal(results.filter(r=>r.claimed).length,1);assert.equal(f.calls,1);
 assert.equal(await f.count('raxi_agent_runs'),1);assert.equal(await f.count('raxi_approvals'),1);
 assert.equal((await f.db.query<{reserved_micros:number}>('select reserved_micros from public.raxi_runtime_policies')).rows[0].reserved_micros,10);
 await assert.rejects(f.repo().prepare(workspace,key,'DIRECTOR',{...f.spec,question:'Different local content'}));
 }finally{await f.close();}
});
test('insufficient budget, policy changes and expired scope reject admission atomically',async()=>{
 const f=await fixture();try{
 const t=await f.prepare();
 await f.db.exec('update public.raxi_runtime_policies set total_budget_micros=9');
 await assert.rejects(f.approve(t.id));assert.equal(await f.count('raxi_approvals'),0);
 const fresh=await f.prepare();await assert.rejects(f.approve(fresh.id));
 await f.db.exec('update public.raxi_runtime_policies set total_budget_micros=100');
 const next=await f.prepare();await f.approve(next.id);
 await f.db.exec("update public.raxi_runtime_policies set expires_at=clock_timestamp()-interval '1 second'");
 await assert.rejects(f.execute(next.id));assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('revocation at dispatch performs ZERO provider calls; dispatch itself does not mark RUNNING',async()=>{
 const f=await fixture();try{
 const t=await f.prepare();await f.approve(t.id);
 const repo=f.repo(),claim=await repo.repository.claim(t.id,'fixture');assert.ok(claim);
 await repo.repository.step(claim.run.id,claim.run.lease_token,'dispatch');
 assert.equal((await f.db.query<{status:string}>('select status from public.raxi_agent_runs')).rows[0].status,'CLAIMED');
 assert.equal((await f.db.query<{n:string}>("select count(*) n from public.raxi_agent_events where event_type='RUNTIME_ACKNOWLEDGED'")).rows[0].n,0);
 await repo.repository.step(claim.run.id,claim.run.lease_token,'unknown');
 const next=await f.prepare();await f.approve(next.id);
 const guarded=localSupervisedRepository(f.port,owner,async()=>{await f.repo().approve(next.id,crypto.randomUUID(),next.input_snapshot.supervised.scopeDigest,true);});
 const result=await f.execute(next.id,guarded);assert.equal(result.uncertain,true);assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('journal exact replay is idempotent, changed payload conflicts and version is checked',async()=>{
 const f=await fixture();try{
 const t=await f.prepare();await f.approve(t.id);const repo=f.repo(),c=await repo.repository.claim(t.id,'fixture');assert.ok(c);
 await repo.repository.step(c.run.id,c.run.lease_token,'dispatch');
 await repo.repository.step(c.run.id,c.run.lease_token,'dispatch');
 const operation=c.run.id+':dispatch',e=await repo.journal.reconcile(operation);
 assert.equal(e.status,'FOUND');assert.ok(e.write);
 const confirm=await repo.journal.commit(e.write);assert.match(confirm.committedDigest,/^[a-f0-9]{64}$/);
 await assert.rejects(repo.journal.commit({...e.write,result:{different:true}}));
 await assert.rejects(repo.journal.commit({...e.write,expectedVersion:9}));
 await assert.rejects(repo.journal.commit({...e.write,simulated:false,sourceKind:'AGENT_EXECUTOR',evidenceStatus:'VERIFIED'}));
 assert.equal((await f.db.query<{n:string}>("select count(*) n from public.raxi_agent_events where event_type='SUPERVISED_LOCAL_JOURNAL'")).rows[0].n,1);
 assert.equal((await repo.journal.reconcile(c.run.id+':finish')).status,'MISSING');
 await repo.repository.step(c.run.id,c.run.lease_token,'ack',undefined,'SIMULATED:'+c.run.id);
 await repo.repository.step(c.run.id,c.run.lease_token,'finish',{summary:'Local unknown-cost fixture',simulated:true});
 const intact=await repo.journal.reconcile(c.run.id+':finish');assert.equal(intact.status,'FOUND');assert.ok(intact.write);
 assert.equal(intact.write.knownCostMicros,undefined);
 assert.equal((await repo.confirmation(c.run.id+':finish') as {cost_micros:null}).cost_micros,null);
 await repo.journal.commit(intact.write);
 }finally{await f.close();}
});
test('lost commit body survives disk restart and does not repeat provider or create another run',async()=>{
 const f=await fixture(true);try{
 const t=await f.prepare();await f.approve(t.id);
 const r=f.repo();const c=await r.repository.claim(t.id,'fixture');assert.ok(c);
 f.loseNext('raxi_supervised_step');
 await assert.rejects(r.repository.step(c.run.id,c.run.lease_token,'dispatch'));
 await f.restart();
 const recovered=f.repo();assert.equal((await recovered.journal.reconcile(c.run.id+':dispatch')).status,'FOUND');
 await recovered.repository.step(c.run.id,c.run.lease_token,'dispatch');
 assert.equal((await f.execute(t.id)).claimed,false);assert.equal(f.calls,0);
 assert.equal(await f.count('raxi_agent_runs'),1);
 // Local lease expiration is uncertainty, never a retry permit.
 await f.db.query("update public.raxi_agent_runs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[c.run.id]);
 assert.equal((await f.execute(t.id)).claimed,false);assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('journal failure rolls back step/event together and receipt already committed survives restart',async()=>{
 const f=await fixture(true);try{
 const t=await f.prepare();await f.approve(t.id);const r=f.repo(),c=await r.repository.claim(t.id,'fixture');assert.ok(c);
 await r.repository.step(c.run.id,c.run.lease_token,'dispatch');
 await r.repository.step(c.run.id,c.run.lease_token,'ack',undefined,'SIMULATED:'+c.run.id);
 await f.db.exec("reset role;create function public.fail_local_journal() returns trigger language plpgsql as $$begin if new.event_type='SUPERVISED_LOCAL_JOURNAL' then raise exception 'fixture journal unavailable'; end if; return new; end$$; create trigger fail_local_journal before insert on public.raxi_agent_events for each row execute function public.fail_local_journal();set role service_role");
 await assert.rejects(r.repository.step(c.run.id,c.run.lease_token,'finish',{summary:'fixture',sourceIds:[],sources:[],simulated:true,verification:'MODEL_OUTPUT_NOT_FACT_CHECKED'},undefined,0));
 assert.equal((await f.db.query<{status:string}>('select status from public.raxi_agent_runs')).rows[0].status,'RUNNING');
 assert.equal((await f.db.query<{n:string}>("select count(*) n from public.raxi_agent_events where event_type='RUNTIME_RESULT_COMMITTED'")).rows[0].n,0);
 await f.db.exec('reset role;drop trigger fail_local_journal on public.raxi_agent_events;set role service_role');
 await f.restart();
 assert.equal((await f.repo().journal.reconcile(c.run.id+':ack')).status,'FOUND');
 assert.equal((await f.repo().journal.reconcile(c.run.id+':finish')).status,'MISSING');
 assert.equal((await f.execute(t.id)).claimed,false);assert.equal(f.calls,0);
 }finally{await f.close();}
});
test('ownership, anonymous roles and conflicting execution keys cannot cross local accounts/tasks',async()=>{
 const f=await fixture();try{
 const t=await f.prepare();await f.approve(t.id);const other=localSupervisedRepository(f.port,foreign);
 await assert.rejects(other.readTask(t.id));await assert.rejects(other.repository.claim(t.id,'foreign'));
 await assert.rejects(other.approve(t.id,crypto.randomUUID(),t.input_snapshot.supervised.scopeDigest));
 const key=crypto.randomUUID();await f.repo().bindExecution(t.id,key);await f.repo().bindExecution(t.id,key);
 await assert.rejects(f.repo().bindExecution(t.id,crypto.randomUUID()));
 const second=await f.prepare();await f.approve(second.id);await assert.rejects(f.repo().bindExecution(second.id,key));
 await f.db.exec('reset role;set role anon');
 await assert.rejects(f.db.query('select public.raxi_supervised_execute_key($1,$2,$3)',[owner,t.id,key]));
 }finally{await f.close();}
});
test('a lost final confirmation after one simulated call reconciles after restart without repeating the effect',async()=>{
 const f=await fixture(true);try{
 const t=await f.prepare();await f.approve(t.id);f.loseNext('raxi_supervised_step:finish');
 assert.equal((await f.execute(t.id)).uncertain,true);assert.equal(f.calls,1);
 const id=await f.runId(t.id);await f.restart();
 const r=f.repo(),found=await r.journal.reconcile(id+':finish');
 assert.equal(found.status,'FOUND');assert.ok(found.write);
 assert.equal((await r.readTask(t.id)).status,'COMPLETED');
 await r.journal.commit(found.write);
 assert.equal((await f.execute(t.id)).claimed,false);assert.equal(f.calls,1);
 assert.equal(await f.count('raxi_agent_runs'),1);
 }finally{await f.close();}
});
test('persistence failure retains UNKNOWN and receipt; unavailable reconciliation never masquerades as absence',async()=>{
 const f=await fixture(true);try{
 const t=await f.prepare();await f.approve(t.id);f.failNext('raxi_supervised_step:finish');
 assert.equal((await f.execute(t.id)).uncertain,true);assert.equal(f.calls,1);
 const id=await f.runId(t.id);await f.restart();
 assert.equal((await f.db.query<{status:string;provider_receipt:string}>('select status,provider_receipt from public.raxi_agent_runs')).rows[0].status,'UNKNOWN');
 assert.equal((await f.repo().journal.reconcile(id+':ack')).status,'FOUND');
 f.failNext('select e.payload');
 assert.equal((await f.repo().journal.reconcile(id+':finish')).status,'UNAVAILABLE');
 assert.equal((await f.repo().journal.reconcile(id+':finish')).status,'MISSING');
 assert.equal((await f.execute(t.id)).claimed,false);assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('provider/policy mode cannot be upgraded from local simulation and no new code performs network calls',async()=>{
 const f=await fixture();const old=globalThis.fetch;let network=0;
 globalThis.fetch=async()=>{network++;throw Error('Forbidden network');};
 try{
 const t=await f.prepare();await f.approve(t.id);
 await f.db.exec('update public.raxi_runtime_policies set simulated=false');
 await assert.rejects(f.execute(t.id));assert.equal(f.calls,0);
 await f.db.exec('update public.raxi_runtime_policies set simulated=true');
 const next=await f.prepare();await f.approve(next.id);await f.execute(next.id);
 assert.equal(f.calls,1);assert.equal(network,0);
 }finally{globalThis.fetch=old;await f.close();}
});
test('SQL admission itself rejects missing expiry, type coercion and unknown authority fields before writing',async()=>{
 const f=await fixture();try{
 for(const change of [{question:null},{externalResearch:'false'},{permissions:['all']},
  {authorization:{...f.spec.authorization,expiresAt:null}},{authorization:{...f.spec.authorization,approveAll:true}}]){
  const spec={...f.spec,...change};
  await assert.rejects(f.db.query('select public.raxi_supervised_prepare($1,$2,$3,$4,$5,$6,$7)',
   [owner,workspace,crypto.randomUUID(),'DIRECTOR',JSON.stringify(spec),JSON.stringify(spec),null]));
 }
 assert.equal(await f.count('raxi_agent_tasks'),0);assert.equal(await f.count('raxi_approvals'),0);
 }finally{await f.close();}
});

test('journal rows reject UPDATE, DELETE, relabel and TRUNCATE by runtime roles without changing other events',async()=>{
 const f=await fixture();try{
 const t=await f.prepare();await f.approve(t.id);await f.execute(t.id);
 const id=await f.runId(t.id),ref='SUPERVISED_JOURNAL:'+id+':finish';
 await assert.rejects(f.db.query("update public.raxi_agent_events set payload='{}' where source_ref=$1",[ref]),/append-only/);
 await assert.rejects(f.db.query('delete from public.raxi_agent_events where source_ref=$1',[ref]),/append-only/);
 await assert.rejects(f.db.query("update public.raxi_agent_events set event_type='OTHER',source_ref=null where source_ref=$1",[ref]),/append-only/);
 await assert.rejects(f.db.exec('truncate public.raxi_agent_events'),/permission denied/);
 await assert.rejects(f.db.exec('alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable'),/owner/);
 await assert.rejects(f.db.query("update public.raxi_agent_events set event_type='SUPERVISED_LOCAL_JOURNAL' where event_type='RUNTIME_ACKNOWLEDGED'"),/relabel/);
 // Keep existing runtime permissions for unrelated rows.
 await f.db.query("update public.raxi_agent_events set source_ref='LOCAL-UNRELATED' where event_type='RUNTIME_ACKNOWLEDGED'");
 assert.equal((await f.db.query("delete from public.raxi_agent_events where source_ref='LOCAL-UNRELATED' returning id")).rows.length,1);
 assert.equal((await f.repo().journal.reconcile(id+':finish')).status,'FOUND');
 for(const role of ['anon','authenticated']) {
  await f.db.exec('reset role;set role '+role);
  await assert.rejects(f.db.query('delete from public.raxi_agent_events where source_ref=$1',[ref]),/permission denied/);
  await assert.rejects(f.db.query("update public.raxi_agent_events set payload='{}' where source_ref=$1",[ref]),/permission denied/);
 }
 }finally{await f.close();}
});

test('tampered committed finish is rejected by raw SQL replay, repository replay, confirmation and reconciliation after restart',async()=>{
 const f=await fixture(true);try{
 const t=await f.prepare();await f.approve(t.id);await f.execute(t.id);assert.equal(f.calls,1);
 const id=await f.runId(t.id),op=id+':finish',ref='SUPERVISED_JOURNAL:'+op;
 const original=await f.repo().journal.reconcile(op);assert.ok(original.write);
 const state=(await f.db.query<{v:{lease_token:string;result:unknown;journal_version:number}}>('select to_jsonb(r) v from public.raxi_agent_runs r where id=$1',[id])).rows[0].v;
 // Fault injection is administrator-only and deliberately bypasses the row trigger.
 // An application role cannot disable triggers; no such operation exists in the host.
 await f.db.exec('reset role;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable');
 await f.db.query("update public.raxi_agent_events set payload=jsonb_set(payload,'{command,result,summary}','\"tampered fixture\"') where source_ref=$1",[ref]);
 await f.db.exec('alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;set role service_role');
 await f.restart();
 const repo=f.repo(),mutated={...original.write,result:{...(original.write.result as object),summary:'tampered fixture'}};
 await assert.rejects(repo.journal.commit(mutated),/integrity/);
 await assert.rejects(repo.repository.step(id,state.lease_token,'finish',mutated.result,undefined,0),/integrity/);
 await assert.rejects(repo.confirmation(op),/integrity/);
 const reconcile=await repo.journal.reconcile(op);assert.equal(reconcile.status,'CONFLICT');assert.equal(reconcile.write,null);
 await assert.rejects(f.db.query('select public.raxi_supervised_step($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [owner,id,state.lease_token,op,original.write.expectedVersion,'finish',JSON.stringify(mutated.result),null,0]),/integrity/);
 assert.equal((await f.repo().readTask(t.id)).status,'COMPLETED');
 assert.deepEqual((await f.db.query<{result:unknown}>('select result from public.raxi_agent_runs where id=$1',[id])).rows[0].result,state.result);
 assert.equal((await f.execute(t.id)).claimed,false);assert.equal(f.calls,1);
 }finally{await f.close();}
});

test('missing/invalid digest and altered confirmations fail closed; intact journal replay still works',async()=>{
 const f=await fixture();try{
 const t=await f.prepare();await f.approve(t.id);await f.execute(t.id);
 const id=await f.runId(t.id),op=id+':finish',ref='SUPERVISED_JOURNAL:'+op;
 const payload=(await f.db.query<{payload:Record<string,unknown>}>('select payload from public.raxi_agent_events where source_ref=$1',[ref])).rows[0].payload;
 const original=await f.repo().journal.reconcile(op);assert.ok(original.write);
 const withoutDigest=structuredClone(payload);delete (withoutDigest.confirmation as Record<string,unknown>).journal_digest;
 const withoutConfirmationDigest=structuredClone(payload);delete withoutConfirmationDigest.confirmationDigest;
 const variants=[
  withoutDigest,
  withoutConfirmationDigest,
  {...payload,confirmationDigest:null},
  {...payload,confirmationDigest:'0'.repeat(64)},
  {...payload,confirmation:{...(payload.confirmation as object),journal_digest:null}},
  {...payload,confirmation:{...(payload.confirmation as object),journal_digest:'f'.repeat(64)}},
  {...payload,confirmation:{...(payload.confirmation as object),result:{simulated:true,summary:'changed'}}},
  {...payload,command:null},
 ];
 for(const changed of variants){
  await f.db.exec('reset role;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable');
  await f.db.query('update public.raxi_agent_events set payload=$1 where source_ref=$2',[JSON.stringify(changed),ref]);
  await f.db.exec('alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;set role service_role');
  assert.equal((await f.repo().journal.reconcile(op)).status,'CONFLICT');
  await assert.rejects(f.repo().confirmation(op),/integrity/);
  await assert.rejects(f.repo().journal.commit(original.write),/integrity/);
 }
 await f.db.exec('reset role;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable');
 await f.db.query('update public.raxi_agent_events set payload=$1 where source_ref=$2',[JSON.stringify(payload),ref]);
 await f.db.exec('alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;set role service_role');
 assert.equal((await f.repo().journal.reconcile(op)).status,'FOUND');
 assert.equal((await f.repo().journal.commit(original.write)).version,3);
 }finally{await f.close();}
});

test('confirmation content integrity covers dispatch, ack and unknown without rejecting intact historical steps',async()=>{
 const f=await fixture();try{
 const t=await f.prepare();await f.approve(t.id);const repo=f.repo(),c=await repo.repository.claim(t.id,'fixture');assert.ok(c);
 await repo.repository.step(c.run.id,c.run.lease_token,'dispatch');
 await repo.repository.step(c.run.id,c.run.lease_token,'ack',undefined,'SIMULATED:'+c.run.id);
 await repo.repository.step(c.run.id,c.run.lease_token,'unknown',undefined,undefined,0);
 for(const kind of ['dispatch','ack','unknown']){
  const op=c.run.id+':'+kind,ref='SUPERVISED_JOURNAL:'+op;
  const payload=(await f.db.query<{payload:{confirmation:Record<string,unknown>}}>('select payload from public.raxi_agent_events where source_ref=$1',[ref])).rows[0].payload;
  const proof=await repo.journal.reconcile(op);assert.equal(proof.status,'FOUND');assert.ok(proof.write);
  for(const field of ['provider_receipt','result','cost_micros']){
   const changed={...payload,confirmation:{...payload.confirmation,[field]:field==='cost_micros'?17:'ALTERED_LOCAL_FIXTURE'}};
   await f.db.exec('reset role;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable');
   await f.db.query('update public.raxi_agent_events set payload=$1 where source_ref=$2',[JSON.stringify(changed),ref]);
   await f.db.exec('alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;set role service_role');
   await assert.rejects(repo.confirmation(op),/integrity/);
   assert.equal((await repo.journal.reconcile(op)).status,'CONFLICT');
   await assert.rejects(repo.journal.commit(proof.write),/integrity/);
  }
  await f.db.exec('reset role;alter table public.raxi_agent_events disable trigger raxi_supervised_journal_immutable');
  await f.db.query('update public.raxi_agent_events set payload=$1 where source_ref=$2',[JSON.stringify(payload),ref]);
  await f.db.exec('alter table public.raxi_agent_events enable trigger raxi_supervised_journal_immutable;set role service_role');
  assert.equal((await repo.journal.reconcile(op)).status,'FOUND');
  await repo.journal.commit(proof.write);
 }
 }finally{await f.close();}
});
