// Issue49 native runner ORCHESTRATION mock QA. No Docker transport exists here.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeT0T1Plan,T0T1_SOURCE_PATH} from './issue49-pr39-t0t1-offline-executor.mjs';
import {verifyNativeTrialPrerequisites} from './issue49-pr39-native-trial-contract.mjs';
import {prepareNativeTrial,runNativeTrialWithDriver} from './issue49-pr39-native-runner-core.mjs';

assert.equal(process.argv.length,2,'no execution flags allowed');
const source=readFileSync(join(process.cwd(),T0T1_SOURCE_PATH),'utf8').replace(/\r\n/g,'\n');
const manifest=JSON.parse(readFileSync(join(process.cwd(),
 'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
const plan=makeT0T1Plan({source,manifest,environment:{},argv:['node','offline']});
const imageId='sha256:'+'a'.repeat(64);
const prerequisites=verifyNativeTrialPrerequisites({
 platform:'win32',environment:{},contextName:'desktop-linux',
 inspection:[{Name:'desktop-linux',Endpoints:{docker:{
  Host:'npipe:////./pipe/dockerDesktopLinuxEngine',SkipTLSVerify:false}}}],
 image:{id:imageId,version:'PostgreSQL 17.11',os:'linux',
  architecture:'amd64',rootless:false,source:'LOCALLY_INSPECTED'}
});
const sessionId='2'.repeat(24);
const cfg={plan,source,prerequisites,expectedImageId:imageId,sessionId};
const trial=prepareNativeTrial(cfg);
const consent={scope:'ISSUE49_LOCAL_T0T1_PG17_11',sessionId,
 imageId,localOnly:true,syntheticOnly:true,maxContainers:4,
 separateOperatorConsent:true};
assert.equal(trial.executionAuthorized,false);
assert.equal(trial.consentReceived,false);
assert.equal(trial.hostedMigration,'NO_GO_HOSTED_MIGRATION');

function fakeDriver(changes={}){
 const state={create:0,remove:[],calls:[],byId:new Map()};
 const base={
  async attestLocal(args){state.calls.push('attestLocal');return {
   host:args.host,local:true,verified:true,daemonId:'mock-linux-daemon',preexistingVolumes:[]};},
  async attestImage(args){state.calls.push('attestImage');return {
   id:args.imageId,version:'17.11',os:'linux',architecture:'amd64',verified:true};},
  async create({spec}){state.calls.push('create');state.create++;
   const id=String(state.create).repeat(64);
   state.byId.set(id,spec);return id;},
  async inspect({id,spec}){state.calls.push('inspect');
   return {id,name:spec.name,role:spec.role,ownerLabel:spec.ownerLabel,
    imageId:spec.imageId,network:'none',ports:false,privileged:false,
    bindMounts:false,anonymousVolumes:[String(Number(id[0])+5).repeat(64)],
    existing:false};},
  async start(){state.calls.push('start');},
  async initialize(){state.calls.push('initialize');},
  async dump(){state.calls.push('dump');return new Uint8Array([1,2,3]);},
  async restore(){state.calls.push('restore');},
  async catalog({spec}){state.calls.push('catalog');
   const n=spec.role==='T0_SOURCE'?'1':spec.role==='T0_RESTORED'?'2':'3';
   return {conbinSha256:n.repeat(64),catalogSha256:n.repeat(64),
    buildSha256:'a'.repeat(64)};},
  async remove({id}){state.calls.push('remove');state.remove.push(id);},
  async confirmRemoved(){state.calls.push('confirmRemoved');
   return {containerGone:true,volumesGone:true};}
 };
 return {state,driver:{...base,...changes}};
}
const good=fakeDriver();
const outcome=await runNativeTrialWithDriver({...cfg,trial,consent,driver:good.driver});
assert.equal(outcome.finding,'T1_MICROSCHEMA_CANDIDATE_ONLY');
assert.equal(outcome.cleanup,'ALL_TRACKED_IDS_AND_VOLUMES_REMOVED');
assert.equal(outcome.createdCount,4);
assert.equal(outcome.decision,'BLOCKED');
assert.equal(outcome.allowCatalogPass,false);
assert.equal(outcome.hostedMigration,'NO_GO_HOSTED_MIGRATION');
assert.equal(good.state.remove.length,4);
console.log('PASS ISSUE49 NATIVE CORE: four mocked roles, archive, strict catalog, exact-ID and volume cleanup');
let denied=0;
async function negative(label,fn){
 await fn();
 denied++;
}
for(const [label,change] of [
 ['absent consent',x=>delete x.consent],
 ['wrong session',x=>x.consent={...consent,sessionId:'0'.repeat(24)}],
 ['wrong consent image',x=>x.consent={...consent,imageId:'sha256:'+'f'.repeat(64)}],
 ['missing local-only consent',x=>x.consent={...consent,localOnly:false}],
 ['missing separate consent',x=>x.consent={...consent,separateOperatorConsent:false}],
 ['more containers authorized',x=>x.consent={...consent,maxContainers:5}],
 ['wrong consent scope',x=>x.consent={...consent,scope:'HOSTED'}],
 ['tampered Docker host',x=>x.trial={...trial,host:'tcp://localhost:2375'}],
 ['tampered trial image',x=>x.trial={...trial,imageId:'sha256:'+'b'.repeat(64)}],
 ['tampered role identity',x=>x.trial={...trial,specs:trial.specs.map((s,i)=>
   i===1?{...s,role:'ADMIN'}:s)}],
 ['tampered DDL hash',x=>x.trial={...trial,specs:trial.specs.map((s,i)=>
   i===2?{...s,ddlSha256:'f'.repeat(64)}:s)}],
 ['modified source',x=>x.source+='-- changed'],
 ['mutated image pin',x=>x.expectedImageId='sha256:'+'f'.repeat(64)],
 ['missing driver',x=>delete x.driver]
]){
 await negative(label,async()=>{
  const args={...cfg,trial,consent,driver:fakeDriver().driver};
  change(args);
  await assert.rejects(()=>runNativeTrialWithDriver(args),
   /ISSUE49 NATIVE RUNNER STOP|ISSUE49 T0T1 OFFLINE STOP|ISSUE49 ADAPTER STOP/,
   label);
 });
}
for(const [label,patch,expectedCleanup] of [
 ['wrong local daemon', {attestLocal:async()=>({host:'tcp://remote',local:false,verified:true,daemonId:'bad',preexistingVolumes:[]})},
  'NOT_REQUIRED_NO_RESOURCES'],
 ['image build mismatch', {attestImage:async({imageId:id})=>({
  id,version:'17.10',os:'linux',architecture:'amd64',verified:true})},
  'NOT_REQUIRED_NO_RESOURCES'],
 ['create with unknown identity',{create:async()=>{throw Error('CREATE_UNCERTAIN');}},
  'UNKNOWN_CREATED_IDENTITY'],
 ['oversize archive',{dump:async()=>new Uint8Array(8*1024*1024+1)},
  'ALL_TRACKED_IDS_AND_VOLUMES_REMOVED'],
 ['missing catalog hashes',{catalog:async()=>({})},
  'ALL_TRACKED_IDS_AND_VOLUMES_REMOVED'],
 ['unverified removal',{confirmRemoved:async()=>({containerGone:true,volumesGone:false})},
  'RESOURCE_REMAINS'],
 ['network escape',{inspect:async({id,spec})=>({id,name:spec.name,
  role:spec.role,ownerLabel:spec.ownerLabel,imageId:spec.imageId,
  network:'bridge',ports:false,privileged:false,bindMounts:false,
  anonymousVolumes:[],existing:false})},
  'RESOURCE_REMAINS'],
 ['preexisting volume reused',{
  attestLocal:async({host})=>({host,local:true,verified:true,
   daemonId:'mock-linux-daemon',preexistingVolumes:['7'.repeat(64)]})},
  'RESOURCE_REMAINS'],
 ['sparse volume identity',{inspect:async({id,spec})=>({id,name:spec.name,
  role:spec.role,ownerLabel:spec.ownerLabel,imageId:spec.imageId,
  network:'none',ports:false,privileged:false,bindMounts:false,
  anonymousVolumes:new Array(1),existing:false})},
  'RESOURCE_REMAINS']
]){
 await negative(label,async()=>{
  const x=fakeDriver(patch);
  const result=await runNativeTrialWithDriver({...cfg,trial,consent,driver:x.driver});
  assert.equal(result.finding,'INCONCLUSIVE',label);
  assert.equal(result.cleanup,expectedCleanup,label);
  assert.equal(result.allowCatalogPass,false,label);
 });
}
console.log('PASS ISSUE49 NATIVE CORE NEGATIVES ('+denied+' mocked adversarial cases; no Docker/SQL/network)');
console.log('ISSUE49 NATIVE CORE STATUS: MOCK_ONLY / NO_GO_HOSTED_MIGRATION');
