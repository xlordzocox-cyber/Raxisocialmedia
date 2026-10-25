/** Stage A local PostgreSQL port. No connection string, hosted client, secrets or provider transport. */
import { taskSpec, type Claim, type RuntimeRepository, type TaskSpec } from './runtime';
import type { SupervisedJournalPort, SupervisedJournalWrite, SupervisedStage } from './supervisedHostContracts';

export interface LocalPostgresPort {
 provenance:'LOCAL_POSTGRES_FIXTURE';
 query<T>(sql:string,parameters?:unknown[]):Promise<{rows:T[]}>;
}
export interface LocalTask {
 id:string;workspace_id:string;status:string;
 input_snapshot:{spec:TaskSpec;supervised:{stage:SupervisedStage;approvalId?:string;scopeDigest:string;requestSha256:string;parentRunId:string|null}};
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function localId(value:unknown):asserts value is string {if(typeof value!=='string'||!uuid.test(value))throw Error('Invalid local identifier');}
export function canonicalLocalSpec(value:unknown):TaskSpec {
 const s=taskSpec(value);
 if(s.provider!=='simulated'||s.externalResearch!==false||s.authorization.maxCostMicros>10000)throw Error('Local simulation only');
 return {question:s.question,externalResearch:false,provider:'simulated',model:s.model,
  authorization:{confirmed:true,maxCostMicros:s.authorization.maxCostMicros,expiresAt:s.authorization.expiresAt}};
}
export function localSupervisedRepository(db:LocalPostgresPort,owner:string,beforeDispatch:()=>Promise<void>=async()=>{}) {
 if(db.provenance!=='LOCAL_POSTGRES_FIXTURE')throw Error('Local PostgreSQL fixture port required');
 localId(owner);
 const call=async<T>(name:string,values:unknown[])=>{
  const result=await db.query<{v:T}>(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) v`,
   values.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));
  if(!result.rows[0])throw Error('Local commit not confirmed');return result.rows[0].v;
 };
 const task=async(id:string):Promise<LocalTask>=>{
  localId(id);
  const r=await db.query<{v:LocalTask}>(`select to_jsonb(t) v from public.raxi_agent_tasks t join public.raxi_workspaces w on w.id=t.workspace_id
   where t.id=$1 and w.owner_user_id=$2 and t.input_snapshot#>>'{supervised,provenance}'='LOCAL_FIXTURE'`,[id,owner]);
  if(!r.rows[0])throw Error('Local task unavailable');return r.rows[0].v;
 };
 const run=async(id:string)=>{
  localId(id);
  const r=await db.query<{v:{id:string;task_id:string;workspace_id:string;attempt:number;lease_token:string;journal_version:number}}>(
   `select to_jsonb(r) v from public.raxi_agent_runs r join public.raxi_workspaces w on w.id=r.workspace_id
    join public.raxi_agent_tasks t on t.id=r.task_id where r.id=$1 and w.owner_user_id=$2 and r.simulated
    and t.input_snapshot#>>'{supervised,provenance}'='LOCAL_FIXTURE'`,[id,owner]);
  if(!r.rows[0])throw Error('Local run unavailable');return r.rows[0].v;
 };
 const operation=async(operationId:string)=>{
  const r=await db.query<{payload:{command:{expectedVersion:number;kind:SupervisedJournalWrite['event'];result:unknown;receipt:string|null;cost:number|null};confirmation:unknown}}>(
   `select e.payload from public.raxi_agent_events e join public.raxi_workspaces w on w.id=e.workspace_id
    where e.source_ref=$1 and w.owner_user_id=$2 and e.source_kind='MOCK' and e.evidence_status='UNVERIFIED'`,
   ['SUPERVISED_JOURNAL:'+operationId,owner]);return r.rows[0]?.payload;
 };
 const journal:SupervisedJournalPort={
  async commit(value) {
   const w=structuredClone(value);
   if(w.simulated!==true||w.sourceKind!=='MOCK'||w.evidenceStatus!=='UNVERIFIED'||w.response!==null
    ||w.operatorId!==owner||w.attempt!==1||!Number.isSafeInteger(w.expectedVersion)||w.expectedVersion<0
    ||Object.keys(w).some(k=>!['operationId','expectedVersion','taskId','workspaceId','runId','attempt','operatorId','approvalId','scopeDigest','requestSha256','event','response','simulated','sourceKind','evidenceStatus','result','receipt','knownCostMicros'].includes(k)))
    throw Error('Local journal evidence required');
   const r=await run(w.runId), t=await task(r.task_id), b=t.input_snapshot.supervised;
   if(w.taskId!==t.id||w.workspaceId!==t.workspace_id||w.approvalId!==b.approvalId||w.scopeDigest!==b.scopeDigest||w.requestSha256!==b.requestSha256
    ||w.operationId!==w.runId+':'+w.event)throw Error('Journal binding conflict');
   const confirmation=await call<{journal_version:number;journal_digest:string}>('raxi_supervised_step',
    [owner,w.runId,r.lease_token,w.operationId,w.expectedVersion,w.event,w.result??null,w.receipt??null,w.knownCostMicros??null]);
   return {operationId:w.operationId,version:confirmation.journal_version,committedDigest:confirmation.journal_digest};
  },
  async reconcile(operationId) {
   if(typeof operationId!=='string'||!/^[-a-f0-9]{36}:(dispatch|ack|finish|unknown)$/.test(operationId))throw Error('Invalid journal operation');
   try {
   const found=await operation(operationId);
   if(!found)return {status:'MISSING',write:null};
   const r=await run(operationId.split(':')[0]),t=await task(r.task_id),b=t.input_snapshot.supervised,c=found.command;
   return {status:'FOUND',write:{operationId,expectedVersion:c.expectedVersion,taskId:t.id,workspaceId:t.workspace_id,runId:r.id,attempt:1,
    operatorId:owner,approvalId:b.approvalId!,scopeDigest:b.scopeDigest,requestSha256:b.requestSha256,event:c.kind,response:null,
    simulated:true,sourceKind:'MOCK',evidenceStatus:'UNVERIFIED',...(c.result===null?{}:{result:c.result}),
    ...(c.receipt===null?{}:{receipt:c.receipt}),...(c.cost===null?{}:{knownCostMicros:c.cost})}};
   } catch {return {status:'UNAVAILABLE',write:null};}
  },
 };
 const repository:RuntimeRepository={
  request:async()=>{throw Error('Use independent local preparation and approval');},
  async claim(id,worker) {await task(id);return call<Claim|null>('raxi_runtime_claim',[id,worker]);},
  async step(id,token,event,result,receipt,cost) {
   if(event==='dispatch')await beforeDispatch();
   const r=await run(id),t=await task(r.task_id),b=t.input_snapshot.supervised;
   if(r.lease_token!==token)throw Error('Lease denied');
   const operationId=id+':'+event, found=await operation(operationId);
   const write:SupervisedJournalWrite={operationId,expectedVersion:found?.command.expectedVersion??r.journal_version,
    taskId:t.id,workspaceId:t.workspace_id,runId:id,attempt:1,operatorId:owner,approvalId:b.approvalId!,
    scopeDigest:b.scopeDigest,requestSha256:b.requestSha256,event,response:null,simulated:true,sourceKind:'MOCK',evidenceStatus:'UNVERIFIED',
    ...(result===undefined?{}:{result}),...(receipt===undefined?{}:{receipt}),...(cost===undefined?{}:{knownCostMicros:cost})};
   await journal.commit(write);
   return (await operation(operationId))?.confirmation;
  },
 };
 return {repository,journal,readTask:task,
  async prepare(workspace:string,key:string,stage:SupervisedStage,value:unknown,parentRunId:string|null=null) {
   localId(workspace);localId(key);if(parentRunId!==null)localId(parentRunId);
   const spec=canonicalLocalSpec(value);
   return call<LocalTask>('raxi_supervised_prepare',[owner,workspace,key,stage,spec,JSON.stringify(spec),parentRunId]);
  },
  async approve(id:string,key:string,digest:string,revoke=false) {
   localId(id);localId(key);if(!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid scope digest');
   return call<LocalTask>('raxi_supervised_approve',[owner,id,key,digest,revoke]);
  },
  async bindExecution(id:string,key:string) {localId(id);localId(key);await call('raxi_supervised_execute_key',[owner,id,key]);},
  async confirmation(operationId:string) {return (await operation(operationId))?.confirmation??null;},
 };
}
