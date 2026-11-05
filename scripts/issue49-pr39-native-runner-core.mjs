// Issue #49 — native T0/T1 trial state machine, NO bundled Docker transport.
// Importing this module does nothing; it never discovers, launches or deletes resources.
// A separately reviewed local driver and explicit future consent are both required.
import {assertPlanIsBlocked} from './issue49-pr39-t0t1-offline-executor.mjs';
import {makeNativeTrialBlueprint} from './issue49-pr39-native-trial-contract.mjs';
import {prepareOfflineNativeAdapter} from './issue49-pr39-adapter-offline.mjs';

const stop=x=>{throw Error('ISSUE49 NATIVE RUNNER STOP: '+x);};
const sha=/^[a-f0-9]{64}$/;
const img=/^sha256:[a-f0-9]{64}$/;
const names=['T0_SOURCE','T0_RESTORED','T1_SOURCE','T1_RESTORED'];
const driverKeys=['attestLocal','attestImage','create','inspect','start','initialize',
  'dump','restore','catalog','remove','confirmRemoved'];
const own=(x,k)=>x!==null&&typeof x==='object'&&Object.hasOwn(x,k);
const HOSTS=['npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine','unix:///var/run/docker.sock'];
const sameStructure=(a,b)=>{
 if(Array.isArray(b))return Array.isArray(a)&&a.length===b.length&&
   Reflect.ownKeys(a).length===b.length+1&&
   b.every((v,i)=>Object.hasOwn(a,i)&&sameStructure(a[i],v));
 if(b!==null&&typeof b==='object')return a!==null&&typeof a==='object'&&
   Object.getPrototypeOf(a)===Object.prototype&&
   Reflect.ownKeys(a).length===Reflect.ownKeys(b).length&&
   Reflect.ownKeys(b).every(k=>Object.hasOwn(a,k)&&sameStructure(a[k],b[k]));
 return a===b;
};
const onlyKeys=(obj,fields)=>obj!==null&&typeof obj==='object'&&
 !Array.isArray(obj)&&Object.getPrototypeOf(obj)===Object.prototype&&
 Reflect.ownKeys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k));
const exactArray=(x,values)=>Array.isArray(x)&&x.length===values.length&&
 Reflect.ownKeys(x).length===values.length+1&&
 values.every((v,i)=>Object.hasOwn(x,i)&&x[i]===v);
const safeError=e=>e instanceof Error?e.name:'UNKNOWN_ERROR';

