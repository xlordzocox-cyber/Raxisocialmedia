/** Issue #49: entirely OFFLINE Node fake JWT, two sessions of ONE owner,
 * atomic shared SQL admission facade, and trusted canonical projection.
 * No Supabase network, real credentials, deployment, task or provider.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {createClient} from '@supabase/supabase-js';
import {
 createUnpublishedDirectorNodeGate,
 type UnpublishedDirectorNodeConfig,
} from '../server/stagingDirectorNodeGate';
import {STAGING_DIRECTOR_READINESS_PATH} from '../server/stagingNodeAuthIngress';

const ref='zvhxjindgyvtasstfjut';
const projectUrl=`https://${ref}.supabase.co`;
const origin='https://raxi-hq-staging-q5c16dvsm-xlordzocox-cybers-projects.vercel.app';
const workspace='60000000-0000-4000-8000-000000000001';
const owner='60000000-0000-4000-8000-000000000002';
const other='60000000-0000-4000-8000-000000000004';
const sessionA='60000000-0000-4000-8000-000000000003';
const sessionB='60000000-0000-4000-8000-000000000006';
const task='60000000-0000-4000-8000-000000000005';
const secret='sb_secret_synthetic-tests-NOT-REAL';
const key='sb_publishable_synthetic-tests-NOT-REAL';
const ctx={rateKey:'trusted:opaque-client-zone'};
const approved={provenance:'TRUSTED_SERVER_SNAPSHOT',taskId:task,workspaceId:workspace,
 stage:'DIRECTOR',simulated:false,state:'READY_FOR_MANUAL_EXECUTION',
 spec:{question:'An original text briefing',externalResearch:false,provider:'openai',
  model:'test-only',authorization:{confirmed:true,maxCostMicros:2000,expiresAt:'2099-01-01T00:00:00Z'}},
 scopeSha256:'a'.repeat(64),
 approval:{provenance:'PERSISTED_HUMAN_EXECUTION_APPROVAL',taskId:task,
  workspaceId:workspace,operatorId:owner,sessionId:sessionA,decision:'APPROVED',
  revoked:false,scopeSha256:'a'.repeat(64),policyVersion:1,
  provider:'openai',model:'test-only',maxCostMicros:2000,
  issuedAt:'2026-11-14T22:00:00Z',expiresAt:'2099-01-01T00:00:00Z'},
 policy:{workspaceId:workspace,version:1,enabled:true,simulated:false,
  provider:'openai',model:'test-only',perCallMicros:1000,remainingMicros:1000,
  maxOutputTokens:128,expiresAt:'2099-01-01T00:00:00Z'},
};
function harness() {
 let preauth:'ALLOW'|'DENY'='ALLOW',rate:'ALLOWED'|'RATE_LIMITED'='ALLOWED';
 let failPreauth=false,failRate=false,failRead=false;
 let switchOwner=false,breakRead=false,revokeMidRead=false,approvalVisible=false;
 const active=new Set([sessionA,sessionB]);
 const calls:string[]=[];
 const clients:Array<{key:string;url:string;options:Record<string,unknown>}>=[];
 const quota=new Map<string,number>();
 let ownerOverride=owner,fetches=0;
 const config:UnpublishedDirectorNodeConfig={
  projectUrl,publishableKey:key,privilegedKey:secret,approvedOrigin:origin,
  admission:{async admit(k){calls.push('preauth:'+k);if(failPreauth)throw Error('outage');return preauth;}},
 };
 const fakeSdk=((url:string,apiKey:string,options:{auth:Record<string,unknown>})=>{
  clients.push({url,key:apiKey,options:options.auth});
  if(apiKey===key)return {auth:{
   async getClaims(token:string){
    calls.push('claims');
    const sid=token==='session-A'?sessionA:token==='session-B'?sessionB:null;
    return sid?{data:{claims:{iss:projectUrl+'/auth/v1',aud:'authenticated',
     role:'authenticated',is_anonymous:false,sub:ownerOverride,session_id:sid,
     iat:Math.floor(Date.now()/1000)-5,exp:Math.floor(Date.now()/1000)+600}},error:null}:
     {data:null,error:'invalid'};
   },
   async getUser(token:string){calls.push('user');
    return {data:{user:token==='session-A'||token==='session-B'?
     {id:ownerOverride,is_anonymous:false}:null},error:null};
   },
  },rpc(){throw Error('User SDK cannot make privileged calls');}};
  if(apiKey===secret)return {auth:{
   getClaims(){throw Error('Service SDK cannot validate browser JWT');},
   getUser(){throw Error('Service SDK cannot validate browser user');},
  },async rpc(name:string,args:Record<string,unknown>){
   calls.push('rpc:'+name);fetches++;
   assert.ok(['raxi_supervised_host_identity','raxi_supervised_request_rate_admit',
    'raxi_director_real_read'].includes(name),name);
   assert.equal(JSON.stringify(args).includes('session-A'),false);
   assert.equal(JSON.stringify(args).includes(secret),false);
   const id=args.p_identity as {actorId:string;sessionId:string;workspaceId:string;projectRef:string};
   if(name==='raxi_supervised_host_identity')
    return {data:!switchOwner&&id.actorId===owner&&id.workspaceId===workspace&&
     id.projectRef===ref&&active.has(id.sessionId),error:null};
   if(name==='raxi_supervised_request_rate_admit'){
    assert.equal(args.p_operation,'PREFLIGHT');
    if(failRate)return {data:null,error:'offline'};
    const ck=id.actorId+':'+id.workspaceId,used=(quota.get(ck)??0)+1;
    quota.set(ck,used);
    return {data:{operation:'PREFLIGHT',status:rate==='RATE_LIMITED'||used>30?
     'RATE_LIMITED':'ALLOWED',...(used>30?{retryAfterSeconds:60}:{})},error:null};
   }
   assert.equal(args.p_task_id,task);
   if(failRead)return {data:null,error:'offline'};
   if(revokeMidRead){active.delete(id.sessionId);revokeMidRead=false;}
   if(breakRead)return {data:{...approved,taskId:other},error:null};
   return {data:approvalVisible&&id.sessionId===sessionA?structuredClone(approved):null,error:null};
  }};
  throw Error('Unexpected SDK key');
 }) as unknown as typeof createClient;
 const gate=createUnpublishedDirectorNodeGate(config,fakeSdk);
 const request=(args:{token?:string;method?:string;headers?:Record<string,string>;
   url?:string;body?:unknown;context?:typeof ctx|null}={})=>{
  const method=args.method??'POST';
  const headers={Origin:origin,'Content-Type':'application/json',
   Authorization:'Bearer '+(args.token??'session-A'),...args.headers};
  return gate(new Request(args.url??origin+STAGING_DIRECTOR_READINESS_PATH,{
   method,headers,...(!['GET','HEAD'].includes(method)?{
    body:JSON.stringify(args.body??{workspaceId:workspace,taskId:task})}:{})
  }),args.context===undefined?ctx:args.context as typeof ctx);
 };
 return {request,clients,calls,quota,active,get fetches(){return fetches;},
  allowApproval(){approvalVisible=true;},setOwner(id:string){ownerOverride=id;},
  revoke(sid:string){active.delete(sid);},revokeInRead(){revokeMidRead=true;},
  denyPreauth(){preauth='DENY';},outagePreauth(){failPreauth=true;},
  denyRate(){rate='RATE_LIMITED';},outageRate(){failRate=true;},
  failProjection(){failRead=true;},forgeProjection(){breakRead=true;},
  changeOwner(){switchOwner=true;},
 };
}
test('No mount or provider; JWT owner revalidated twice and shared SQL rate precedes ledger read',async()=>{
 const h=harness();
 const r=await h.request();assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{
  kind:'RAXI_DIRECTOR_REAL_LEDGER_READINESS',persistedApprovalVisible:false,
  readOnly:true,hostMounted:false,liveEnabled:false,
  actionsEnabled:false,providersEnabled:false,executionEnabled:false,providerCalls:0,
 });
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 assert.equal(r.headers.get('Set-Cookie'),null);
 assert.equal(h.clients.length,2);
 assert.deepEqual(h.clients.map(c=>c.key),[key,secret]);
 assert.ok(h.clients.every(c=>c.url===projectUrl&&c.options.persistSession===false&&
  c.options.autoRefreshToken===false&&c.options.detectSessionInUrl===false));
 const start=h.calls.indexOf('rpc:raxi_supervised_request_rate_admit');
 const read=h.calls.indexOf('rpc:raxi_director_real_read');
 assert.ok(start>0&&read>start);
 assert.equal(h.calls.filter(x=>x==='rpc:raxi_supervised_host_identity').length,2);
 assert.equal(h.calls.filter(x=>x==='claims').length,2);
 assert.equal(h.calls.filter(x=>x==='user').length,2);
});
test('Owner A and B are different sessions of ONE account: revoking A never grants B the A-bound approval',async()=>{
 const h=harness();h.allowApproval();
 assert.equal((await h.request()).status,200);
 const first=await h.request();assert.equal((await first.json()).persistedApprovalVisible,true);
 const second=await h.request({token:'session-B'});
 assert.equal(second.status,200);
 assert.equal((await second.json()).persistedApprovalVisible,false);
 h.revoke(sessionA);
 assert.equal((await h.request()).status,403);
 const remains=await h.request({token:'session-B'});
 assert.equal(remains.status,200);
 assert.equal((await remains.json()).persistedApprovalVisible,false);
});
test('Revocation during DB read denies response after the second owner/session check',async()=>{
 const h=harness();h.allowApproval();h.revokeInRead();
 const r=await h.request();assert.equal(r.status,403);
 assert.equal((await r.text()).includes(owner),false);
});
test('Durable SQL quota enforces a shared 30/min across requests without permitting 31st ledger read',async()=>{
 const h=harness();for(let i=0;i<30;i++){
  assert.equal((await h.request()).status,200,`request ${i+1}`);
 }
 const before=h.calls.filter(x=>x==='rpc:raxi_director_real_read').length;
 assert.equal((await h.request()).status,429);
 assert.equal(h.calls.filter(x=>x==='rpc:raxi_director_real_read').length,before);
 assert.equal(h.quota.get(owner+':'+workspace),31);
});
test('Unauthenticated/foreign/anonymous-like claims or wrong workspace cannot read',async()=>{
 const invalid=harness();
 assert.equal((await invalid.request({token:'bad-token'})).status,403);
 assert.equal(invalid.calls.filter(x=>x==='rpc:raxi_director_real_read').length,0);
 const foreign=harness();foreign.setOwner(other);
 assert.equal((await foreign.request()).status,403);
 assert.equal(foreign.calls.filter(x=>x==='rpc:raxi_supervised_request_rate_admit').length,0);
 const workspaceConflict=harness();
 assert.equal((await workspaceConflict.request({body:{workspaceId:other,taskId:task}})).status,403);
});
test('Opaque failure when rate, SQL or canonical shape is absent, or owner changes',async()=>{
 const rate=harness();rate.outageRate();
 assert.equal((await rate.request()).status,503);
 assert.equal(rate.calls.filter(x=>x==='rpc:raxi_director_real_read').length,0);
 const denied=harness();denied.denyRate();
 assert.equal((await denied.request()).status,429);
 const broken=harness();broken.failProjection();
 assert.equal((await broken.request()).status,503);
 const forged=harness();forged.forgeProjection();
 assert.equal((await forged.request()).status,503);
 const changed=harness();changed.changeOwner();
 assert.equal((await changed.request()).status,403);
});
test('Exact staging same-origin path + trusted preauth admission required; dangerous commands never enter DB',async()=>{
 const h=harness();
 const invalid=[
  {url:origin+'/api/raxi-hq/runtime-auth-readiness'},
  {url:origin+STAGING_DIRECTOR_READINESS_PATH+'?debug=1'},
  {url:'https://evil.invalid'+STAGING_DIRECTOR_READINESS_PATH},
  {headers:{Origin:'https://evil.invalid'}},
  {headers:{'Sec-Fetch-Site':'cross-site'}},
  {method:'OPTIONS'},{method:'GET'},
  {body:{workspaceId:workspace,taskId:task,action:'approve'}},
  {body:{workspaceId:workspace,taskId:task,confirmed:true}},
  {body:{workspaceId:workspace,taskId:task,provider:'openai'}},
  {body:{workspaceId:workspace,taskId:task,padding:'x'.repeat(800)}},
 ];
 for(const c of invalid)assert.notEqual((await h.request(c)).status,200,JSON.stringify(c));
 assert.equal(h.calls.filter(x=>x==='rpc:raxi_director_real_read').length,0);
 assert.equal(h.calls.filter(x=>x==='rpc:raxi_supervised_request_rate_admit').length,0);
 const pre=harness();pre.denyPreauth();assert.equal((await pre.request()).status,429);
 assert.equal(pre.calls.filter(x=>x==='claims').length,0);
 const down=harness();down.outagePreauth();assert.equal((await down.request()).status,503);
 assert.equal(down.calls.filter(x=>x==='claims').length,0);
 const noContext=harness();
 assert.equal((await noContext.request({context:null})).status,503);
 assert.equal(noContext.calls.filter(x=>x==='claims').length,0);
});
test('Constructor rejects production ref, legacy credentials and missing atomic preauth gate',()=>{
 for(const change of [
  {projectUrl:'https://jrkefsylpfriiqefcmzq.supabase.co'},
  {projectUrl:projectUrl+'/'},
  {privilegedKey:key},
  {privilegedKey:'legacy_service_role_key'},
  {publishableKey:'legacy_anon'},
  {admission:null},
  {approvedOrigin:'https://evil.invalid'},
 ]){
  let constructed=0;
  const fake=(()=>{constructed++;throw Error('Should not create client');}) as unknown as typeof createClient;
  assert.throws(()=>createUnpublishedDirectorNodeGate({
   projectUrl,publishableKey:key,privilegedKey:secret,approvedOrigin:origin,
   admission:{admit:async()=> 'ALLOW'},...change,
  } as UnpublishedDirectorNodeConfig,fake));
  assert.equal(constructed,0,JSON.stringify(change));
 }
});
