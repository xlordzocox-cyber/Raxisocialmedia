/** Issue #49 — unmounted server-only Director REAL gate STATUS.
 * Reads persisted authorization only; no prepare, approve, revoke, dispatch,
 * worker, runOne, provider, payment, UI route, scheduler or task write.
 * Existing PostgreSQL rate admission may update ONLY its rate counter.
 */
import {localId} from './localSupervisedRepository';
import type {HostedIdentity,ServerRpcPort} from './supabaseSupervisedAuth';

const REF='zvhxjindgyvtasstfjut';
const RATE_RPC='raxi_supervised_request_rate_admit';
const READ_RPC='raxi_director_real_read';
const HEADERS={
 'Cache-Control':'no-store, private','Content-Type':'application/json; charset=utf-8',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Cross-Origin-Resource-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'none'",
} as const;

type VerifyOwner=(token:string,workspaceId:string)=>Promise<Readonly<HostedIdentity>>;
export interface DirectorReadinessPorts {
 identify:VerifyOwner;
 /** The allowlisted service-role client must NOT expose arbitrary RPCs. */
 server:ServerRpcPort;
 liveEnabled:false;
 actionsEnabled:false;
 providersEnabled:false;
}
function answer(status:number,value:Record<string,unknown>):Response {
 return new Response(JSON.stringify(value),{status,headers:HEADERS});
}
function closed(obj:unknown,keys:readonly string[]):obj is Record<string,unknown> {
 return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&Object.keys(obj).every(k=>keys.includes(k));
}
async function readBody(request:Request):Promise<{workspaceId:string;taskId:string}> {
 const reader=request.body?.getReader();if(!reader)throw Error('Missing body');
 const chunks:Uint8Array[]=[];let n=0;
 for(;;){const c=await reader.read();if(c.done)break;n+=c.value.byteLength;
  if(n>512){await reader.cancel();throw Error('Too long');}chunks.push(c.value);}
 const bytes=new Uint8Array(n);let i=0;
 for(const c of chunks){bytes.set(c,i);i+=c.length;}
 const obj:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!closed(obj,['workspaceId','taskId'])||typeof obj.workspaceId!=='string'||
  typeof obj.taskId!=='string')throw Error('Closed read only');
 localId(obj.workspaceId);localId(obj.taskId);
 return {workspaceId:obj.workspaceId,taskId:obj.taskId};
}
function validProof(proof:HostedIdentity,workspaceId:string):boolean {
 if(!closed(proof,['provenance','actorId','sessionId','workspaceId','projectRef','expiresAt']))return false;
 try{localId(proof.actorId);localId(proof.sessionId);}catch{return false;}
 return proof.provenance==='SUPABASE_AUTH_STAGING'&&proof.projectRef===REF&&
  proof.workspaceId===workspaceId&&Number.isFinite(Date.parse(proof.expiresAt))&&
  Date.parse(proof.expiresAt)>Date.now()+60_000;
}
function trustedProjection(value:unknown,identity:HostedIdentity,taskId:string):boolean {
 if(!closed(value,['provenance','taskId','workspaceId','stage','simulated','state',
  'spec','scopeSha256','approval','policy']))return false;
 const a=value.approval;
 return value.provenance==='TRUSTED_SERVER_SNAPSHOT'&&
  value.taskId===taskId&&value.workspaceId===identity.workspaceId&&
  value.stage==='DIRECTOR'&&value.simulated===false&&
  value.state==='READY_FOR_MANUAL_EXECUTION'&&
  typeof value.scopeSha256==='string'&&/^[a-f0-9]{64}$/.test(value.scopeSha256)&&
  closed(a,['provenance','taskId','workspaceId','operatorId','sessionId','decision',
   'revoked','scopeSha256','policyVersion','provider','model','maxCostMicros',
   'issuedAt','expiresAt'])&&
  a.provenance==='PERSISTED_HUMAN_EXECUTION_APPROVAL'&&
  a.taskId===taskId&&a.workspaceId===identity.workspaceId&&
  a.operatorId===identity.actorId&&a.sessionId===identity.sessionId&&
  a.decision==='APPROVED'&&a.revoked===false&&a.scopeSha256===value.scopeSha256;
}
/** Trust boundary: every operation checks hosted JWT/owner/session twice;
 * database admission is durable, atomic and shared across server instances.
 * There is no frontend call path until explicitly reviewed and deployed.
 */
export function createUnpublishedDirectorRealReadiness(deps:DirectorReadinessPorts) {
 if(typeof window!=='undefined')throw Error('Node server only');
 if(!deps||deps.liveEnabled!==false||deps.actionsEnabled!==false||
  deps.providersEnabled!==false||typeof deps.identify!=='function'||
  !deps.server||typeof deps.server.rpc!=='function')
  throw Error('Non-executable server-only ports required');
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return answer(405,{error:'Method not allowed'});
  const token=/^Bearer (\S{1,16384})$/.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)return answer(401,{error:'Authentication required'});
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
   return answer(415,{error:'JSON required'});
  let body:{workspaceId:string;taskId:string};
  try{body=await readBody(request);}catch{return answer(403,{error:'Readiness request denied'});}
  let first:HostedIdentity;
  try{first=structuredClone(await deps.identify(token,body.workspaceId));
   if(!validProof(first,body.workspaceId))throw Error('Owner denied');
  }catch{return answer(403,{error:'Owner session denied'});}
  // Server-side atomic admission: the only persistence is a rate counter.
  // No user-provided identity, price, policy or scope enters SQL.
  let rate:unknown;
  try{const r=await deps.server.rpc(RATE_RPC,{p_identity:first,p_operation:'PREFLIGHT'});
   if(r.error)throw Error('Rate RPC error');rate=r.data;
  }catch{return answer(503,{error:'Readiness service unavailable'});}
  if(!closed(rate,['status','operation'])&&
     !closed(rate,['status','operation','retryAfterSeconds']))
    return answer(503,{error:'Readiness service unavailable'});
  if(rate.operation!=='PREFLIGHT')return answer(503,{error:'Readiness service unavailable'});
  if(rate.status==='RATE_LIMITED')return answer(429,{error:'Rate limited'});
  if(rate.status!=='ALLOWED')return answer(503,{error:'Readiness service unavailable'});
  let data:unknown;
  try{const r=await deps.server.rpc(READ_RPC,{p_identity:first,p_task_id:body.taskId});
   if(r.error)throw Error('Read RPC error');data=r.data;
  }catch{return answer(503,{error:'Readiness service unavailable'});}
  let last:HostedIdentity;
  try{last=structuredClone(await deps.identify(token,body.workspaceId));
   if(!validProof(last,body.workspaceId)||last.actorId!==first.actorId||
     last.sessionId!==first.sessionId||last.projectRef!==first.projectRef)
    throw Error('Changed session');
  }catch{return answer(403,{error:'Owner session denied'});}
  if(data!==null&&!trustedProjection(data,last,body.taskId))
   return answer(503,{error:'Readiness service unavailable'});
  return answer(200,{
   kind:'RAXI_DIRECTOR_REAL_LEDGER_READINESS',persistedApprovalVisible:data!==null,
   readOnly:true,hostMounted:false,liveEnabled:false,
   actionsEnabled:false,providersEnabled:false,executionEnabled:false,
   providerCalls:0,
  });
 };
}
