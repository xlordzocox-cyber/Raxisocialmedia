/** Server-only ports. No client construction, connection, secrets or network on import. */
import { localId } from './localSupervisedRepository';
export const PRODUCTION_PROJECT = 'jrkefsylpfriiqefcmzq';
export interface HostedIdentity {
 provenance:'SUPABASE_AUTH_STAGING'; actorId:string; sessionId:string; workspaceId:string;
 projectRef:string; expiresAt:string;
}
export interface UserAuthPort {
 getClaims(token:string):PromiseLike<{data:{claims:Record<string,unknown>}|null;error:unknown}>;
 getUser(token:string):PromiseLike<{data:{user:{id:string;is_anonymous?:boolean}|null};error:unknown}>;
}
export interface ServerRpcPort {
 rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
}
export function stagingProject(ref:string) {
 if(!/^[a-z]{20}$/.test(ref)||ref===PRODUCTION_PROJECT)throw Error('Isolated staging project required');
 return ref;
}
/** getClaims must be the expected-project SDK verifier, never a JWT decoder.
 * The privileged session RPC reads auth.sessions on EACH invocation; no positive cache.
 * Neither a structural port nor its returned provenance is proof outside the trusted server.
 */
export function supabaseSupervisedAuth(deps:{projectRef:string;auth:UserAuthPort;server:ServerRpcPort}) {
 if(typeof window!=='undefined')throw Error('Server-only authentication');
 const ref=stagingProject(deps.projectRef);
 if((deps.auth as unknown)===deps.server)throw Error('Separate user and privileged clients required');
 return async(token:string,workspaceId:string):Promise<Readonly<HostedIdentity>>=>{
  localId(workspaceId);
  if(typeof token!=='string'||!token||token.length>16384||/\s/.test(token))throw Error('Session required');
  const claims=await deps.auth.getClaims(token);
  if(claims.error||!claims.data)throw Error('Identity not confirmed');
  const c=structuredClone(claims.data.claims), now=Date.now();
  if(c.iss!==`https://${ref}.supabase.co/auth/v1`||c.aud!=='authenticated'||c.role!=='authenticated'||c.is_anonymous!==false||
   !Number.isSafeInteger(c.exp)||!Number.isSafeInteger(c.iat)||(c.iat as number)*1000>now||
   (c.exp as number)*1000<=now||(c.nbf!==undefined&&(!Number.isSafeInteger(c.nbf)||(c.nbf as number)*1000>now)))throw Error('Claims denied');
  localId(c.sub);localId(c.session_id);
  const user=await deps.auth.getUser(token);
  if(user.error||!user.data.user||user.data.user.id!==c.sub||user.data.user.is_anonymous!==false)throw Error('User denied');
  const identity:HostedIdentity={provenance:'SUPABASE_AUTH_STAGING',actorId:c.sub,sessionId:c.session_id,workspaceId,projectRef:ref,
   expiresAt:new Date((c.exp as number)*1000).toISOString()};
  const current=await deps.server.rpc('raxi_supervised_host_identity',{p_identity:identity});
  if(current.error||current.data!==true||Date.parse(identity.expiresAt)<=Date.now())throw Error('Session or owner not confirmed');
  return Object.freeze(identity);
 };
}
