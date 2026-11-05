// Offline-only synthetic tests for Issue49 adapter. No Docker or SQL calls.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeT0T1Plan,T0T1_SOURCE_PATH} from './issue49-pr39-t0t1-offline-executor.mjs';
import {verifyNativeTrialPrerequisites,makeNativeTrialBlueprint}
 from './issue49-pr39-native-trial-contract.mjs';
import {prepareOfflineNativeAdapter,validateOfflineNativeAdapter,describeOfflineCleanupBarrier}
 from './issue49-pr39-adapter-offline.mjs';

assert.equal(process.argv.length,2,'no test options');
const source=readFileSync(join(process.cwd(),T0T1_SOURCE_PATH),'utf8').replace(/\r\n/g,'\n');
const manifest=JSON.parse(readFileSync(join(process.cwd(),
 'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
const plan=makeT0T1Plan({source,manifest,environment:{},argv:['node','offline']});
const image={id:'sha256:'+'a'.repeat(64),version:'PostgreSQL 17.11',
 os:'linux',architecture:'amd64',rootless:false,source:'LOCALLY_INSPECTED'};
const context={Name:'desktop-linux',Endpoints:{docker:{
 Host:'npipe:////./pipe/dockerDesktopLinuxEngine',SkipTLSVerify:false}}};
const prerequisites=verifyNativeTrialPrerequisites({
 platform:'win32',environment:{},contextName:'desktop-linux',
 inspection:[context],image
});
const sessionId='1'.repeat(24);
const expectedImageId=image.id; // independent pin, not copied from a mutated inspection
const opts={plan,source,prerequisites,sessionId,expectedImageId};
const adapter=prepareOfflineNativeAdapter(opts);
const blueprint=makeNativeTrialBlueprint(opts);
assert.equal(adapter.runtimeAvailable,false);
assert.equal(adapter.executionAuthorized,false);
assert.equal(adapter.cleanupAuthorized,false);
assert.equal(adapter.allowCatalogPass,false);
assert.equal(adapter.resourceNames.length,4);
assert.equal(validateOfflineNativeAdapter({adapter,...opts}).validatedOffline,true);
const observations=blueprint.specs.map((s,i)=>({
 id:String(i+1).repeat(64),name:s.name,role:s.role,imageId:s.imageId,
 network:'none',publishPorts:false,privileged:false,binds:[],mounts:[],
 ownerLabel:s.expectedOwnerLabel,anonymousVolumes:[],existing:false
}));
const cleanup=describeOfflineCleanupBarrier({blueprint,observations,plan,source});
assert.equal(cleanup.cleanupExecuted,false);
assert.equal(cleanup.deletionTargets.length,0);
console.log('PASS ISSUE49 ADAPTER OFFLINE: 4 roles, closed stages and no cleanup execution');

let denied=0;
function negative(label,fn){
 assert.throws(fn,/ISSUE49 ADAPTER STOP|ISSUE49 T0T1 OFFLINE STOP|ISSUE49 NATIVE DESIGN STOP/,label);
 denied++;
}
for(const [label,mutate] of [
 ['runtime available',x=>x.runtimeAvailable=true],
 ['execution granted',x=>x.executionAuthorized=true],
 ['cleanup granted',x=>x.cleanupAuthorized=true],
 ['catalog pass forged',x=>x.allowCatalogPass=true],
 ['hosted migration unblocked',x=>x.hostedMigration='READY'],
 ['scope forged',x=>x.origin='NATIVE_VALIDATED'],
 ['extra property',x=>x.runDocker=true],
 ['missing stage',x=>x.stages.pop()],
 ['reordered stages',x=>x.stages.reverse()],
 ['invented stage',x=>x.stages[0]='EXECUTE_DOCKER'],
 ['missing role',x=>x.roles.pop()],
 ['roles shuffled',x=>x.roles.reverse()],
 ['sparse roles array',x=>x.roles=new Array(4)],
 ['sparse stages array',x=>x.stages=new Array(8)],
 ['sparse resource names array',x=>x.resourceNames=new Array(4)],
 ['deleted role slot',x=>delete x.roles[1]],
 ['deleted stage slot',x=>delete x.stages[4]],
 ['deleted resource name slot',x=>delete x.resourceNames[2]],
 ['role renamed',x=>x.roles[0]='ADMIN'],
 ['changed resource name',x=>x.resourceNames[0]='existing-database'],
 ['duplicate resource names',x=>x.resourceNames[1]=x.resourceNames[0]],
 ['plan hash falsified',x=>x.sourcePlanHash='0'.repeat(64)],
 ['forged expected image in adapter',x=>x.expectedImageId='sha256:'+'f'.repeat(64)]
]){
 negative(label,()=>{
  const modified=structuredClone(adapter);
  mutate(modified);
  validateOfflineNativeAdapter({adapter:modified,...opts});
 });
}
for(const [label,mutate] of [
 ['changed source',x=>x.source+=' -- forged'],
 ['forged plan',x=>x.plan.allowCatalogPass=true],
 ['changed image pin',x=>x.prerequisites.imageId='sha256:'+'f'.repeat(64)],
 ['missing independent pin',x=>delete x.expectedImageId],
 ['invalid independent pin',x=>x.expectedImageId='postgres:17'],
 ['independent pin differs',x=>x.expectedImageId='sha256:'+'f'.repeat(64)],
 ['wrong session ID',x=>x.sessionId='INVALID'],
 ['faked role',x=>x.plan.variants[0].id='UNSAFE']
]){
 negative(label,()=>{
  const arg={...opts,plan:structuredClone(plan),
   prerequisites:structuredClone(prerequisites)};
  mutate(arg);prepareOfflineNativeAdapter(arg);
 });
}
for(const [label,mutate] of [
 ['missing observation',o=>o.pop()],
 ['privileged observed',o=>o[0].privileged=true],
 ['published ports',o=>o[0].publishPorts=true],
 ['network enabled',o=>o[1].network='bridge'],
 ['foreign owner',o=>o[0].ownerLabel='foreign'],
 ['shared anonymous storage',o=>{
  o[0].anonymousVolumes=['f'.repeat(64)];
  o[1].anonymousVolumes=['f'.repeat(64)];
 }],
 ['different container ID reused',o=>o[1].id=o[0].id]
]){
 negative(label,()=>{
  const copy=structuredClone(observations);
  mutate(copy);
  describeOfflineCleanupBarrier({blueprint,observations:copy,plan,source});
 });
}
console.log('PASS ISSUE49 ADAPTER OFFLINE NEGATIVES ('+denied+' rejected synthetic cases; no Docker/SQL)');
console.log('ISSUE49 ADAPTER STATUS: DESIGN_ONLY / BLOCKED / NO_GO_HOSTED_MIGRATION');
