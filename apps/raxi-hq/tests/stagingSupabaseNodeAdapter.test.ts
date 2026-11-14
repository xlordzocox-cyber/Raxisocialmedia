/** Entirely offline: fake SDK clients and synthetic claims, no actual JWT or Supabase calls. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {createClient} from '@supabase/supabase-js';
import {createUnpublishedStagingNodeAuthProbe} from '../server/stagingSupabaseNodeAdapter';

const projectUrl='https://zvhxjindgyvtasstfjut.supabase.co';
const own='60000000-0000-4000-8000-000000000002';
const other='60000000-0000-4000-8000-000000000004';
const workspace='60000000-0000-4000-8000-000000000001';
const foreignWorkspace='60000000-0000-4000-8000-000000000005';
const session='60000000-0000-4000-8000-000000000003';
const token='fake-signed-jwt-NOT-REAL';
const publishableKey='sb_publishable_synthetic-for-tests';
const privilegedKey='sb_secret_synthetic-for-tests';

function harness() {
 let currentOwner=own,revoked=false,anonymous=false,expired=false;
 let claimCalls=0,userCalls=0,rpcCalls=0;
 const seen:Array<{url:string;key:string;auth:Record<string,unknown>}>=[],rpcNames:string[]=[];
 const sdk=((url:string,key:string,options:{auth:Record<string,unknown>})=>{
  seen.push({url,key,auth:options.auth});
  if(key===publishableKey) return {
   auth:{
    async getClaims(value:string){
     claimCalls++;
     if(value!==token)return {data:null,error:{message:'invalid'}};
     return {data:{claims:{
      iss:projectUrl+'/auth/v1',aud:'authenticated',role:'authenticated',sub:currentOwner,
      session_id:session,is_anonymous:anonymous,
      iat:Math.floor(Date.now()/1000)-2,
      exp:expired?1:Math.floor(Date.now()/1000)+600,
     }},error:null};
    },
    async getUser(value:string){
     userCalls++;
     return {data:{user:value===token?{id:currentOwner,is_anonymous:anonymous}:null},
      error:value===token?null:{message:'invalid'}};
    },
   },
   rpc(){throw Error('User client may never call privileged RPC');},
  };
  if(key===privilegedKey) return {
   auth:{
    getClaims(){throw Error('Privileged client may not verify caller JWT');},
    getUser(){throw Error('Privileged client may not fetch caller user');},
    setSession(){throw Error('No session may be set on privileged client');},
   },
   async rpc(name:string,args:Record<string,unknown>) {
    rpcCalls++;rpcNames.push(name);
    assert.equal(name,'raxi_supervised_host_identity');
    assert.deepEqual(Object.keys(args),['p_identity']);
    assert.equal(JSON.stringify(args).includes(token),false);
    assert.equal(JSON.stringify(args).includes(privilegedKey),false);
    const p=args.p_identity as {actorId:string;workspaceId:string;sessionId:string;projectRef:string};
    return {data:!revoked&&currentOwner===own&&p.actorId===own&&p.workspaceId===workspace&&
     p.sessionId===session&&p.projectRef==='zvhxjindgyvtasstfjut',error:null};
   },
  };
  throw Error('Unknown synthetic test key');
 }) as unknown as typeof createClient;
 const handler=createUnpublishedStagingNodeAuthProbe({
  projectUrl,publishableKey,privilegedKey,
 },sdk);
 const request=(body:unknown,sessionToken=token)=>handler(new Request('https://never-mounted.invalid/auth',{
  method:'POST',headers:{Authorization:'Bearer '+sessionToken,'Content-Type':'application/json'},
  body:JSON.stringify(body),
 }));
 return {request,seen,rpcNames,get claimCalls(){return claimCalls;},
  get userCalls(){return userCalls;},get rpcCalls(){return rpcCalls;},
  revoke(){revoked=true;},setOwner(id:string){currentOwner=id;},
  setAnonymous(){anonymous=true;},expire(){expired=true;}};
}

test('SDK adapter separates signed user Auth and privileged owner RPC, without session state',async()=>{
 const h=harness();
 assert.equal(h.seen.length,2);
 assert.deepEqual(h.seen.map(c=>c.key),[publishableKey,privilegedKey]);
 for(const c of h.seen){
  assert.equal(c.url,projectUrl);
  assert.deepEqual(c.auth,{
   persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,
  });
 }
 const response=await h.request({workspaceId:workspace});
 assert.equal(response.status,200);
 const text=await response.text();
 assert.equal(text.includes(token),false);
 assert.equal(text.includes(privilegedKey),false);
 assert.equal(text.includes(own),false);
 assert.match(text,/"executionEnabled":false/);
 assert.deepEqual([h.claimCalls,h.userCalls,h.rpcCalls],[1,1,1]);
 assert.deepEqual(h.rpcNames,['raxi_supervised_host_identity']);
});

test('Revocation is checked on every request and no success is cached',async()=>{
 const h=harness();
 assert.equal((await h.request({workspaceId:workspace})).status,200);
 h.revoke();
 assert.equal((await h.request({workspaceId:workspace})).status,403);
 assert.deepEqual([h.claimCalls,h.userCalls,h.rpcCalls],[2,2,2]);
});

test('Foreign synthetic actor and foreign workspace cannot impersonate owner',async()=>{
 const h=harness();
 h.setOwner(other);
 assert.equal((await h.request({workspaceId:workspace})).status,403);
 assert.equal(h.rpcCalls,1,'Foreign signed claims reach restricted ownership check');
 const ownHarness=harness();
 assert.equal((await ownHarness.request({workspaceId:foreignWorkspace})).status,403);
 assert.equal(ownHarness.rpcCalls,1);
});

test('Anonymous, expired and invalid JWT denied before privileged RPC',async()=>{
 for(const mode of ['anonymous','expired','invalid'] as const){
  const h=harness();
  if(mode==='anonymous')h.setAnonymous();
  if(mode==='expired')h.expire();
  const response=await h.request({workspaceId:workspace},mode==='invalid'?'wrong-token':token);
  assert.equal(response.status,403);
  assert.equal(h.rpcCalls,0);
 }
});

test('Command injection, oversized body and malformed workspace never reach SDK Auth',async()=>{
 const h=harness();
 for(const payload of [
  {workspaceId:workspace,action:'execute'},{workspaceId:workspace,action:'prepare'},
  {workspaceId:workspace,provider:'demo'}, {workspaceId:'not-a-uuid'},
  {workspaceId:workspace,authorization:'Bearer '+token},
  {workspaceId:workspace,padding:'x'.repeat(500)},
 ])assert.equal((await h.request(payload)).status,403);
 assert.deepEqual([h.claimCalls,h.userCalls,h.rpcCalls],[0,0,0]);
});

test('Wrong project, missing secret, and reused publishable key fail before SDK factory',()=>{
 for(const props of [
  {projectUrl:'https://jrkefsylpfriiqefcmzq.supabase.co'},
  {projectUrl:projectUrl+'/'},
  {privilegedKey:''},
  {privilegedKey:publishableKey},
  {privilegedKey:'legacy-service-jwt-not-approved'},
 ]){
  let created=0;
  const impossible=(()=>{created++;throw Error('Client must not construct');}) as unknown as typeof createClient;
  assert.throws(()=>createUnpublishedStagingNodeAuthProbe({
   projectUrl,publishableKey,privilegedKey,...props,
  },impossible));
  assert.equal(created,0);
 }
});

test('SDK must not hand the same client instance to user and privileged ports',()=>{
 const same={auth:{},rpc(){}};
 let count=0;
 const sdk=(()=>{count++;return same;}) as unknown as typeof createClient;
 assert.throws(()=>createUnpublishedStagingNodeAuthProbe({
  projectUrl,publishableKey,privilegedKey,
 },sdk),/cannot be reused/i);
 assert.equal(count,2);
});