export function prepareNativeTrial({plan,source,prerequisites,expectedImageId,sessionId}){
 assertPlanIsBlocked(plan,source);
 const adapter=prepareOfflineNativeAdapter({plan,source,prerequisites,expectedImageId,sessionId});
 const blueprint=makeNativeTrialBlueprint({plan,source,prerequisites,sessionId});
 if(adapter.executionAuthorized!==false||adapter.runtimeAvailable!==false||
   adapter.allowCatalogPass!==false||!exactArray(adapter.roles,names)||
   !img.test(expectedImageId)||blueprint.specs.length!==4||
   blueprint.specs.some((s,i)=>s.role!==names[i]||s.imageId!==expectedImageId))
   stop('untrusted preflight');
 return Object.freeze({
   version:'ISSUE49_NATIVE_TRIAL_PREPARED_V1',
   sessionId,host:prerequisites.host,imageId:expectedImageId,
   specs:Object.freeze(blueprint.specs.map(s=>Object.freeze({
     role:s.role,name:s.name,ownerLabel:s.expectedOwnerLabel,
     imageId:s.imageId,ddlSha256:s.ddlSha256,network:'none'
   }))),
   driverAttached:false,executionAuthorized:false,consentReceived:false,
   evidence:'DESIGN_ONLY_NOT_ATTESTED',decision:'BLOCKED',
   allowCatalogPass:false,hostedMigration:'NO_GO_HOSTED_MIGRATION'
 });
}
function validateConsent(consent,trial){
 const keys=['scope','sessionId','imageId','localOnly','syntheticOnly',
   'maxContainers','separateOperatorConsent'];
 if(!onlyKeys(consent,keys)||consent.scope!=='ISSUE49_LOCAL_T0T1_PG17_11'||
   consent.sessionId!==trial.sessionId||consent.imageId!==trial.imageId||
   consent.localOnly!==true||consent.syntheticOnly!==true||
   consent.maxContainers!==4||consent.separateOperatorConsent!==true)
   stop('separate operator consent required');
}
function validateDriver(driver){
 if(!onlyKeys(driver,driverKeys)||driverKeys.some(k=>typeof driver[k]!=='function'))
   stop('driver interface incomplete');
}
function validIdentity(v,expected,role){
 if(!onlyKeys(v,['id','name','role','ownerLabel','imageId','network','ports',
    'privileged','bindMounts','anonymousVolumes','existing'])||
   !sha.test(v.id)||v.name!==expected.name||v.role!==role||
   v.ownerLabel!==expected.ownerLabel||v.imageId!==expected.imageId||
   v.network!=='none'||v.ports!==false||v.privileged!==false||
   v.bindMounts!==false||v.existing!==false||
   !Array.isArray(v.anonymousVolumes)||v.anonymousVolumes.length!==1||
   Reflect.ownKeys(v.anonymousVolumes).length!==v.anonymousVolumes.length+1||
   Array.from({length:v.anonymousVolumes.length},(_,i)=>i).some(i=>
      !Object.hasOwn(v.anonymousVolumes,i)||!sha.test(v.anonymousVolumes[i])))
   stop('container identity or isolation untrusted');
}
const comparisonKeys=['conbinSha256','catalogSha256','buildSha256'];
function validCatalog(x){
 return onlyKeys(x,comparisonKeys)&&comparisonKeys.every(k=>sha.test(x[k]));
}
function compare(a,b){
 if(!validCatalog(a)||!validCatalog(b)||a.buildSha256!==b.buildSha256)
   stop('catalog provenance or build mismatch');
 return a.conbinSha256===b.conbinSha256&&a.catalogSha256===b.catalogSha256;
}
// An abstract orchestration: deliberately contains no subprocess, SQL client or Docker SDK.
// The supplied driver must undergo an independent code review before any real invocation.
export async function runNativeTrialWithDriver({
 trial,consent,driver,plan,source,prerequisites,expectedImageId,sessionId
}){
 // Bind every native action to the original source-attested offline plan.
 const expected=prepareNativeTrial({plan,source,prerequisites,expectedImageId,sessionId});
 if(!sameStructure(trial,expected))stop('trial not bound to pinned source and image');
 if(!onlyKeys(trial,['version','sessionId','host','imageId','specs','driverAttached',
    'executionAuthorized','consentReceived','evidence','decision','allowCatalogPass','hostedMigration'])||
    trial.version!=='ISSUE49_NATIVE_TRIAL_PREPARED_V1'||
    !img.test(trial.imageId)||!HOSTS.includes(trial.host)||
    !Array.isArray(trial.specs)||trial.specs.length!==4||
    trial.driverAttached!==false||trial.executionAuthorized!==false||
    trial.consentReceived!==false||trial.decision!=='BLOCKED'||
    trial.allowCatalogPass!==false||trial.hostedMigration!=='NO_GO_HOSTED_MIGRATION')
    stop('untrusted trial specification');
 for(let i=0;i<4;i++){
  const s=trial.specs[i];
  if(!onlyKeys(s,['role','name','ownerLabel','imageId','ddlSha256','network'])||
    s.role!==names[i]||s.imageId!==trial.imageId||!sha.test(s.ddlSha256)||
    s.name!=='raxi-t0t1-'+trial.sessionId+'-'+s.role.toLowerCase().replaceAll('_','-')||
    s.ownerLabel!=='raxi.issue49.trial.'+trial.sessionId||s.network!=='none')
    stop('tampered role specification');
 }
 if(trial.specs[0].ddlSha256!==trial.specs[1].ddlSha256||
    trial.specs[2].ddlSha256!==trial.specs[3].ddlSha256||
    trial.specs[0].ddlSha256===trial.specs[2].ddlSha256)
    stop('wrong T0/T1 fingerprints');
 validateConsent(consent,trial);
 validateDriver(driver);
 const ids=[],volumes=new Set(),volumesPerId=new Map(),created=[];
 let baseline=new Set();
 let failure=null,cleanupFailed=false,unknownCreatedIdentity=false,finding='INCONCLUSIVE';
 try{
  const daemon=await driver.attestLocal({host:trial.host});
  if(!onlyKeys(daemon,['host','local','verified','daemonId','preexistingVolumes'])||
     daemon.host!==trial.host||daemon.local!==true||daemon.verified!==true||
     typeof daemon.daemonId!=='string'||daemon.daemonId.length<4||
     !Array.isArray(daemon.preexistingVolumes)||
     Reflect.ownKeys(daemon.preexistingVolumes).length!==daemon.preexistingVolumes.length+1||
     daemon.preexistingVolumes.length>10000||
     daemon.preexistingVolumes.some(x=>typeof x!=='string'||x.length===0))
     stop('local daemon or volume baseline not attested');
  baseline=new Set(daemon.preexistingVolumes);
  if(baseline.size!==daemon.preexistingVolumes.length)
     stop('duplicate baseline volume names');
  const image=await driver.attestImage({imageId:trial.imageId});
  if(!onlyKeys(image,['id','version','os','architecture','verified'])||
     image.id!==trial.imageId||image.version!=='17.11'||
     image.os!=='linux'||image.architecture!=='amd64'||image.verified!==true)
     stop('immutable PG17.11 image not attested');
  for(let i=0;i<4;i++){
   const spec=trial.specs[i];
   let id;
   try{id=await driver.create({spec,host:trial.host});}
   catch(e){unknownCreatedIdentity=true;throw e;}
   if(typeof id!=='string'||!sha.test(id)||ids.includes(id)){
     unknownCreatedIdentity=true;stop('missing or repeated created container ID');
   }
   created.push({id,spec});ids.push(id);
   const observed=await driver.inspect({id,spec});
   validIdentity(observed,spec,names[i]);
   if(observed.id!==id)stop('changed container identity');
   for(const v of observed.anonymousVolumes){
    if(volumes.has(v)||baseline.has(v))
      stop('shared or preexisting volume');
    volumes.add(v);
   }
   volumesPerId.set(id,[...observed.anonymousVolumes]);
  }
  for(const resource of created)await driver.start({id:resource.id,spec:resource.spec});
  // SQL generation and verification belong to a reviewed transport. The driver
  // must use exactly the T0/T1 micro-schema associated with spec.ddlSha256.
  for(const i of [0,2]){
   await driver.initialize({id:created[i].id,spec:created[i].spec});
   const archive=await driver.dump({id:created[i].id,spec:created[i].spec});
   if(!(archive instanceof Uint8Array)||archive.byteLength===0||
      archive.byteLength>8*1024*1024)stop('invalid or oversized in-memory archive');
   await driver.restore({id:created[i+1].id,spec:created[i+1].spec,archive});
  }
  const catalogs=[];
  for(const r of created){
   const c=await driver.catalog({id:r.id,spec:r.spec});
   if(!validCatalog(c))stop('catalog evidence malformed');
   catalogs.push(c);
  }
  if(new Set(catalogs.map(x=>x.buildSha256)).size!==1)
    stop('cross-variant PG build mismatch');
  const t0=compare(catalogs[0],catalogs[1]);
  const t1=compare(catalogs[2],catalogs[3]);
  finding=!t0&&t1?'T1_MICROSCHEMA_CANDIDATE_ONLY':
    !t0&&!t1?'T1_NOT_CONFIRMED':t0&&t1?'NOT_REPRODUCED':'INCONCLUSIVE';
 }catch(e){failure=safeError(e);finding='INCONCLUSIVE';}
 finally{
  // Never global prune or search by name; only created full IDs are candidates.
  for(const resource of [...created].reverse()){
   try{
    const before=await driver.inspect({id:resource.id,spec:resource.spec});
    validIdentity(before,resource.spec,resource.spec.role);
    if(before.id!==resource.id||
       !sameStructure(before.anonymousVolumes,volumesPerId.get(resource.id)))
       stop('cleanup identity or storage changed');
    await driver.remove({id:resource.id,spec:resource.spec,
      anonymousVolumes:before.anonymousVolumes});
    const confirmation=await driver.confirmRemoved({id:resource.id,spec:resource.spec,
      anonymousVolumes:before.anonymousVolumes});
    if(!onlyKeys(confirmation,['containerGone','volumesGone'])||
       confirmation.containerGone!==true||confirmation.volumesGone!==true)
       stop('container or anonymous volume removal unconfirmed');
   }catch(_e){cleanupFailed=true;}
  }
 }
 if(cleanupFailed||unknownCreatedIdentity)finding='INCONCLUSIVE';
 return Object.freeze({
  finding,source:'NATIVE_DRIVER_REPORTED_NOT_INDEPENDENTLY_ATTESTED',
  cleanup:unknownCreatedIdentity?'UNKNOWN_CREATED_IDENTITY':
    cleanupFailed?'RESOURCE_REMAINS':
    created.length===0?'NOT_REQUIRED_NO_RESOURCES':'ALL_TRACKED_IDS_AND_VOLUMES_REMOVED',
  createdCount:created.length,reportableError:failure,
  decision:'BLOCKED',semanticEquivalence:'NOT_VERIFIED',
  allowCatalogPass:false,hostedMigration:'NO_GO_HOSTED_MIGRATION'
 });
}
