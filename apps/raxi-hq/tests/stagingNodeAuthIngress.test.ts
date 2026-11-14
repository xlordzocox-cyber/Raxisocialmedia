/** Offline regression: fake Auth and admission. No SDK connection, JWT or secrets. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStagingAuthReadinessProbe} from '../../../server/agent-runtime/stagingAuthReadinessProbe';
import {
 createUnpublishedStagingNodeIngress,STAGING_AUTH_DIAGNOSTIC_PATH,
 type UnpublishedIngressConfig,type TrustedIngressContext,
} from '../server/stagingNodeAuthIngress';

const origin='https://raxi-hq-staging-q5c16dvsm-xlordzocox-cybers-projects.vercel.app';
const token='synthetic-token-NEVER-real';
const path=STAGING_AUTH_DIAGNOSTIC_PATH;
const ctx:TrustedIngressContext={rateKey:'trusted:masked-client-001'};

function harness() {
 let authCalls=0,admissions=0,admission:'ALLOW'|'DENY'='ALLOW',throwLimiter=false,throwHandler=false;
 const keys:string[]=[];
 const config:UnpublishedIngressConfig={
  approvedOrigin:origin,
  admission:{async admit(key){admissions++;keys.push(key);if(throwLimiter)throw Error('transient');return admission;}},
  async authenticationHandler(_request){
   authCalls++;
   if(throwHandler)throw Error('internal fake SDK error');
   return new Response(JSON.stringify({
    kind:'RAXI_STAGING_AUTH_READINESS',readOnly:true,executionEnabled:false,
   }),{status:200,headers:{
    'Access-Control-Allow-Origin':'*','Set-Cookie':'should-never-relay=yes',
   }});
  },
 };
 const handler=createUnpublishedStagingNodeIngress(config);
 const request=(settings:{
  method?:string;url?:string;headers?:Record<string,string>;body?:string;context?:TrustedIngressContext|null;
 }={})=>{
  const method=settings.method??'POST';
  const headers:Record<string,string>={
   Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token,
   ...settings.headers,
  };
  return handler(new Request(settings.url??origin+path,{
   method,headers,
   ...(method!=='GET'&&method!=='HEAD'?{body:settings.body??JSON.stringify({workspaceId:'60000000-0000-4000-8000-000000000001'})}:{}),
  }),settings.context===undefined?ctx:settings.context as TrustedIngressContext);
 };
 return {request,keys,config,get authCalls(){return authCalls;},get admissions(){return admissions;},
  deny(){admission='DENY';},throwAdmission(){throwLimiter=true;},throwAuth(){throwHandler=true;}};
}
test('Only exact approved same-origin POST reaches the inert Auth handler',async()=>{
 const h=harness();
 const response=await h.request();
 assert.equal(response.status,200);
 assert.equal((await response.json()).executionEnabled,false);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
 assert.equal(response.headers.get('Set-Cookie'),null);
 assert.match(response.headers.get('Cache-Control')??'',/no-store/);
 assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
 assert.deepEqual([h.admissions,h.authCalls],[1,1]);
 assert.deepEqual(h.keys,[ctx.rateKey]);
});
test('Foreign origin, altered URL, unexpected routes and CORS preflight are rejected before Auth',async()=>{
 const h=harness();
 const cases=[
  {headers:{Origin:'https://evil.example'}},
  {headers:{Origin:''}},
  {headers:{'Sec-Fetch-Site':'cross-site'}},
  {headers:{'Sec-Fetch-Site':'same-site'}},
  {headers:{'Sec-Fetch-Site':'none'}},
  {url:'https://evil.example'+path},
  {url:origin+path+'?debug=1'},
  {url:origin+'/api/raxi-hq/runtime-auth'},
  {method:'OPTIONS'},
  {method:'GET'},
  {method:'PUT'},
 ];
 for(const c of cases){
  const response=await h.request(c);
  assert.notEqual(response.status,200,JSON.stringify(c));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
 }
 assert.equal(h.authCalls,0);
 assert.equal(h.admissions,0);
});
test('Missing JWT, invalid content type and oversized or forged lengths cannot reach Auth',async()=>{
 const h=harness();
 const cases=[
  {headers:{Authorization:''}},
  {headers:{Authorization:'Bearer \t'}},
  {headers:{Authorization:'Bearer '+('a'.repeat(16385))}},
  {headers:{'Content-Type':'text/plain'}},
  {headers:{'Content-Length':'257'}},
  {headers:{'Content-Length':'-1'}},
  {headers:{'Content-Length':'1000000'}},
  {headers:{'Content-Length':'01'}},
 ];
 for(const c of cases){
  const response=await h.request(c);
  assert.notEqual(response.status,200,JSON.stringify(c));
 }
 assert.equal(h.admissions,0);
 assert.equal(h.authCalls,0);
});
test('Durable external admission must allow before any Auth or privileged RPC',async()=>{
 const denied=harness();denied.deny();
 assert.equal((await denied.request()).status,429);
 assert.equal(denied.authCalls,0);
 const outage=harness();outage.throwAdmission();
 assert.equal((await outage.request()).status,503);
 assert.equal(outage.authCalls,0);
 const absent=harness();
 assert.equal((await absent.request({context:null})).status,503);
 assert.equal(absent.authCalls,0);
 assert.equal(absent.admissions,0);
 const malformed=harness();
 assert.equal((await malformed.request({context:{rateKey:'x'}})).status,503);
 assert.equal(malformed.authCalls,0);
});
test('Attacker-provided forwarding headers cannot override trusted rate identity',async()=>{
 const h=harness();
 const r=await h.request({headers:{'X-Forwarded-For':'123.4.5.6','X-Real-IP':'8.8.8.8'}});
 assert.equal(r.status,200);
 assert.deepEqual(h.keys,[ctx.rateKey]);
 assert.equal(h.authCalls,1);
});
test('Auth transport failures return opaque error without leaking tokens or secrets',async()=>{
 const h=harness();h.throwAuth();
 const result=await h.request();
 assert.equal(result.status,503);
 const body=await result.text();
 assert.equal(body.includes(token),false);
 assert.equal(body.includes('internal fake SDK error'),false);
 assert.equal(result.headers.get('Access-Control-Allow-Origin'),null);
});
test('No wildcard, production, malformed or off-team preview can become the approved origin',()=>{
 const bad=[
  '*','http://raxi-hq-staging-test-xlordzocox-cybers-projects.vercel.app',
  'https://raxi-hq-staging-*.vercel.app',
  'https://raxi-hq-staging-x.other-vercel.app',
  'https://raxi-hq-staging-example.vercel.app',
  'https://raxi-hq-staging-q5c16dvsm-xlordzocox-cybers-projects.vercel.app/',
  'https://raxi-hq-staging-q5c16dvsm-xlordzocox-cybers-projects.vercel.app/path',
  'https://production.example',
  'https://raxi-hq-staging-q5c16dvsm-xlordzocox-cybers-projects.vercel.app?x=1',
 ];
 for(const approvedOrigin of bad)assert.throws(()=>createUnpublishedStagingNodeIngress({
  approvedOrigin,admission:{admit:async()=> 'ALLOW'},authenticationHandler:async()=>new Response(null),
 }),approvedOrigin);
 assert.throws(()=>createUnpublishedStagingNodeIngress({
  approvedOrigin:origin,admission:null as never,authenticationHandler:async()=>new Response(null),
 }));
});

test('Unspecified body length is bounded by the composed existing Auth probe',async()=>{
 let identities=0;
 const auth=createStagingAuthReadinessProbe({
  liveEnabled:false,providersEnabled:false,actionsEnabled:false,
  identify:async()=>{identities++;throw Error('Should not reach Auth for >256 bytes');},
 });
 const gate=createUnpublishedStagingNodeIngress({
  approvedOrigin:origin,
  admission:{admit:async()=> 'ALLOW'},
  authenticationHandler:auth,
 });
 const r=await gate(new Request(origin+path,{
  method:'POST',
  headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token},
  body:JSON.stringify({workspaceId:'60000000-0000-4000-8000-000000000001',padding:'x'.repeat(300)}),
 }),ctx);
 assert.equal(r.status,403);
 assert.equal(identities,0);
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
});
