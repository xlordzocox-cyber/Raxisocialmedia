/** Issue49 pre-JWT SQL adapter: all tests offline with fake Supabase,
 * no actual token/secret, no network, no deployment, no task execution.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {createClient} from '@supabase/supabase-js';
import {createDirectorSqlPreauthAdmission} from '../server/stagingDirectorSqlPreauth';
import {createUnpublishedDirectorNodeGateWithSqlPreauth} from '../server/stagingDirectorNodeGate';
import {STAGING_DIRECTOR_READINESS_PATH} from '../server/stagingNodeAuthIngress';

const secret='test-only-HMAC-secret-not-for-production-'.repeat(2);
const first='trusted:one-owner-browser-001';
const second='trusted:one-owner-browser-002';
const origin='https://raxi-hq-staging-q5c16dvsm-xlordzocox-cybers-projects.vercel.app';
const workspace='60000000-0000-4000-8000-000000000001';
const task='60000000-0000-4000-8000-000000000005';
const owner='60000000-0000-4000-8000-000000000002';
const session='60000000-0000-4000-8000-000000000003';
const url='https://zvhxjindgyvtasstfjut.supabase.co';
const publishable='sb_publishable_synthetic-offline';
const privileged='sb_secret_synthetic-offline';

test('HMAC secret binds only trusted ingress identity; SQL never sees IP/header/raw secret',async()=>{
 const calls:Array<{name:string;digest:string}>=[];
 const gate=createDirectorSqlPreauthAdmission({hmacSecret:secret,server:{
  async rpc(name,args){calls.push({name,digest:args.p_client_digest});
   return {data:{status:'ALLOWED'},error:null};},
 }});
 assert.equal(await gate.admit(first),'ALLOW');
 assert.equal(await gate.admit(first),'ALLOW');
 assert.equal(await gate.admit(second),'ALLOW');
 assert.equal(calls.length,3);
 assert.ok(calls.every(x=>x.name==='raxi_director_preauth_admit'&&
  /^[a-f0-9]{64}$/.test(x.digest)&&!x.digest.includes('trusted')));
 assert.equal(calls[0].digest,calls[1].digest);
 assert.notEqual(calls[1].digest,calls[2].digest);
 assert.equal(JSON.stringify(calls).includes(secret),false);
});
test('Malformed origin keys and missing cryptographic secret fail before any RPC',async()=>{
 let called=0;
 const server={async rpc(_n:'raxi_director_preauth_admit',_args:{p_client_digest:string}){
  called++;return {data:{status:'ALLOWED'},error:null};}};
 for(const key of ['x','127.0.0.1','8.8.8.8','client key with spaces',
  'x'.repeat(129),'\ntrusted:forged', '']){
  const gate=createDirectorSqlPreauthAdmission({hmacSecret:secret,server});
  await assert.rejects(()=>gate.admit(key));
 }
 for(const key of ['', 'short',privileged,publishable]){
  assert.throws(()=>createDirectorSqlPreauthAdmission({hmacSecret:key,server}));
 }
 assert.equal(called,0);
});
test('SQL errors, malformed results and denials fail closed',async()=>{
 for(const result of [
  {data:null,error:'down'}, {data:null,error:null},
  {data:{status:'ALLOWED',token:'leak'},error:null},
  {data:{status:'UNVERIFIED'},error:null},
 ]){
  const gate=createDirectorSqlPreauthAdmission({hmacSecret:secret,server:{
   async rpc(){return result;} }});
  await assert.rejects(()=>gate.admit(first));
 }
 const denied=createDirectorSqlPreauthAdmission({hmacSecret:secret,server:{
  async rpc(){return {data:{status:'RATE_LIMITED'},error:null};},
 }});
 assert.equal(await denied.admit(first),'DENY');
});

function composite() {
 const calls:string[]=[];
 let preauthResult:'ALLOWED'|'RATE_LIMITED'='ALLOWED',preauthDown=false,revoked=false;
 const digestCalls:string[]=[];
 const sdk=((project:string,key:string,options:{auth:{persistSession:boolean}})=>{
  assert.equal(project,url);
  assert.equal(options.auth.persistSession,false);
  if(key===publishable) return {auth:{
   async getClaims(token:string) {
    calls.push('getClaims');
    return token==='fake-token'?{data:{claims:{
     iss:url+'/auth/v1',aud:'authenticated',role:'authenticated',
     sub:owner,session_id:session,is_anonymous:false,
     exp:Math.floor(Date.now()/1000)+600,iat:Math.floor(Date.now()/1000)-5,
    }},error:null}:{data:null,error:'invalid'};
   },
   async getUser(token:string) {
    calls.push('getUser');
    return {data:{user:token==='fake-token'?
     {id:owner,is_anonymous:false}:null},error:null};
   },
  }};
  if(key===privileged)return {async rpc(name:string,args:Record<string,unknown>){
   calls.push(name);
   if(name==='raxi_director_preauth_admit'){
    const digest=args.p_client_digest as string;
    digestCalls.push(digest);
    assert.match(digest,/^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(args),['p_client_digest']);
    if(preauthDown)return {data:null,error:'offline'};
    return {data:{status:preauthResult},error:null};
   }
   const id=args.p_identity as {sessionId:string;actorId:string;workspaceId:string};
   if(name==='raxi_supervised_host_identity')
    return {data:!revoked&&id.sessionId===session&&id.actorId===owner&&
      id.workspaceId===workspace,error:null};
   if(name==='raxi_supervised_request_rate_admit')
    return {data:{status:'ALLOWED',operation:'PREFLIGHT'},error:null};
   if(name==='raxi_director_real_read')
    return {data:null,error:null};
   throw Error('Unlisted RPC '+name);
  }};
  throw Error('Unknown key');
 }) as unknown as typeof createClient;
 const handler=createUnpublishedDirectorNodeGateWithSqlPreauth({
  projectUrl:url,publishableKey:publishable,privilegedKey:privileged,
  approvedOrigin:origin,preauthHmacSecret:secret,
 },sdk);
 const request=(context={rateKey:first})=>handler(new Request(origin+STAGING_DIRECTOR_READINESS_PATH,{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
   Authorization:'Bearer fake-token'},body:JSON.stringify({workspaceId:workspace,taskId:task}),
 }),context);
 return {request,calls,digestCalls,revoke(){revoked=true;},
  deny(){preauthResult='RATE_LIMITED';},outage(){preauthDown=true;}};
}
test('Concrete future Node factory invokes pre-JWT PG HMAC before ANY Auth and returns no execution grant',async()=>{
 const h=composite();
 const result=await h.request();
 assert.equal(result.status,200);
 assert.equal((await result.json()).executionEnabled,false);
 assert.equal(h.calls[0],'raxi_director_preauth_admit');
 assert.ok(h.calls.indexOf('getClaims')>0);
 assert.equal(h.digestCalls.length,1);
 assert.equal(h.calls.filter(x=>x==='raxi_supervised_host_identity').length,2);
});
test('Concrete factory SQL gate denial/outage stops before signed JWT verification',async()=>{
 const deny=composite();deny.deny();
 assert.equal((await deny.request()).status,429);
 assert.equal(deny.calls.filter(x=>x==='getClaims').length,0);
 const failure=composite();failure.outage();
 assert.equal((await failure.request()).status,503);
 assert.equal(failure.calls.filter(x=>x==='getClaims').length,0);
 const revoked=composite();revoked.revoke();
 assert.equal((await revoked.request()).status,403);
});
test('Concrete factory refuses caller-injected admission and production/weak secrets',()=>{
 const configs=[
  {preauthHmacSecret:'weak'},
  {projectUrl:'https://jrkefsylpfriiqefcmzq.supabase.co'},
  {preauthHmacSecret:privileged},
  {preauthHmacSecret:publishable},
  {approvedOrigin:'https://evil.example'},
  {admission:{async admit(){return 'ALLOW' as const;}}},
 ];
 for(const change of configs){
  let created=0;
  const fake=(()=>{created++;throw Error('No SDK client should construct');}) as unknown as typeof createClient;
  assert.throws(()=>createUnpublishedDirectorNodeGateWithSqlPreauth({
   projectUrl:url,publishableKey:publishable,privilegedKey:privileged,
   approvedOrigin:origin,preauthHmacSecret:secret,...change,
  },fake),JSON.stringify(Object.keys(change)));
  assert.equal(created,0);
 }
});
