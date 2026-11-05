// Issue49: native-contract tests use synthetic objects only, NEVER Docker or SQL.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeT0T1Plan,T0T1_SOURCE_PATH} from './issue49-pr39-t0t1-offline-executor.mjs';
import {verifyNativeTrialPrerequisites,makeNativeTrialBlueprint,
  inspectSyntheticContainerSet,classifySyntheticCatalogComparisons}
 from './issue49-pr39-native-trial-contract.mjs';

assert.equal(process.argv.length,2,'No CLI options accepted');
const source=readFileSync(join(process.cwd(),T0T1_SOURCE_PATH),'utf8').replace(/\r\n/g,'\n');
const manifest=JSON.parse(readFileSync(join(process.cwd(),
 'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
const plan=makeT0T1Plan({source,manifest,environment:{},argv:['node','offline']});
const digest='a'.repeat(64);
const image={id:'sha256:'+digest,version:'PostgreSQL 17.11',
 os:'linux',architecture:'amd64',rootless:false,source:'LOCALLY_INSPECTED'};
const host='npipe:////./pipe/dockerDesktopLinuxEngine';
const context={Name:'desktop-linux',Endpoints:{docker:{Host:host,SkipTLSVerify:false}}};
const preInput=()=>({platform:'win32',environment:{},contextName:'desktop-linux',
 inspection:[structuredClone(context)],image:structuredClone(image)});
const prereq=verifyNativeTrialPrerequisites(preInput());
assert.equal(prereq.host,host);
assert.equal(prereq.nativeVerified,false);
const blueprint=makeNativeTrialBlueprint({plan,source,prerequisites:prereq,sessionId:'1'.repeat(24)});
assert.equal(blueprint.executionAvailable,false);
assert.equal(blueprint.executionAuthorized,false);
assert.equal(blueprint.allowCatalogPass,false);
assert.equal(blueprint.specs.length,4);
assert.equal(new Set(blueprint.specs.map(x=>x.name)).size,4);
const observations=blueprint.specs.map((s,i)=>({
 id:String(i+1).repeat(64),name:s.name,role:s.role,imageId:s.imageId,
 network:'none',publishPorts:false,privileged:false,binds:[],mounts:[],
 ownerLabel:s.expectedOwnerLabel,anonymousVolumes:[],existing:false
}));
const inspected=inspectSyntheticContainerSet({blueprint,observations});
assert.equal(inspected.cleanupStatus,'NOT_EXECUTED');
assert.equal(inspected.decision,'BLOCKED');
const capture=(cSource,cRestored,catSource,catRestored)=>({
 sourceConbinSha256:cSource,restoredConbinSha256:cRestored,
 sourceCatalogSha256:catSource,restoredCatalogSha256:catRestored,
 sourceBuildSha256:digest,restoredBuildSha256:digest
});
const a='b'.repeat(64),b='c'.repeat(64),c='d'.repeat(64);
assert.equal(classifySyntheticCatalogComparisons({
 t0:capture(a,b,a,b),t1:capture(a,a,c,c),cleanup:'COMPLETE'
}).finding,'T1_MICROSCHEMA_CANDIDATE_ONLY');
assert.equal(classifySyntheticCatalogComparisons({
 t0:capture(a,b,a,b),t1:capture(a,b,a,b),cleanup:'COMPLETE'
}).finding,'T1_NOT_CONFIRMED');
assert.equal(classifySyntheticCatalogComparisons({
 t0:capture(a,a,a,a),t1:capture(a,a,a,a),cleanup:'COMPLETE'
}).finding,'NOT_REPRODUCED');
assert.equal(classifySyntheticCatalogComparisons({
 t0:capture(a,a,a,a),t1:capture(a,b,a,b),cleanup:'COMPLETE'
}).finding,'INCONCLUSIVE');
console.log('PASS ISSUE49 NATIVE DESIGN: four owned isolated synthetic role specs; outcomes never authorize migration');

let denied=0;
const negative=(name,run)=>{
 assert.throws(run,/ISSUE49 NATIVE DESIGN STOP|PR39 STOP|ISSUE49 T0T1 OFFLINE STOP/,name);
 denied++;
};
for(const [label,change] of [
 ['remote daemon',v=>v.inspection[0].Endpoints.docker.Host='tcp://127.0.0.1:2375'],
 ['environment docker override',v=>v.environment.DOCKER_HOST='tcp://host:2375'],
 ['unexpected context',v=>v.contextName='remote'],
 ['different docker host',v=>v.inspection[0].Endpoints.docker.Host='unix:///var/run/docker.sock'],
 ['TLS enabled',v=>v.inspection[0].Endpoints.docker.SkipTLSVerify=true],
 ['extra endpoint',v=>v.inspection[0].Endpoints.ssh={Host:'ssh://remote'}],
 ['unverified image string',v=>v.image.id='postgres:17'],
 ['wrong postgres',v=>v.image.version='PostgreSQL 17.12'],
 ['wrong architecture',v=>v.image.architecture='arm64'],
 ['not linux image',v=>v.image.os='windows'],
 ['unexpected rootless',v=>v.image.rootless=true],
 ['unverified image provenance',v=>v.image.source='INTERNET']
])negative(label,()=>{const v=preInput();change(v);verifyNativeTrialPrerequisites(v);});
// Use an explicit mutation helper to avoid replacing a fixture in the tests.
for(const [label,change] of [
 ['wrong source',v=>v.source+='-- forged'],
 ['wrong session',v=>v.sessionId='S'.repeat(24)],
 ['fake prerequisite image',v=>v.prerequisites.imageId='sha256:'+'z'.repeat(64)],
 ['fake prerequisite host',v=>v.prerequisites.host='tcp://remote'],
 ['forged plan authorization',v=>v.plan.allowCatalogPass=true],
 ['forged plan DDL',v=>v.plan.variants[0].ddlSha256='0'.repeat(64)],
 ['forged candidate',v=>v.plan.inMemoryCandidateSha256='0'.repeat(64)]
]){
 const spec=()=>({plan:structuredClone(plan),source,
   prerequisites:structuredClone(prereq),sessionId:'1'.repeat(24)});
 negative(label,()=>{const v=spec();change(v);makeNativeTrialBlueprint(v);});
}
for(const [label,change] of [
 ['missing container',(_p,o)=>o.pop()],
 ['unexpected extra container',(_p,o)=>o.push({...o[0],id:'f'.repeat(64)})],
 ['reused ID',(_p,o)=>o[1].id=o[0].id],
 ['renamed container',(_p,o)=>o[0].name='someone-elses-container'],
 ['owner mismatch',(_p,o)=>o[0].ownerLabel='other'],
 ['role swapped',(_p,o)=>o[1].role='T1_SOURCE'],
 ['public port',(_p,o)=>o[0].publishPorts=true],
 ['network enabled',(_p,o)=>o[1].network='bridge'],
 ['privileged',(_p,o)=>o[0].privileged=true],
 ['host mount',(_p,o)=>o[0].binds=['C:/'],
 ['unexpected volume mount',(_p,o)=>o[0].mounts=['/var/run/docker.sock']],
 ['existing container',(_p,o)=>o[0].existing=true],
 ['different image',(_p,o)=>o[2].imageId='sha256:'+'f'.repeat(64)],
 ['bad anonymous volume',(_p,o)=>o[0].anonymousVolumes=['someone-elses-volume']],
 ['extra observation property',(_p,o)=>o[0].allowCatalogPass=true],
 ['changed blueprint role',(p,_o)=>p.specs[0].role='ADMIN'],
 ['changed blueprint label',(p,_o)=>p.specs[1].expectedOwnerLabel='unsafe'],
 ['changed blueprint order',(p,_o)=>p.stageNames.reverse()],
 ['changed blueprint auth',(p,_o)=>p.executionAuthorized=true],
 ['wrong blueprint digest',(p,_o)=>p.specs[0].ddlSha256='0'.repeat(64)],
 ['added privileged blueprint',(p,_o)=>p.specs[0].privileged=true]
]){
 negative(label,()=>{
  const p=structuredClone(blueprint),o=structuredClone(observations);
  change(p,o);inspectSyntheticContainerSet({blueprint:p,observations:o});
 });
}
for(const [label,change] of [
 ['cleanup absent',x=>x.cleanup='INCOMPLETE'],
 ['catalog hash missing',x=>delete x.t0.sourceCatalogSha256],
 ['catalog digest wrong',x=>x.t1.restoredConbinSha256='oops'],
 ['build differs across source-restored',x=>x.t0.restoredBuildSha256='f'.repeat(64)],
 ['build differs across variants',x=>x.t1.sourceBuildSha256='e'.repeat(64)]
]){
 negative(label,()=>{
  const x={t0:capture(a,b,a,b),t1:capture(a,a,c,c),cleanup:'COMPLETE'};
  change(x);classifySyntheticCatalogComparisons(x);
 });
}
console.log('PASS ISSUE49 NATIVE DESIGN NEGATIVES ('+denied+' rejected synthetic cases; no Docker/SQL/network)');
console.log('ISSUE49 STATUS: DESIGN_ONLY / BLOCKED / NO_GO_HOSTED_MIGRATION');
