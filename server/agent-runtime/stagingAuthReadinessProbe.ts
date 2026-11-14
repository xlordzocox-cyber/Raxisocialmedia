/** Server-side auth readiness only. No listener, scheduler, provider or execution port.
 * This handler does not create tasks, approvals, runs, policies or receipts.
 * It MAY be mounted in staging only after a separate deployment authorization.
 */
import { localId } from './localSupervisedRepository';
import type { supabaseSupervisedAuth } from './supabaseSupervisedAuth';

const STAGING_PROJECT_REF='zvhxjindgyvtasstfjut' as const;

const HEADERS = {
 'Cache-Control': 'no-store, private',
 'Content-Type': 'application/json; charset=utf-8',
 'X-Content-Type-Options': 'nosniff',
} as const;

function reply(status:number,value:Record<string,unknown>):Response {
 return new Response(JSON.stringify(value),{status,headers:HEADERS});
}

/** Closed, bounded body: exactly {workspaceId: UUID}. No identity, token,
 * claimed owner, capabilities or action accepted from the caller.
 */
async function workspaceFromRequest(request:Request):Promise<string> {
 const reader=request.body?.getReader();
 if(!reader)throw Error('Missing body');
 const parts:Uint8Array[]=[];let length=0;
 for(;;) {
  const {done,value}=await reader.read();
  if(done)break;
  length+=value.byteLength;
  if(length>256){await reader.cancel();throw Error('Body too large');}
  parts.push(value);
 }
 const bytes=new Uint8Array(length);let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).length!==1||!Object.hasOwn(body,'workspaceId'))throw Error('Closed schema required');
 const workspaceId=(body as {workspaceId:unknown}).workspaceId;
 if(typeof workspaceId!=='string')throw Error('Workspace required');
 localId(workspaceId);
 return workspaceId;
}

/** Explicit fail-closed feature gates are part of construction; no host will
 * be instantiated with live actions/providers via this read-only factory.
 */
export function createStagingAuthReadinessProbe(deps:{
 identify:ReturnType<typeof supabaseSupervisedAuth>;
 liveEnabled:false;
 providersEnabled:false;
 actionsEnabled:false;
}): (request:Request)=>Promise<Response> {
 if(typeof window!=='undefined')throw Error('Server-only readiness probe');
 if(deps.liveEnabled!==false||deps.providersEnabled!==false||deps.actionsEnabled!==false)
  throw Error('Read-only staging gates required');
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return reply(405,{error:'Method not allowed'});
  const bearer=request.headers.get('authorization')??'';
  const token=/^Bearer (\S{1,16384})$/.exec(bearer)?.[1];
  if(!token)return reply(401,{error:'Authentication required'});
  const type=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(type!=='application/json')return reply(415,{error:'JSON required'});
  try {
   const workspaceId=await workspaceFromRequest(request);
   // The existing trusted verifier checks Supabase getClaims/getUser and
   // raxi_supervised_host_identity via service_role with live session+owner.
   const proof=await deps.identify(token,workspaceId);
   if(proof.provenance!=='SUPABASE_AUTH_STAGING'||proof.projectRef!==STAGING_PROJECT_REF||proof.workspaceId!==workspaceId||
    !Number.isFinite(Date.parse(proof.expiresAt))||Date.parse(proof.expiresAt)<=Date.now())
    throw Error('Auth proof invalid');
   return reply(200,{
    kind:'RAXI_STAGING_AUTH_READINESS',
    authenticatedOwner:true,readOnly:true,hostEnabled:false,
    actionsEnabled:false,providersEnabled:false,executionEnabled:false,
   });
  } catch {
   // Never echo bearer, actor ID, session ID, workspace ID or detailed
   // database/Auth errors. Do not log authentication tokens.
   return reply(403,{error:'Session or workspace not authorized'});
  }
 };
}
