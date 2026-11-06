// Issue49 D2: regression for inherited array method accessors; FAKE_ONLY.
// No Docker, network, SQL, subprocess or filesystem writes.
import {strict as assert} from 'node:assert';
import {createIssue49D2MockTransport} from './issue49-d2-engine-api-mock.mjs';
const A='a'.repeat(64), B='b'.repeat(64);
const cases=[
 ['listContainers','every'],['listContainers','map'],
 ['listVolumes','every'],['listVolumes','map']
];
let passed=0;
for(const [operation,method] of cases){
 const entries=operation==='listContainers'?[{Id:A},{Id:B}]:[{Name:'volume_a'},{Name:'volume_b'}];
 let getterCalls=0;
 const proto=Object.create(Array.prototype);
 Object.defineProperty(proto,method,{get(){
   getterCalls++;
   entries.length=1; // previous d.every/map would silently lose the second identity
   return Array.prototype[method];
 }});
 Object.setPrototypeOf(entries,proto);
 const exchange=async descriptor=>{
   assert.equal(descriptor.method,'GET');
   assert.equal(descriptor.path,operation==='listContainers'
    ?'/v1.51/containers/json?all=1':'/v1.51/volumes');
   return {status:200,data:operation==='listContainers'?entries:
    {Volumes:entries,Warnings:[]}};
 };
 const transport=createIssue49D2MockTransport({gate:'ISSUE49_D2_FAKE_ONLY',exchange});
 const result=await transport.call({operation});
 const inventory=operation==='listContainers'?result:result.Volumes;
 assert.equal(getterCalls,0,'inherited method getter must never execute: '+operation+'/'+method);
 assert.equal(inventory.length,2,'inventory must retain cardinality');
 assert.deepEqual(inventory.map(x=>operation==='listContainers'?x.Id:x.Name),
  operation==='listContainers'?[A,B]:['volume_a','volume_b']);
 passed++;
}
console.log('PASS ISSUE49 D2 ARRAY METHODS: '+passed+'/4 inherited-getter regressions (FAKE_ONLY)');
console.log('ISSUE49 D2 ARRAY METHODS: NO_DOCKER / NO_SQL / NO_GO_HOSTED_MIGRATION');
