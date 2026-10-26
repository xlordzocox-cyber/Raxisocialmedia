/** Hosted RPC adapter, preparatory only; no client or provider is created here. */
import type { RuntimeRepository } from './runtime';
import { canonicalLocalSpec, localId, type LocalTask } from './localSupervisedRepository';
import type { SupervisedStage } from './supervisedHostContracts';
import type { HostedIdentity, ServerRpcPort } from './supabaseSupervisedAuth';
import { stagingProject } from './supabaseSupervisedAuth';
export function supabaseSupervisedRepository(deps:{server:ServerRpcPort;identity:Readonly<HostedIdentity>;revalidate:()=>Promise<Readonly<HostedIdentity>>;liveEnabled:false}) {
 if(typeof window!=='undefined')throw Error('Server-only repository');
 if(deps.liveEnabled!==false)throw Error('REAL disabled');
 const identity=structuredClone(deps.identity);stagingProject(identity.projectRef);
 if(identity.provenance!=='SUPABASE_AUTH_STAGING')throw Error('Hosted identity required');
 localId(identity.actorId);localId(identity.sessionId);localId(identity.workspaceId);
 const invoke=async<T>(action:string,args:Record<string,unknown>,fresh=true):Promise<T>=>{
  if(fresh){const next=await deps.revalidate();
   if(next.provenance!==identity.provenance||next.actorId!==identity.actorId||next.sessionId!==identity.sessionId||
    next.projectRef!==identity.projectRef||next.workspaceId!==identity.workspaceId||Date.parse(next.expiresAt)<=Date.now())throw Error('Session changed');}
  const r=await deps.server.rpc('raxi_supervised_host_command',{p_identity:identity,p_action:action,p_args:args});
  if(r.error||(r.data===null&&action!=='claim'))throw Error('Supervised operation not confirmed');return r.data as T;
 };
 const repository:RuntimeRepository={
  request:async()=>{throw Error('Independent preparation and approval required');},
  claim:(task,worker)=>invoke('claim',{taskId:task,worker}),
  step:(run,token,kind,result,receipt,cost)=>invoke('step',{runId:run,token,kind,result:result??null,receipt:receipt??null,cost:cost??null},kind==='dispatch'),
 };
 return {repository,
  readTask:(taskId:string)=>invoke<LocalTask>('readTask',{taskId}),
  prepare:(key:string,stage:SupervisedStage,spec:unknown,parentRunId:string|null=null)=>{
   localId(key);if(!['DIRECTOR','RESEARCHER'].includes(stage))throw Error('Stage required');
   return invoke<LocalTask>('prepare',{key,stage,spec:canonicalLocalSpec(spec),parentRunId});
  },
  approve:(taskId:string,key:string,scopeDigest:string,revoke=false)=>invoke<LocalTask>('approve',{taskId,key,scopeDigest,revoke}),
  bindExecution:(taskId:string,key:string)=>invoke('bindExecution',{taskId,key}),
  reconcile:(taskId:string,operationId:string)=>invoke<{status:'FOUND'|'MISSING'|'CONFLICT';confirmation:unknown}>('reconcile',{taskId,operationId}),
 };
}
