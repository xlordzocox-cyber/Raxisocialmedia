/** Issue60: composition tests use synthetic sessions and no live credentials/network. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUnpublishedStagingAuthHost,SERVER_AUTH_OPTIONS,type StagingAuthHostComposition} from '../../../server/agent-runtime/stagingAuthHostComposition';

const projectUrl='https://zvhxjindgyvtasstfjut.supabase.co';
const owner='60000000-0000-4000-8000-000000000002';
const workspace='60000000-0000-4000-8000-000000000001';
const session='60000000-0000-4000-8000-000000000003';
const foreign='60000000-0000-4000-8000-000000000004';
const publishableKey='sb_publishable_fake-test-only';
const privilegedKey='sb_secret_fake-test-only';
const bearer='synthetic-bearer-no-network';
function harness() {
 let active=true,actor=owner,callCount=0;
 const seen:{kind:'user'|'privileged';url:string;key:string;options:unknown}[]=[];
 const claims=()=>({
  iss:projectUrl+'/auth/v1',sub:actor,aud:'authenticated',role:'authenticated',is_anonymous:false,
  session_id:session,iat:Math.floor(Date.now()/1000)-10,exp:Math.floor(Date.now()/1000)+600,
 });
 const deps:StagingAuthHostComposition={
  projectUrl,publishableKey,privilegedKey,liveEnabled:false,providersEnabled:false,actionsEnabled:false,
  makeUserAuth(url,key,options){
   seen.push({kind:'user',url,key,options});
   return {
    async getClaims(token){return token===bearer?{data:{claims:claims()},error:null}:{data:null,error:'no-token'};},
    async getUser(token){return token===bearer?{data:{user:{id:actor,is_anonymous:false}},error:null}:{data:{user:null},error:'no-user'};},
   };
  },
  makePrivilegedRpc(url,key,options){
   seen.push({kind:'privileged',url,key,options});
   return {async rpc(name,args){
    callCount++;
    assert.equal(name,'raxi_supervised_host_identity');
    assert.equal(JSON.stringify(args).includes(privilegedKey),false);
    const identity=args.p_identity as {actorId:string;sessionId:string;workspaceId:string;projectRef:string};
    return {data:active&&actor===owner&&identity.actorId===owner&&identity.sessionId===session&&
     identity.workspaceId===workspace&&identity.projectRef==='zvhxjindgyvtasstfjut',error:null};
   }};
  },
 };
 const handler=createUnpublishedStagingAuthHost(deps);
 const request=(body:unknown,token=bearer)=>handler(new Request('https://unpublished.invalid/never-mounted',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify(body),
 }));
 return {request,seen,deps,revoke(){active=false;},changeUser(){actor=foreign;},
  get callCount(){return callCount;}};
}

test('Composition requires two isolated credentials and no browser persistence',async()=>{
 const h=harness();
 assert.equal(h.seen.length,2);
 assert.deepEqual(h.seen.map(({kind,url,key,options})=>({kind,url,key,options})),[
  {kind:'user',url:projectUrl,key:publishableKey,options:SERVER_AUTH_OPTIONS},
  {kind:'privileged',url:projectUrl,key:privilegedKey,options:SERVER_AUTH_OPTIONS},
 ]);
 assert.equal(Object.isFrozen(SERVER_AUTH_OPTIONS),true);
 const r=await h.request({workspaceId:workspace});
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.hostEnabled,false);
 assert.equal(body.actionsEnabled,false);
 assert.equal(body.providersEnabled,false);
 assert.equal(body.executionEnabled,false);
 assert.equal(JSON.stringify(body).includes(privilegedKey),false);
 assert.equal(JSON.stringify(body).includes(bearer),false);
 assert.equal(JSON.stringify(body).includes(owner),false);
 assert.equal(h.callCount,1);
});

test('Only one actual owner is needed; revoked session and synthetic foreign user fail closed',async()=>{
 const h=harness();
 assert.equal((await h.request({workspaceId:workspace})).status,200);
 h.revoke();
 assert.equal((await h.request({workspaceId:workspace})).status,403);
 assert.equal(h.callCount,2,'Session ownership must be rechecked each time, not cached');
 const foreignHarness=harness();
 foreignHarness.changeUser();
 assert.equal((await foreignHarness.request({workspaceId:workspace})).status,403);
 assert.equal(foreignHarness.callCount,0,'Foreign claims cannot reach privileged RPC');
});

test('No hidden action or foreign workspace can enter the inert host',async()=>{
 const h=harness();
 for(const body of [
  {workspaceId:workspace,action:'execute'},
  {workspaceId:workspace,provider:'openai'},
  {workspaceId:foreign},
 ])assert.equal((await h.request(body)).status,403);
 assert.equal(h.callCount,1,'Only syntactically valid foreign workspace calls identity');
});

test('Wrong project, reused/missing credentials and enabled flags are rejected before client creation',()=>{
 const invalid:Array<Partial<StagingAuthHostComposition>>=[
  {projectUrl:'https://jrkefsylpfriiqefcmzq.supabase.co'},
  {projectUrl:projectUrl+'/'},{projectUrl:'https://not-staging.invalid'},
  {publishableKey:'legacy-anon-key'},
  {publishableKey:''},{privilegedKey:''},
  {privilegedKey:publishableKey},{privilegedKey:'sb_publishable_wrong'},
  {liveEnabled:true as never},{actionsEnabled:true as never},{providersEnabled:true as never},
 ];
 for(const change of invalid){
  let constructed=0;
  const deps:StagingAuthHostComposition={
   projectUrl,publishableKey,privilegedKey,liveEnabled:false,actionsEnabled:false,providersEnabled:false,
   makeUserAuth(){constructed++;throw Error('Must not construct');},
   makePrivilegedRpc(){constructed++;throw Error('Must not construct');},
   ...change,
  };
  assert.throws(()=>createUnpublishedStagingAuthHost(deps),JSON.stringify(change));
  assert.equal(constructed,0,JSON.stringify(change));
 }
});
