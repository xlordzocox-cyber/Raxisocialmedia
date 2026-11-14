/** Strict local Auth doubles, NOT signed-JWT hosted integration. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStagingAuthReadinessProbe} from '../../../server/agent-runtime/stagingAuthReadinessProbe';
import {supabaseSupervisedAuth,type UserAuthPort,type ServerRpcPort} from '../../../server/agent-runtime/supabaseSupervisedAuth';

const projectRef='zvhxjindgyvtasstfjut';
const owner='60000000-0000-4000-8000-000000000002';
const workspace='60000000-0000-4000-8000-000000000001';
const session='60000000-0000-4000-8000-000000000003';
const other='60000000-0000-4000-8000-000000000101';

function harness() {
 let identityValid=true, rpcCalls:string[]=[],userCalls=0,claimCalls=0,anon=false,userId=owner;
 const token='synthetic-test-token-DO-NOT-USE-IN-STAGING';
 const claims={iss:`https://${projectRef}.supabase.co/auth/v1`,sub:owner,
  aud:'authenticated',role:'authenticated',is_anonymous:false,
  session_id:session,iat:Math.floor(Date.now()/1000)-1,
  exp:Math.floor(Date.now()/1000)+600};
 const auth:UserAuthPort={
  async getClaims(received){claimCalls++;return received===token?
   {data:{claims:{...claims,is_anonymous:anon}},error:null}:{data:null,error:{code:'invalid_token'}};},
  async getUser(received){userCalls++;return received===token?
   {data:{user:{id:userId,is_anonymous:anon}},error:null}:{data:{user:null},error:{code:'no_user'}};}
 };
 const server:ServerRpcPort={async rpc(name,args){
  rpcCalls.push(name);
  assert.equal(name,'raxi_supervised_host_identity',
   'No simulated/privileged prepare, approve, claim, run or dispatch RPC may be called');
  const p=args.p_identity as {actorId:string;sessionId:string;workspaceId:string;projectRef:string};
  return {data:identityValid&&p.actorId===owner&&p.workspaceId===workspace&&
   p.sessionId===session&&p.projectRef===projectRef,error:null};
 }};
 const identify=supabaseSupervisedAuth({projectRef,auth,server});
 const probe=createStagingAuthReadinessProbe({identify,liveEnabled:false,providersEnabled:false,actionsEnabled:false});
 const request=(body:unknown,header=token,method='POST',contentType='application/json')=>
  probe(new Request('https://staging.invalid/auth-probe',{method,headers:{
   Authorization:header?'Bearer '+header:'', 'Content-Type':contentType},
   ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
 return {probe,request,token,claims,
  revoke(){identityValid=false;},restore(){identityValid=true;},makeAnonymous(){anon=true;},
  changeUser(){userId=other;},get rpcCalls(){return [...rpcCalls];},
  get claimCalls(){return claimCalls;},get userCalls(){return userCalls;}};
}

test('Host readiness responds only to a verified owner and exposes no identity or actions',async()=>{
 const f=harness(),reply=await f.request({workspaceId:workspace});
 assert.equal(reply.status,200);assert.match(reply.headers.get('Cache-Control')??'',/no-store/);
 assert.equal(reply.headers.get('X-Content-Type-Options'),'nosniff');
 const data=await reply.json();
 assert.deepEqual(data,{
  kind:'RAXI_STAGING_AUTH_READINESS',authenticatedOwner:true,
  readOnly:true,hostEnabled:false,actionsEnabled:false,providersEnabled:false,executionEnabled:false,
 });
 assert.equal(JSON.stringify(data).includes(f.token),false);
 assert.equal(JSON.stringify(data).includes(owner),false);
 assert.equal(JSON.stringify(data).includes(session),false);
 assert.deepEqual(f.rpcCalls,['raxi_supervised_host_identity']);
});

test('Readiness rejects all command payloads and oversized bodies before reaching privileged RPC',async()=>{
 const f=harness();
 const cases=[
  {workspaceId:workspace,action:'prepare',stage:'DIRECTOR'},
  {workspaceId:workspace,action:'approve',confirmed:true},
  {workspaceId:workspace,action:'execute',confirmed:true},
  {workspaceId:workspace,action:'revoke'},
  {workspaceId:workspace,action:'reconcile'},
  {workspaceId:workspace,provider:'openai',liveEnabled:true},
  {workspaceId:workspace,providerSecret:'exfiltration'},
  {workspaceId:workspace,ownerId:owner},
  {workspaceId:workspace,identity:{actorId:owner}},
  {workspaceId:workspace,access_token:f.token},
  {workspaceId:other}, {}, {workspaceId:null},[],null,
 ];
 for(const payload of cases){const r=await f.request(payload);assert.equal(r.status,403,JSON.stringify(payload));}
 const huge=await f.request('{"workspaceId":"'+workspace+'","padding":"'+('a'.repeat(1200))+'"}');
 assert.equal(huge.status,403);
 assert.equal(f.rpcCalls.length,1,'Only foreign workspace may reach the read-only identity checker');
});

test('Readiness requires POST, bearer and closed JSON; never invokes Auth for malformed requests',async()=>{
 const f=harness();
 assert.equal((await f.request({},f.token,'GET')).status,405);
 assert.equal((await f.request({workspaceId:workspace},'')).status,401);
 assert.equal((await f.request({workspaceId:workspace},f.token,'POST','text/plain')).status,415);
 assert.equal((await f.request('{',f.token)).status,403);
 assert.equal(f.claimCalls,0);assert.equal(f.userCalls,0);
 assert.deepEqual(f.rpcCalls,[]);
});

test('Revoked session, invalid token, anonymous and changed user are denied without cached success',async()=>{
 const f=harness();
 assert.equal((await f.request({workspaceId:workspace})).status,200);
 f.revoke();
 const revoked=await f.request({workspaceId:workspace});
 assert.equal(revoked.status,403);
 assert.deepEqual(await revoked.json(),{error:'Session or workspace not authorized'});
 f.restore();
 assert.equal((await f.request({workspaceId:workspace},'not-a-valid-token')).status,403);
 f.makeAnonymous();
 assert.equal((await f.request({workspaceId:workspace})).status,403);
 f.changeUser();
 assert.equal((await f.request({workspaceId:workspace})).status,403);
 assert.deepEqual(f.rpcCalls,['raxi_supervised_host_identity','raxi_supervised_host_identity'],
  'Only successful claims/user identity advance to the read-only RPC');
});

test('Expired/future/foreign-project claims and production project fail closed',async()=>{
 const f=harness(),original={...f.claims};
 for(const change of [
  {exp:1},{iat:Math.floor(Date.now()/1000)+600},
  {iss:'https://jrkefsylpfriiqefcmzq.supabase.co/auth/v1'},
  {sub:other},{aud:'service_role'}, {role:'anon'}
 ]){
  Object.assign(f.claims,change);
  assert.equal((await f.request({workspaceId:workspace})).status,403);
  Object.assign(f.claims,original);
 }
 assert.deepEqual(f.rpcCalls,[]);
 assert.throws(()=>supabaseSupervisedAuth({
  projectRef:'jrkefsylpfriiqefcmzq',
  auth:{async getClaims(){return {data:null,error:null};},async getUser(){return {data:{user:null},error:null};}},
  server:{async rpc(){return {data:null,error:null};}}
 }));
});

test('Cannot construct a probe with enabled host actions, providers or execution',()=>{
 const identify=async()=>({provenance:'SUPABASE_AUTH_STAGING' as const,actorId:owner,
  sessionId:session,workspaceId:workspace,projectRef,
  expiresAt:new Date(Date.now()+60000).toISOString()});
 for(const field of ['actionsEnabled','providersEnabled','liveEnabled'] as const){
  const deps={identify,liveEnabled:false,providersEnabled:false,actionsEnabled:false};
  assert.throws(()=>createStagingAuthReadinessProbe({...deps,[field]:true} as never));
 }
});
