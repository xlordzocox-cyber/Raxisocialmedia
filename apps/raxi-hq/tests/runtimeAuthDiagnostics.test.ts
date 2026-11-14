/** Doubles only. The real-JWT test requires a logged-in staging Preview. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checkHostedRuntimeAuth} from '../src/runtime/runtimeAuthDiagnostics';

const owner='60000000-0000-4000-8000-000000000002';
const workspace='60000000-0000-4000-8000-000000000001';
const unknown='60000000-0000-4000-8000-000000000999';
const snapshot={ownerId:owner,workspaceId:workspace,serverTime:new Date().toISOString(),tasks:[],events:[]};

function fixture(){
 let user={id:owner,is_anonymous:false},getUserError=false,ownerBody:unknown=snapshot,
  ownError:string|null=null,unknownError:string|null='42501',anonError:string|null='42501',throwUnknown=false;
 const calls:string[]=[];
 const ownerClient={
  auth:{async getUser(){calls.push('getUser');return {data:{user},error:getUserError?{code:'invalid_user'}:null};}},
  async rpc(name:string,args:{p_workspace:string}){
   assert.equal(name,'raxi_runtime_office','No writable RPC is ever allowed');
   calls.push('ownerRpc:'+args.p_workspace);
   if(args.p_workspace===workspace)return {data:ownError?null:ownerBody,error:ownError?{code:ownError}:null};
   if(throwUnknown)throw Error('network unavailable');
   return {data:unknownError?null:snapshot,error:unknownError?{code:unknownError}:null};
  },
 } as unknown as SupabaseClient;
 const anonClient={
  async rpc(name:string,args:{p_workspace:string}){
   assert.equal(name,'raxi_runtime_office');
   assert.equal(args.p_workspace,workspace);
   calls.push('anonRpc');
   return {data:anonError?null:snapshot,error:anonError?{code:anonError}:null};
  },
 } as unknown as SupabaseClient;
 return {ownerClient,anonClient,calls,
  setUser(id:string,anonymous=false){user={id,is_anonymous:anonymous};},
  failUser(){getUserError=true;},setOwnBody(v:unknown){ownerBody=v;},
  setOwnError(code:string){ownError=code;},setUnknownError(code:string|null){unknownError=code;},
  setAnonError(code:string|null){anonError=code;},setUnknownNetworkFailure(){throwUnknown=true;}
 };
}
const run=(f:ReturnType<typeof fixture>,other=unknown)=>checkHostedRuntimeAuth(f.ownerClient,f.anonClient,owner,workspace,other);

test('Manual Auth test only reads session, owned RPC, unknown workspace and anon RPC',async()=>{
 const f=fixture(),r=await run(f);
 assert.deepEqual(r,{
  user:'PASS',ownerWorkspace:'PASS',unknownWorkspace:'PASS',anonymous:'PASS',
  sessionRevocation:'NOT_TESTED',secondRealUser:'NOT_TESTED',
 });
 assert.deepEqual(f.calls,['getUser','ownerRpc:'+workspace,'ownerRpc:'+unknown,'anonRpc']);
});

test('Missing/anonymous/foreign user never triggers RPCs',async()=>{
 for(const variant of ['other','anonymous','invalid']){
  const f=fixture();
  if(variant==='other')f.setUser(unknown);
  if(variant==='anonymous')f.setUser(owner,true);
  if(variant==='invalid')f.failUser();
  const r=await run(f);
  assert.equal(r.user,'FAIL');assert.equal(r.ownerWorkspace,'NOT_TESTED');
  assert.deepEqual(f.calls,['getUser']);
 }
});

test('Failed or mismatched own RPC cannot be reported as an authenticated connection',async()=>{
 for(const variant of ['permission','owner','workspace','missing'] as const){
  const f=fixture();
  if(variant==='permission')f.setOwnError('42501');
  if(variant==='owner')f.setOwnBody({...snapshot,ownerId:unknown});
  if(variant==='workspace')f.setOwnBody({...snapshot,workspaceId:unknown});
  if(variant==='missing')f.setOwnBody(null);
  const r=await run(f);
  assert.equal(r.user,'PASS');assert.equal(r.ownerWorkspace,'FAIL');
  assert.equal(r.unknownWorkspace,'NOT_TESTED');
  assert.deepEqual(f.calls,['getUser','ownerRpc:'+workspace]);
 }
});

test('Network errors, missing RPC or unauthorized-success responses are never mistaken for proof of isolation',async()=>{
 {
  const f=fixture();f.setUnknownNetworkFailure();
  const r=await run(f);assert.equal(r.unknownWorkspace,'NOT_TESTED');
  assert.equal(r.anonymous,'PASS');
 }
 for(const code of ['PGRST202',null]){
  const f=fixture();f.setUnknownError(code);f.setAnonError(code);
  const r=await run(f);
  assert.equal(r.unknownWorkspace,'FAIL');
  assert.equal(r.anonymous,'FAIL');
 }
});

test('Cannot test the same workspace as unauthorized, or claim revocation and second-account JWT tests occurred',async()=>{
 const f=fixture(),r=await run(f,workspace);
 assert.equal(r.unknownWorkspace,'FAIL');assert.equal(r.anonymous,'PASS');
 assert.equal(r.sessionRevocation,'NOT_TESTED');assert.equal(r.secondRealUser,'NOT_TESTED');
 assert.equal(f.calls.includes('ownerRpc:'+unknown),false);
});
