/** Issue #49 — concrete, unmounted pre-JWT admission for the Director path.
 * No in-memory quotas, user headers, raw IP storage, provider or network on
 * import. The caller's rateKey MUST originate at a trusted host boundary.
 * SQL's global + client locks enforce concurrency across Node instances.
 */
import type {IngressAdmissionPort} from './stagingNodeAuthIngress';

export interface PreauthSqlPort {
 rpc(name:'raxi_director_preauth_admit',args:{p_client_digest:string}):
 PromiseLike<{data:unknown;error:unknown}>;
}
export interface DirectorPreauthConfig {
 /** Distinct random server secret, never publishable or service-role key.
  * Persist this one key across Node hosts; rotation resets per-client quota. */
 hmacSecret:string;
 server:PreauthSqlPort;
}
const RPC='raxi_director_preauth_admit' as const;
const RATE_KEY=/^[A-Za-z0-9:_-]{8,128}$/;

/** Fail-closed SQL admission, with only an HMAC-SHA256 digest sent to PG.
 * No local success cache: EVERY request must reach the database.
 */
export function createDirectorSqlPreauthAdmission(config:DirectorPreauthConfig):IngressAdmissionPort {
 if(typeof window!=='undefined')throw Error('Server-only preauth limiter');
 if(!config||typeof config.hmacSecret!=='string'||
  config.hmacSecret.length<32||config.hmacSecret.length>256||
  !config.server||typeof config.server.rpc!=='function')
  throw Error('Explicit server HMAC secret and SQL port required');
 if(!crypto?.subtle)throw Error('Cryptographic HMAC required');
 const secret=new TextEncoder().encode(config.hmacSecret);
 return {
  async admit(rateKey:string):Promise<'ALLOW'|'DENY'> {
   if(typeof rateKey!=='string'||!RATE_KEY.test(rateKey))
    throw Error('Trusted ingress identity required');
   // Domain separation prevents this digest being confused with any
   // other signing workflow using the same key material.
   const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const bytes=new TextEncoder().encode('RAXI-HQ/DIRECTOR-PREAUTH/V1:'+rateKey);
   const signed=await crypto.subtle.sign('HMAC',key,bytes);
   const digest=Array.from(new Uint8Array(signed),v=>v.toString(16).padStart(2,'0')).join('');
   const r=await config.server.rpc(RPC,{p_client_digest:digest});
   if(r.error||!r.data||typeof r.data!=='object'||Array.isArray(r.data)||
    Object.keys(r.data).length!==1)return Promise.reject(Error('SQL preauth response denied'));
   const result=r.data as {status?:unknown};
   if(result.status==='ALLOWED')return 'ALLOW';
   if(result.status==='RATE_LIMITED')return 'DENY';
   throw Error('SQL preauth response denied');
  },
 };
}
