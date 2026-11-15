/** Issue #60 — inert, Node-only ingress for the unpublished Auth readiness handler.
 * NOT a Vercel/Express route: no api/ file, listener, scheduler, SQL, tasks,
 * provider or runOne call. Publishing requires a separately reviewed adapter.
 */
export const STAGING_AUTH_DIAGNOSTIC_PATH='/api/raxi-hq/runtime-auth-readiness' as const;
/** Explicit second allowlisted path; no arbitrary route/path injection. */
export const STAGING_DIRECTOR_READINESS_PATH='/api/raxi-hq/director-real-readiness' as const;

const BASE_HEADERS={
 'Cache-Control':'no-store, private',
 'Content-Type':'application/json; charset=utf-8',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Cross-Origin-Resource-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'none'",
 'Vary':'Origin',
} as const;

export interface TrustedIngressContext {
 /** Trusted server-provided rate key; NEVER derive directly from request headers. */
 rateKey:string;
}
export interface IngressAdmissionPort {
 /** Requires an external bounded, atomic, cross-instance limiter at hosting time. */
 admit(rateKey:string):Promise<'ALLOW'|'DENY'>;
}
export interface UnpublishedIngressConfig {
 /** Closed set of inert routes; defaults to the original Auth diagnostic. */
 path?:typeof STAGING_AUTH_DIAGNOSTIC_PATH|typeof STAGING_DIRECTOR_READINESS_PATH;
 /** Exact approved HTTPS staging Preview origin, not a wildcard or request header. */
 approvedOrigin:string;
 admission:IngressAdmissionPort;
 /** Previously constructed Auth handler (Node SDK). Never a task handler. */
 authenticationHandler:(request:Request)=>Promise<Response>;
}

function response(status:number,code:string,extra?:Record<string,string>):Response {
 return new Response(JSON.stringify({error:code}),{status,headers:{...BASE_HEADERS,...extra}});
}
export function exactStagingOrigin(value:string):boolean {
 if(typeof value!=='string'||value.length>200||!value.startsWith('https://'))return false;
 try {
  const url=new URL(value);
  // Accept only a concrete deployment URL within this known staging team.
  // The exact origin must additionally be approved by the future host operator.
  return url.origin===value&&url.protocol==='https:'&&url.username===''&&url.password===''&&
   url.port===''&&url.hostname.startsWith('raxi-hq-staging-')&&
   url.hostname.endsWith('-xlordzocox-cybers-projects.vercel.app');
 }catch{return false;}
}

/** Not exported as a network route; only a composable, fail-closed handler.
 * An approved deployment must still configure WAF/network and a durable
 * limiter, and attest the exact Preview origin before mounting this function.
 */
export function createUnpublishedStagingNodeIngress(config:UnpublishedIngressConfig) {
 if(typeof window!=='undefined')throw Error('Server-only ingress');
 if(!config||!(config.path===undefined||config.path===STAGING_AUTH_DIAGNOSTIC_PATH||
  config.path===STAGING_DIRECTOR_READINESS_PATH)||!exactStagingOrigin(config.approvedOrigin)||
    !config.admission||typeof config.admission.admit!=='function'||
    typeof config.authenticationHandler!=='function')
  throw Error('Approved staging ingress dependencies required');
 return async(request:Request,context:TrustedIngressContext):Promise<Response>=>{
  // Do not trust forwarding/origin headers as the source of the approved URL.
  // The future Node route must build Request.url from a trusted deployment URL.
  let url:URL;
  try{url=new URL(request.url);}catch{return response(403,'Ingress denied');}
  if(url.origin!==config.approvedOrigin||url.pathname!==(config.path??STAGING_AUTH_DIAGNOSTIC_PATH)||
     url.search||url.hash)return response(404,'Route not available');
  if(request.method!=='POST')return response(405,'Method not allowed',{Allow:'POST'});
  if(request.headers.get('origin')!==config.approvedOrigin)return response(403,'Origin denied');
  const fetchSite=request.headers.get('sec-fetch-site');
  if(fetchSite!==null&&fetchSite!=='same-origin')return response(403,'Origin denied');
  const type=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(type!=='application/json')return response(415,'JSON required');
  const auth=request.headers.get('authorization')??'';
  if(!/^Bearer \S{1,16384}$/.test(auth))return response(401,'Authentication required');
  const length=request.headers.get('content-length');
  if(length!==null){
   if(!/^(0|[1-9][0-9]{0,5})$/.test(length))return response(400,'Invalid body length');
   if(Number(length)>256)return response(413,'Request too large');
  }
  // Fail closed before any Auth or privileged RPC; rateKey is trusted context,
  // not a spoofable X-Forwarded-For supplied by the request itself.
  if(!context||typeof context.rateKey!=='string'||
     !/^[a-zA-Z0-9:_-]{8,128}$/.test(context.rateKey))
    return response(503,'Ingress unavailable');
  let admitted=false;
  try { admitted=await config.admission.admit(context.rateKey)==='ALLOW'; }
  catch { return response(503,'Ingress unavailable'); }
  if(!admitted)return response(429,'Request rate limited');
  try {
   const result=await config.authenticationHandler(request);
   // Do not relay arbitrary CORS or Set-Cookie headers, even if an upstream
   // dependency accidentally supplies them. Retain only status/body.
   if(result.status<200||result.status>599)return response(503,'Ingress unavailable');
   return new Response(result.body,{status:result.status,headers:BASE_HEADERS});
  } catch {return response(503,'Ingress unavailable');}
 };
}
