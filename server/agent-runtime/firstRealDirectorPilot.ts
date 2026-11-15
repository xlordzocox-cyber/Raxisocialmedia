/** Issue #49: server-only inspection of the *future* first REAL Director text pilot.
 * A plan is NOT a permit or a dispatch. No SDK, secrets, DB transport, provider,
 * endpoint, worker, scheduler or runOne invocation occurs in this file.
 */
import {taskSpec,type TaskSpec} from './runtime';
import type {HostedIdentity} from './supabaseSupervisedAuth';
import {localId} from './localSupervisedRepository';

const STAGING_REF='zvhxjindgyvtasstfjut';
const DIGEST=/^[a-f0-9]{64}$/;
const PROVIDER=/^[a-z0-9-]{1,50}$/;
const MODEL=/^[a-zA-Z0-9._-]{1,100}$/;

export interface CanonicalDirectorPilot {
 provenance:'TRUSTED_SERVER_SNAPSHOT';
 taskId:string;workspaceId:string;stage:'DIRECTOR';simulated:false;
 state:'READY_FOR_MANUAL_EXECUTION';
 spec:TaskSpec;
 scopeSha256:string;
 approval:{
  provenance:'PERSISTED_HUMAN_EXECUTION_APPROVAL';
  taskId:string;workspaceId:string;operatorId:string;sessionId:string;
  decision:'APPROVED';revoked:false;scopeSha256:string;
  policyVersion:number;provider:string;model:string;maxCostMicros:number;
  issuedAt:string;expiresAt:string;
 };
 policy:{
  workspaceId:string;version:number;enabled:true;simulated:false;
  provider:string;model:string;perCallMicros:number;remainingMicros:number;
  maxOutputTokens:number;expiresAt:string;
 };
}
export interface DirectorOfficialQuote {
 provenance:'SERVER_VERIFIED_CURRENT_PRICING';
 provider:string;model:string;currency:'USD';
 verifiedAt:string;expiresAt:string;
 maxEstimatedMicros:number;
 /** Traceability only: official pricing provenance, NOT proof of API charges. */
 sourceUrl:string;
}
export interface DirectorPilotReadPorts {
 /** Actual Supabase user/session verification. Must not use request-supplied actor. */
 identify():Promise<Readonly<HostedIdentity>>;
 /** Atomic trusted DB projection: task, human grant, policy, scoped to owner. */
 readCanonical(taskId:string,workspaceId:string):Promise<CanonicalDirectorPilot|null>;
 /** Trusted fresh quote lookup; never use old PILOT_QUOTE or user-provided prices. */
 readQuote(provider:string,model:string):Promise<DirectorOfficialQuote|null>;
}
function exact(value:unknown,fields:readonly string[]):boolean {
 return !!value && typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===fields.length&&Object.keys(value).every(k=>fields.includes(k));
}
function date(value:unknown):number {
 return typeof value==='string'?Date.parse(value):NaN;
}
function isIdentity(value:unknown,workspaceId:string,now:number):value is HostedIdentity {
 if(!exact(value,['provenance','actorId','sessionId','workspaceId','projectRef','expiresAt']))return false;
 const i=value as HostedIdentity;
 try{localId(i.actorId);localId(i.sessionId);localId(i.workspaceId);}catch{return false;}
 return i.provenance==='SUPABASE_AUTH_STAGING'&&i.projectRef===STAGING_REF&&
  i.workspaceId===workspaceId&&Number.isFinite(date(i.expiresAt))&&date(i.expiresAt)>now+60_000;
}
function validQuote(value:DirectorOfficialQuote|null,provider:string,model:string,now:number):value is DirectorOfficialQuote {
 if(!exact(value,['provenance','provider','model','currency','verifiedAt','expiresAt','maxEstimatedMicros','sourceUrl']))return false;
 const q=value!;
 let url:URL;try{url=new URL(q.sourceUrl);}catch{return false;}
 return q.provenance==='SERVER_VERIFIED_CURRENT_PRICING'&&q.currency==='USD'&&
  q.provider===provider&&q.model===model&&url.protocol==='https:'&&
  !url.username&&!url.password&&
  Number.isSafeInteger(q.maxEstimatedMicros)&&q.maxEstimatedMicros>0&&
  Number.isFinite(date(q.verifiedAt))&&date(q.verifiedAt)<=now&&
  date(q.verifiedAt)>now-86_400_000&&date(q.expiresAt)>now+60_000;
}
async function scopeDigest(workspaceId:string,taskId:string,actorId:string,spec:TaskSpec,policyVersion:number):Promise<string> {
 // Fixed field ordering independent of PostgreSQL jsonb/object insertion order.
 // The future SQL signer MUST reproduce these exact UTF-8 JSON bytes.
 const normalizedSpec={
  question:spec.question,externalResearch:spec.externalResearch,
  provider:spec.provider,model:spec.model,
  authorization:{
   confirmed:true,maxCostMicros:spec.authorization.maxCostMicros,
   expiresAt:spec.authorization.expiresAt,
  },
 };
 const canonical=JSON.stringify({workspaceId,taskId,actorId,stage:'DIRECTOR',
  spec:normalizedSpec,policyVersion});
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))),
  b=>b.toString(16).padStart(2,'0')).join('');
}
/** Closed, two-field request. Even a fully successful inspection returns
 * executionEnabled:false: DB must atomically recheck everything at dispatch.
 */
