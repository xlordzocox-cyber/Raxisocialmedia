/** Request handler only. No listener, scheduler, public endpoint or real provider registration. */
import { runOne } from './runtime';
import { simulatedProvider } from './providers';
import type { LocalAdmissionPorts } from './supervisedHostContracts';
import { localId, localSupervisedRepository, type LocalPostgresPort } from './localSupervisedRepository';
import { supabaseSupervisedRepository } from './supabaseSupervisedRepository';
import type { supabaseSupervisedAuth, ServerRpcPort } from './supabaseSupervisedAuth';

export function createLocalSupervisedHost(deps:{database:LocalPostgresPort;identify:LocalAdmissionPorts['identify']}) {
 if(deps.database.provenance!=='LOCAL_POSTGRES_FIXTURE')throw Error('Stage A local persistence required');
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  const session=/^Bearer (\S{1,200})$/.exec(request.headers.get('authorization')??'')?.[1];
  if(!session)return new Response(null,{status:401});
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return new Response(null,{status:415});
  try {
   const body=await readSupervisedCommand(request);if(body instanceof Response)return body;
   localId(body.workspaceId);
   const identify=async()=>{
    const proof=structuredClone(await deps.identify(session,body.workspaceId));
    if(!proof||proof.provenance!=='LOCAL_FIXTURE'||proof.anonymous!==false||proof.workspaceId!==body.workspaceId
     ||proof.ownerId!==proof.operatorId||!Array.isArray(proof.capabilities)||!proof.capabilities.includes('TEXT_RESEARCH')
     ||!Number.isFinite(Date.parse(proof.expiresAt))||!Number.isFinite(Date.now())||Date.parse(proof.expiresAt)<=Date.now())throw Error('Local identity denied');
    localId(proof.operatorId);return proof.operatorId;
   };
   const owner=await identify(), port=localSupervisedRepository(deps.database,owner,async()=>{if(await identify()!==owner)throw Error('Account changed');});
   if(body.action==='prepare') {
    if(!['DIRECTOR','RESEARCHER'].includes(body.stage))throw Error('Stage required');
    const task=await port.prepare(body.workspaceId,body.key,body.stage,body.spec,body.parentRunId??null);
    return reply({task});
   }
   const task=await port.readTask(body.taskId);if(task.workspace_id!==body.workspaceId)throw Error('Workspace conflict');
   if(body.action==='reconcile') {
    if(typeof body.operationId!=='string'||!/^[-a-f0-9]{36}:(dispatch|ack|finish|unknown)$/.test(body.operationId))throw Error('Operation required');
    // A task-scoped lookup prevents receipt access through a foreign operation ID.
    const runId=body.operationId.split(':')[0];localId(runId);
    const result=await deps.database.query<{task_id:string}>('select task_id from public.raxi_agent_runs where id=$1 and workspace_id=$2',[runId,body.workspaceId]);
    if(result.rows[0]?.task_id!==task.id)throw Error('Operation task conflict');
    return reply({reconciliation:await port.journal.reconcile(body.operationId),confirmation:await port.confirmation(body.operationId)});
   }
   if(body.confirmed!==true)throw Error('Manual confirmation required');
   if(body.action==='approve'||body.action==='revoke')return reply({task:await port.approve(task.id,body.key,body.scopeDigest,body.action==='revoke')});
   await port.bindExecution(task.id,body.key);
   // Existing coordinator; one explicit call, no automatic Director -> Researcher continuation.
   const result=await runOne({repository:port.repository,providers:new Map([['simulated',simulatedProvider]]),workerId:'LOCAL-STAGE-A'},task.id);
   return reply({result,task:await port.readTask(task.id)});
  } catch {return Response.json({error:'Local simulation command rejected or not confirmed'},{status:403,headers:{'Cache-Control':'no-store'}});}
 };
}
function reply(value:object) {
 return Response.json({kind:'LOCAL_SIMULATION_ONLY',provenance:'LOCAL_FIXTURE',persistence:'LOCAL_POSTGRES',liveEnabled:false,...value},{headers:{'Cache-Control':'no-store'}});
}

/** Same closed wire contract for both hosts. No token/identity fields in the body. */
async function readSupervisedCommand(request:Request) {
 const reader=request.body?.getReader();if(!reader)throw Error('Body missing');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>8192){await reader.cancel();return new Response(null,{status:413});}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 const fields:Record<string,string[]>={prepare:['action','workspaceId','key','stage','spec','parentRunId'],approve:['action','workspaceId','key','taskId','scopeDigest','confirmed'],
  revoke:['action','workspaceId','key','taskId','scopeDigest','confirmed'],execute:['action','workspaceId','key','taskId','confirmed'],reconcile:['action','workspaceId','taskId','operationId']};
 if(!body||Array.isArray(body)||typeof body!=='object'||!Object.hasOwn(fields,body.action)||Object.keys(body).some(k=>!fields[body.action].includes(k)))throw Error('Closed command required');
 localId(body.workspaceId);return body;
}

/** No listener or UI registration. Hosting/credentials remain a separate B2 approval. */
export function createSupabaseSupervisedHost(deps:{identify:ReturnType<typeof supabaseSupervisedAuth>;server:ServerRpcPort;liveEnabled:false}) {
 if(deps.liveEnabled!==false)throw Error('REAL disabled');
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  const token=/^Bearer (\S{1,16384})$/.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)return new Response(null,{status:401});
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return new Response(null,{status:415});
  try {
   const body=await readSupervisedCommand(request);if(body instanceof Response)return body;
   const identity=await deps.identify(token,body.workspaceId);
   const port=supabaseSupervisedRepository({server:deps.server,identity,revalidate:()=>deps.identify(token,body.workspaceId),liveEnabled:false});
   const replyHosted=(value:object)=>Response.json({kind:'STAGING_SIMULATION_ONLY',identitySource:'SUPABASE_AUTH_STAGING',execution:'SIMULATED',liveEnabled:false,...value},{headers:{'Cache-Control':'no-store'}});
   if(body.action==='prepare')return replyHosted({task:await port.prepare(body.key,body.stage,body.spec,body.parentRunId??null)});
   const task=await port.readTask(body.taskId);if(task.workspace_id!==body.workspaceId)throw Error('Workspace conflict');
   if(body.action==='reconcile')return replyHosted({reconciliation:await port.reconcile(task.id,body.operationId)});
   if(body.confirmed!==true)throw Error('Human confirmation required');
   if(body.action==='approve'||body.action==='revoke')return replyHosted({task:await port.approve(task.id,body.key,body.scopeDigest,body.action==='revoke')});
   await port.bindExecution(task.id,body.key);
   const result=await runOne({repository:port.repository,providers:new Map([['simulated',simulatedProvider]]),workerId:'SUPERVISED-STAGING',liveEnabled:false},task.id);
   return replyHosted({result,task:await port.readTask(task.id)});
  }catch{return Response.json({error:'Supervised staging command rejected or not confirmed'},{status:403,headers:{'Cache-Control':'no-store'}});}
 };
}
