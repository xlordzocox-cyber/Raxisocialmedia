/** Issue #49: offline-only contract tests. No live JWT, DB writes or paid API calls. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectFirstRealDirectorPilot,type CanonicalDirectorPilot,type DirectorOfficialQuote,
 type DirectorPilotReadPorts} from '../../../server/agent-runtime/firstRealDirectorPilot';

const owner='60000000-0000-4000-8000-000000000002';
const other='60000000-0000-4000-8000-000000000005';
const session='60000000-0000-4000-8000-000000000003';
const otherSession='60000000-0000-4000-8000-000000000006';
const task='60000000-0000-4000-8000-000000000007';
const workspace='60000000-0000-4000-8000-000000000001';
const provider='openai',model='synthetic-text-model';
const now=()=>Date.now();
const future=()=>new Date(now()+600_000).toISOString();
const past=()=>new Date(now()-600_000).toISOString();
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),
 v=>v.toString(16).padStart(2,'0')).join('');

async function fixture(){
 const identity={
  provenance:'SUPABASE_AUTH_STAGING' as const,actorId:owner,sessionId:session,workspaceId:workspace,
  projectRef:'zvhxjindgyvtasstfjut',expiresAt:future(),
 };
 const spec={
  question:'Produce a safe text-only editorial outline for review',
  externalResearch:false,provider,model,
  authorization:{confirmed:true,maxCostMicros:5000,expiresAt:future()},
 };
 const policyVersion=2;
 const scopeSha256=await hash(JSON.stringify({
  workspaceId:workspace,taskId:task,actorId:owner,stage:'DIRECTOR',spec,policyVersion,
 }));
 const canonical:CanonicalDirectorPilot={
  provenance:'TRUSTED_SERVER_SNAPSHOT',taskId:task,workspaceId:workspace,
  stage:'DIRECTOR',simulated:false,state:'READY_FOR_MANUAL_EXECUTION',spec,scopeSha256,
  approval:{
   provenance:'PERSISTED_HUMAN_EXECUTION_APPROVAL',
   taskId:task,workspaceId:workspace,operatorId:owner,sessionId:session,
   decision:'APPROVED',revoked:false,scopeSha256,policyVersion,
   provider,model,maxCostMicros:5000,issuedAt:past(),expiresAt:future(),
  },
  policy:{
   workspaceId:workspace,version:policyVersion,enabled:true,simulated:false,
   provider,model,perCallMicros:4000,remainingMicros:4000,maxOutputTokens:128,expiresAt:future(),
  },
 };
 const quote:DirectorOfficialQuote={
  provenance:'SERVER_VERIFIED_CURRENT_PRICING',provider,model,currency:'USD',
  verifiedAt:new Date(now()-1000).toISOString(),expiresAt:future(),
  maxEstimatedMicros:3000,sourceUrl:'https://pricing.fixture.invalid/for-tests',
 };
 let identifies=0,reads=0,quotes=0,revoked=false;
 const ports:DirectorPilotReadPorts={
  async identify(){
   identifies++;
   return {...identity,sessionId:revoked&&identifies>1?otherSession:identity.sessionId};
  },
  async readCanonical(){reads++;return canonical;},
  async readQuote(){quotes++;return quote;},
 };
 return {identity,spec,canonical,quote,ports, revokeSession:()=>{revoked=true;},
  get counts(){return {identifies,reads,quotes}}};
}
const args={taskId:task,workspaceId:workspace};
test('Valid-looking future SERVER snapshot produces PRE-FLIGHT ONLY; never execution or permission',async()=>{
 const h=await fixture();
 const r=await inspectFirstRealDirectorPilot(args,h.ports);
 assert.equal(r.kind,'DIRECTOR_REAL_PREFLIGHT_ONLY');
 assert.equal(r.liveEnabled,false);
 assert.equal(r.executionEnabled,false);
 assert.equal(r.providerCalls,0);
 assert.equal(r.provider,provider);
 assert.equal(r.model,model);
 assert.equal(r.ceilingMicros,5000);
 assert.equal(r.reservedMicros,4000);
 assert.deepEqual(h.counts,{identifies:2,reads:1,quotes:1});
 assert.ok(Object.isFrozen(r));
 assert.equal(JSON.stringify(r).includes(session),false);
 assert.equal(JSON.stringify(r).includes(owner),false);
});
test('Invalid, cross-workspace, additional-field and non-UUID requests fail before DB reads',async()=>{
 const invalid=[
  {...args,actorId:owner}, {...args,provider},
  {...args,taskId:'unsafe'},{...args,workspaceId:other},
  {taskId:task}, {workspaceId:workspace},
 ];
 for(const request of invalid){
  const h=await fixture();
  await assert.rejects(inspectFirstRealDirectorPilot(request as typeof args,h.ports));
  if(request.taskId==='unsafe'||'actorId' in request||'provider' in request||!('taskId' in request)||!('workspaceId' in request))
   assert.equal(h.counts.reads,0);
 }
});
test('Expired/unknown initial owner identity fails before canonical task lookup',async()=>{
 for(const mode of ['wrong-project','expired','other-workspace','foreign-actor','malformed'] as const){
  const h=await fixture();
  const old=h.ports.identify;
  h.ports.identify=async()=>{
   const i=await old();
   if(mode==='wrong-project')return {...i,projectRef:'jrkefsylpfriiqefcmzq'};
   if(mode==='expired')return {...i,expiresAt:past()};
   if(mode==='other-workspace')return {...i,workspaceId:other};
   if(mode==='foreign-actor')return {...i,actorId:'broken'};
   return {...i,unexpected:'claim'} as never;
  };
  await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),mode);
  assert.equal(h.counts.reads,0);
 }
});
test('Session changes after asynchronous reads must fail closed, including same-account other session',async()=>{
 const h=await fixture();h.revokeSession();
 await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),/session changed/);
 assert.equal(h.counts.identifies,2);
});
test('Missing task or forged task scope/stage cannot become a ready Director',async()=>{
 for(const mode of ['null','researcher','other-task','simulated','fake-origin','wrong-state','digest'] as const){
  const h=await fixture();
  if(mode==='null')h.ports.readCanonical=async()=>null;
  if(mode==='researcher')h.canonical.stage='RESEARCHER' as never;
  if(mode==='other-task')h.canonical.taskId=other;
  if(mode==='simulated')h.canonical.simulated=true as never;
  if(mode==='fake-origin')h.canonical.provenance='LOCAL_FIXTURE' as never;
  if(mode==='wrong-state')h.canonical.state='REQUESTED' as never;
  if(mode==='digest')h.canonical.scopeSha256='x'.repeat(64);
  await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),mode);
 }
});
test('No provider default; simulated output and external research are disallowed',async()=>{
 for(const mode of ['simulated','research','unknown-field','unconfirmed','zero-cost'] as const){
  const h=await fixture();
  if(mode==='simulated')h.canonical.spec.provider='simulated';
  if(mode==='research')h.canonical.spec.externalResearch=true;
  if(mode==='unknown-field')(h.canonical.spec as unknown as Record<string,unknown>).execute=true;
  if(mode==='unconfirmed')h.canonical.spec.authorization.confirmed=false as never;
  if(mode==='zero-cost')h.canonical.spec.authorization.maxCostMicros=0;
  await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),mode);
 }
});
test('Approval must be separate, durable, unrevoked, session-bound and task-scoped',async()=>{
 const modes=['revoked','operator','session','task','workspace','provider','model','cost',
  'scope','version','expiry','future-issued','forged-decision'] as const;
 for(const mode of modes){
  const h=await fixture(),a=h.canonical.approval;
  if(mode==='revoked')a.revoked=true as never;
  if(mode==='operator')a.operatorId=other;
  if(mode==='session')a.sessionId=otherSession;
  if(mode==='task')a.taskId=other;
  if(mode==='workspace')a.workspaceId=other;
  if(mode==='provider')a.provider='other';
  if(mode==='model')a.model='other';
  if(mode==='cost')a.maxCostMicros=7000;
  if(mode==='scope')a.scopeSha256='a'.repeat(64);
  if(mode==='version')a.policyVersion=9;
  if(mode==='expiry')a.expiresAt=past();
  if(mode==='future-issued')a.issuedAt=future();
  if(mode==='forged-decision')a.decision='APPROVED_BY_MODEL' as never;
  await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),mode);
 }
});
test('Disabled, stale, mismatched or underfunded policy denies a pilot',async()=>{
 const modes=['disabled','simulation','workspace','version','provider','model','underfunded',
  'reservation','output','expired','unknown-field'] as const;
 for(const mode of modes){
  const h=await fixture(),p=h.canonical.policy;
  if(mode==='disabled')p.enabled=false as never;
  if(mode==='simulation')p.simulated=true as never;
  if(mode==='workspace')p.workspaceId=other;
  if(mode==='version')p.version=20;
  if(mode==='provider')p.provider='other';
  if(mode==='model')p.model='another';
  if(mode==='underfunded')p.remainingMicros=3999;
  if(mode==='reservation')p.perCallMicros=5001;
  if(mode==='output')p.maxOutputTokens=10000;
  if(mode==='expired')p.expiresAt=past();
  if(mode==='unknown-field')(p as unknown as Record<string,unknown>).allowAll=true;
  await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),mode);
 }
});
test('Missing or expired/unknown price quote cannot authorize paid Director',async()=>{
 const modes=['missing','stale','expired','provider','model','exceeds','unverified','fake-currency',
  'non-https','no-bound','extra'] as const;
 for(const mode of modes){
  const h=await fixture(),q=h.quote;
  if(mode==='missing')h.ports.readQuote=async()=>null;
  if(mode==='stale')q.verifiedAt=new Date(now()-2*86_400_000).toISOString();
  if(mode==='expired')q.expiresAt=past();
  if(mode==='provider')q.provider='other';
  if(mode==='model')q.model='other';
  if(mode==='exceeds')q.maxEstimatedMicros=4001;
  if(mode==='unverified')q.provenance='USER_QUOTE' as never;
  if(mode==='fake-currency')q.currency='MXN' as never;
  if(mode==='non-https')q.sourceUrl='http://pricing.fixture.invalid';
  if(mode==='no-bound')q.maxEstimatedMicros=NaN;
  if(mode==='extra')(q as unknown as Record<string,unknown>).priceOverride=0;
  await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),mode);
 }
});
test('Canonical scope SHA is invariant to reordering spec and nested authorization keys',async()=>{
 const h=await fixture();
 const s=h.canonical.spec,a=s.authorization;
 h.canonical.spec={
  model:s.model,provider:s.provider,
  authorization:{expiresAt:a.expiresAt,maxCostMicros:a.maxCostMicros,confirmed:true},
  externalResearch:s.externalResearch,question:s.question,
 };
 const r=await inspectFirstRealDirectorPilot(args,h.ports);
 assert.equal(r.kind,'DIRECTOR_REAL_PREFLIGHT_ONLY');
 assert.equal(r.scopeSha256,h.canonical.scopeSha256);
 assert.equal(r.executionEnabled,false);
});
test('Digest ties persisted approval to canonical question, provider, model, task, actor and version',async()=>{
 const h=await fixture();
 h.canonical.spec.question='Different question with a valid duration';
 await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),/scope changed/);
});
test('Session read failures and DB/quote transport failures never return a ready result',async()=>{
 for(const mode of ['identity','canonical','quote'] as const){
  const h=await fixture();
  if(mode==='identity')h.ports.identify=async()=>{throw Error('Auth unavailable');};
  if(mode==='canonical')h.ports.readCanonical=async()=>{throw Error('DB unavailable');};
  if(mode==='quote')h.ports.readQuote=async()=>{throw Error('Quote unavailable');};
  await assert.rejects(inspectFirstRealDirectorPilot(args,h.ports),mode);
 }
});