export async function inspectFirstRealDirectorPilot(
 request:{workspaceId:string;taskId:string},ports:DirectorPilotReadPorts,
) {
 if(typeof window!=='undefined')throw Error('Server-only inspector');
 if(!exact(request,['workspaceId','taskId'])||!ports||
  typeof ports.identify!=='function'||typeof ports.readCanonical!=='function'||
  typeof ports.readQuote!=='function')throw Error('Invalid pilot inspection');
 const {workspaceId,taskId}=structuredClone(request);
 localId(workspaceId);localId(taskId);
 const first=structuredClone(await ports.identify());
 const start=Date.now();
 if(!Number.isFinite(start)||!isIdentity(first,workspaceId,start))throw Error('Current owner session required');
 const candidate=await ports.readCanonical(taskId,workspaceId);
 const p=candidate===null?null:structuredClone(candidate);
 if(!p||!exact(p,['provenance','taskId','workspaceId','stage','simulated','state','spec','scopeSha256','approval','policy'])||
  p.provenance!=='TRUSTED_SERVER_SNAPSHOT'||p.stage!=='DIRECTOR'||p.simulated!==false||
  p.state!=='READY_FOR_MANUAL_EXECUTION'||p.taskId!==taskId||p.workspaceId!==workspaceId||
  !DIGEST.test(p.scopeSha256))throw Error('Trusted Director task not ready');
 const spec=taskSpec(p.spec);
 if(spec.externalResearch!==false||!PROVIDER.test(spec.provider)||!MODEL.test(spec.model)||
  spec.provider==='simulated'||!Number.isSafeInteger(spec.authorization.maxCostMicros)||
  spec.authorization.maxCostMicros<=0)throw Error('Real text-only spec required');
 const a=p.approval,s=p.policy;
 if(!exact(a,['provenance','taskId','workspaceId','operatorId','sessionId','decision','revoked','scopeSha256','policyVersion','provider','model','maxCostMicros','issuedAt','expiresAt'])||
  !exact(s,['workspaceId','version','enabled','simulated','provider','model','perCallMicros','remainingMicros','maxOutputTokens','expiresAt']))throw Error('Closed approval and policy required');
 const quote=structuredClone(await ports.readQuote(spec.provider,spec.model));
 const last=structuredClone(await ports.identify());
 const now=Date.now();
 if(!Number.isFinite(now)||!isIdentity(last,workspaceId,now)||
  first.actorId!==last.actorId||first.sessionId!==last.sessionId||
  first.projectRef!==last.projectRef)throw Error('Owner session changed');
 if(a.provenance!=='PERSISTED_HUMAN_EXECUTION_APPROVAL'||a.decision!=='APPROVED'||a.revoked!==false||
  a.taskId!==taskId||a.workspaceId!==workspaceId||a.operatorId!==last.actorId||
  a.sessionId!==last.sessionId||a.scopeSha256!==p.scopeSha256||
  a.provider!==spec.provider||a.model!==spec.model||
  a.maxCostMicros!==spec.authorization.maxCostMicros||
  !Number.isSafeInteger(a.policyVersion)||a.policyVersion<1||
  !Number.isFinite(date(a.issuedAt))||date(a.issuedAt)>now||
  !Number.isFinite(date(a.expiresAt))||date(a.expiresAt)<=now+60_000)throw Error('Specific human execution approval required');
 if(s.workspaceId!==workspaceId||s.enabled!==true||s.simulated!==false||
  !Number.isSafeInteger(s.version)||s.version!==a.policyVersion||
  s.provider!==spec.provider||s.model!==spec.model||
  !Number.isSafeInteger(s.perCallMicros)||s.perCallMicros<=0||
  !Number.isSafeInteger(s.remainingMicros)||s.remainingMicros<s.perCallMicros||
  s.perCallMicros>spec.authorization.maxCostMicros||
  !Number.isSafeInteger(s.maxOutputTokens)||s.maxOutputTokens<1||s.maxOutputTokens>256||
  !Number.isFinite(date(s.expiresAt))||date(s.expiresAt)<=now+60_000||
  !Number.isFinite(date(spec.authorization.expiresAt))||
  date(spec.authorization.expiresAt)<=now+60_000)throw Error('Live policy or cost reservation unavailable');
 if(!validQuote(quote,spec.provider,spec.model,now)||
  quote.maxEstimatedMicros>s.perCallMicros)throw Error('Fresh provider price verification required');
 const expected=await scopeDigest(workspaceId,taskId,last.actorId,spec,s.version);
 if(expected!==p.scopeSha256)throw Error('Approval scope changed');
 const finish=Date.now();
 if(!Number.isFinite(finish)||[last.expiresAt,a.expiresAt,s.expiresAt,
  spec.authorization.expiresAt,quote.expiresAt].some(v=>date(v)<=finish+60_000))
  throw Error('Pilot readiness expired');
 return Object.freeze({
  kind:'DIRECTOR_REAL_PREFLIGHT_ONLY' as const,liveEnabled:false as const,
  executionEnabled:false as const,providerCalls:0 as const,
  taskId,workspaceId,provider:spec.provider,model:spec.model,
  ceilingMicros:a.maxCostMicros,reservedMicros:s.perCallMicros,
  maxOutputTokens:s.maxOutputTokens,scopeSha256:p.scopeSha256,
  expiresAt:new Date(Math.min(...[last.expiresAt,a.expiresAt,s.expiresAt,
   spec.authorization.expiresAt,quote.expiresAt].map(date))).toISOString(),
 });
}
