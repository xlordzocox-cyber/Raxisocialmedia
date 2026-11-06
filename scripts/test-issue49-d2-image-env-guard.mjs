// Issue49 D2 H1.3 — imageInspect PG_VERSION must ignore hostile array methods.
// FAKE_ONLY: no Docker, sockets, SQL, process execution or network.
import {strict as assert} from 'node:assert';
import {createIssue49D2MockTransport,ISSUE49_D2_IMAGE_ID as PIN}
 from './issue49-d2-engine-api-mock.mjs';
const make=(env)=>createIssue49D2MockTransport({
 gate:'ISSUE49_D2_FAKE_ONLY',
 exchange:async descriptor=>{
  assert.equal(descriptor.method,'GET');
  assert.equal(descriptor.path,'/v1.51/images/'+PIN+'/json');
  return {status:200,data:{Id:PIN,Os:'linux',Architecture:'amd64',Config:{Env:env}}};
 }
});
let negatives=0;
const deny=async (env)=>{
 await assert.rejects(()=>make(env).call({operation:'imageInspect',imageId:PIN}),/ISSUE49 D2 MOCK STOP/);
 negatives++;
};
const env=['PG_VERSION=18.0'];
let getterCalls=0;
const inherited=Object.create(Array.prototype);
Object.defineProperty(inherited,'filter',{get(){
 getterCalls++;
 return ()=>[true]; // old code: fake pass on PostgreSQL 18
}});
Object.setPrototypeOf(env,inherited);
await deny(env);
assert.equal(getterCalls,0,'hostile .filter getter must not run');
await deny(['PG_VERSION=18.0','PG_VERSION=17.11']);
await deny(['PG_VERSION=17.11','PG_VERSION=18.0']);
const sparse=new Array(1);await deny(sparse);
const accessor=['PG_VERSION=17.11'];
Object.defineProperty(accessor,'0',{get(){throw Error('should not read');}});
await deny(accessor);
const good=['PG_VERSION=17.11','POSTGRES_USER=postgres'];
const result=await make(good).call({operation:'imageInspect',imageId:PIN});
assert.equal(result.Id,PIN);
assert.deepEqual(result.Config.Env,good);
console.log('PASS ISSUE49 D2 IMAGE ENV: '+negatives+'/5 adversarial negatives + valid PG17.11 (FAKE_ONLY)');
console.log('ISSUE49 D2 IMAGE ENV: NO_DOCKER / NO_SQL / NO_GO_HOSTED_MIGRATION');
