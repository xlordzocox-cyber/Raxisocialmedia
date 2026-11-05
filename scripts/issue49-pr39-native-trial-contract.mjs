// Issue49 / PR39: pure, fail-closed specification for a FUTURE PG17 native T0/T1 trial.
// No Docker subprocess, SQL, network, filesystem or mutation. This module cannot run a trial.
import {selectPr39LocalDockerHost} from './pr39-local-docker-guard.mjs';
import {assertPlanIsBlocked} from './issue49-pr39-t0t1-offline-executor.mjs';

const error=code=>{throw Error('ISSUE49 NATIVE DESIGN STOP: '+code);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const exactSequence=(actual,expected)=>Array.isArray(actual)&&
 actual.length===expected.length&&Reflect.ownKeys(actual).length===expected.length+1&&
 expected.every((value,i)=>Object.hasOwn(actual,i)&&actual[i]===value);
const denseArray=(actual,max)=>Array.isArray(actual)&&actual.length<=max&&
 Reflect.ownKeys(actual).length===actual.length+1&&
 Array.from({length:actual.length},(_,i)=>i).every(i=>Object.hasOwn(actual,i));
const SHA=/^[a-f0-9]{64}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const ROLES=['T0_SOURCE','T0_RESTORED','T1_SOURCE','T1_RESTORED'];
const STAGES=['ATTEST_LOCAL_DAEMON','ATTEST_PINNED_PG17_IMAGE',
 'CREATE_ISOLATED_SYNTHETIC_CONTAINERS','INSPECT_CONTAINER_OWNERSHIP_AND_ISOLATION',
 'CAPTURE_SOURCE_AND_RESTORED_CATALOG','STRICT_COMPARE_CATALOGS',
 'CLEANUP_EXACT_CREATED_IDENTITIES','HUMAN_REVIEW_EVIDENCE'];
export const NATIVE_TRIAL_SPEC_VERSION='ISSUE49_PG17_T0T1_NATIVE_SPEC_V1';
export const NATIVE_TRIAL_NO_GO='NO_GO_HOSTED_MIGRATION';

// This only validates caller-supplied future inspection data, NOT the actual daemon or image.
export function verifyNativeTrialPrerequisites({platform,environment,contextName,inspection,image}){
 const host=selectPr39LocalDockerHost({platform,environment,contextName,inspection});
 if(!exact(image,['id','version','os','architecture','rootless','source'])||
    !IMAGE.test(image.id)||image.version!=='PostgreSQL 17.11'||
    image.os!=='linux'||image.architecture!=='amd64'||
    image.rootless!==false||image.source!=='LOCALLY_INSPECTED')error('image metadata not pinned');
 return Object.freeze({host,imageId:image.id,imageVersion:image.version,
  provenance:'CALLER_SUPPLIED_NOT_ATTESTED',nativeVerified:false});
}

export function makeNativeTrialBlueprint({plan,source,prerequisites,sessionId}){
 assertPlanIsBlocked(plan,source);
 if(!exact(plan,['revision','scope','variants','pinnedMigrationSha256','inMemoryCandidateSha256',
   'stages','nativeExecutionAvailable','dockerInvoked','sqlExecuted','writePerformed',
   'allowCatalogPass','semanticEquivalence','decision','hostedMigration'])||
   plan.revision!=='ISSUE49_PG17_T0T1_OFFLINE_PLAN_V1'||
   plan.scope!=='SYNTHETIC_MICROSCHEMA_PLAN_ONLY'||
   plan.nativeExecutionAvailable!==false||plan.dockerInvoked!==false||
   plan.sqlExecuted!==false||plan.writePerformed!==false||
   plan.allowCatalogPass!==false||plan.semanticEquivalence!=='NOT_VERIFIED'||
   plan.decision!=='BLOCKED'||plan.hostedMigration!==NATIVE_TRIAL_NO_GO||
   !Array.isArray(plan.variants)||plan.variants.length!==2||
   plan.variants[0]?.id!=='T0'||plan.variants[1]?.id!=='T1'||
   !plan.variants.every(v=>exact(v,['id','ddlSha256','sourcePredicateSha256'])&&SHA.test(v.ddlSha256)&&SHA.test(v.sourcePredicateSha256))||
   !SHA.test(plan.inMemoryCandidateSha256)||!SHA.test(plan.pinnedMigrationSha256))error('offline plan not blocked');
 if(!exact(prerequisites,['host','imageId','imageVersion','provenance','nativeVerified'])||
   !['npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine','unix:///var/run/docker.sock'].includes(prerequisites.host)||
   !IMAGE.test(prerequisites.imageId)||prerequisites.imageVersion!=='PostgreSQL 17.11'||
   prerequisites.provenance!=='CALLER_SUPPLIED_NOT_ATTESTED'||
   prerequisites.nativeVerified!==false)error('prerequisites incomplete');
 if(typeof sessionId!=='string'||!/^[a-f0-9]{24}$/.test(sessionId))error('untrusted session ID');
 const specs=ROLES.map((role,i)=>Object.freeze({
   role,
   name:'raxi-t0t1-'+sessionId+'-'+role.toLowerCase().replaceAll('_','-'),
   imageId:prerequisites.imageId,
   network:'none',publishPorts:false,privileged:false,
   binds:Object.freeze([]),mounts:Object.freeze([]),
   sharedVolumes:false,existingContainerReuse:false,
   expectedOwnerLabel:'raxi.issue49.trial.'+sessionId,
   ddlSha256:plan.variants[i<2?0:1].ddlSha256
 }));
 return Object.freeze({
   version:NATIVE_TRIAL_SPEC_VERSION,
   scope:'FUTURE_LOCAL_SYNTHETIC_ONLY',
   evidenceProvenance:'UNVERIFIED_DESIGN_FIXTURE',
   stageNames:Object.freeze([...STAGES]),
   specs:Object.freeze(specs),
   executionAvailable:false,executionAuthorized:false,
   nativeVerified:false,allowCatalogPass:false,
   decision:'BLOCKED',hostedMigration:NATIVE_TRIAL_NO_GO
 });
}

// Only prepared/fake observation metadata can be validated. Never delete anything here.
export function inspectSyntheticContainerSet({blueprint,observations,plan,source}){
 assertPlanIsBlocked(plan,source);
 if(!exact(blueprint,['version','scope','evidenceProvenance','stageNames','specs',
   'executionAvailable','executionAuthorized','nativeVerified','allowCatalogPass','decision','hostedMigration'])||
   blueprint.version!==NATIVE_TRIAL_SPEC_VERSION||
   blueprint.scope!=='FUTURE_LOCAL_SYNTHETIC_ONLY'||
   blueprint.evidenceProvenance!=='UNVERIFIED_DESIGN_FIXTURE'||
   blueprint.executionAvailable!==false||blueprint.executionAuthorized!==false||
   blueprint.nativeVerified!==false||blueprint.allowCatalogPass!==false||
   blueprint.decision!=='BLOCKED'||blueprint.hostedMigration!==NATIVE_TRIAL_NO_GO||
   !exactSequence(blueprint.stageNames,STAGES)||
   !Array.isArray(blueprint.specs)||blueprint.specs.length!==4||
   blueprint.specs.some((s,i)=>!exact(s,['role','name','imageId','network','publishPorts',
     'privileged','binds','mounts','sharedVolumes','existingContainerReuse','expectedOwnerLabel','ddlSha256'])||
     s.role!==ROLES[i]||!/^[a-z0-9-]+$/.test(s.name)||
     s.name!=='raxi-t0t1-'+s.expectedOwnerLabel.slice('raxi.issue49.trial.'.length)+'-'+ROLES[i].toLowerCase().replaceAll('_','-')||
     s.ddlSha256!==plan.variants[i<2?0:1].ddlSha256||
     !IMAGE.test(s.imageId)||
     s.network!=='none'||s.publishPorts!==false||s.privileged!==false||
     !Array.isArray(s.binds)||s.binds.length!==0||
     !Array.isArray(s.mounts)||s.mounts.length!==0||
     s.sharedVolumes!==false||s.existingContainerReuse!==false||
     !/^raxi\.issue49\.trial\.[a-f0-9]{24}$/.test(s.expectedOwnerLabel)||
     !SHA.test(s.ddlSha256)))error('blueprint invalid');
 const session=blueprint.specs[0].expectedOwnerLabel;
 if(!blueprint.specs.every(s=>s.expectedOwnerLabel===session)||
    new Set(blueprint.specs.map(s=>s.name)).size!==4||
    new Set(blueprint.specs.map(s=>s.imageId)).size!==1||
    blueprint.specs[0].ddlSha256!==blueprint.specs[1].ddlSha256||
    blueprint.specs[2].ddlSha256!==blueprint.specs[3].ddlSha256||
    blueprint.specs[0].ddlSha256===blueprint.specs[2].ddlSha256)error('role consistency invalid');
 if(!Array.isArray(observations)||observations.length!==4)error('incomplete observed set');
 const ids=new Set();
 const volumeIds=new Set();
 for(let i=0;i<4;i++){
   const s=blueprint.specs[i],o=observations[i];
   if(!exact(o,['id','name','role','imageId','network','publishPorts','privileged',
       'binds','mounts','ownerLabel','anonymousVolumes','existing'])||
      !SHA.test(o.id)||ids.has(o.id)||o.name!==s.name||o.role!==s.role||
      o.imageId!==s.imageId||o.network!=='none'||o.publishPorts!==false||
      o.privileged!==false||o.ownerLabel!==s.expectedOwnerLabel||
      o.existing!==false||!Array.isArray(o.binds)||o.binds.length!==0||
      !Array.isArray(o.mounts)||o.mounts.length!==0||
      !denseArray(o.anonymousVolumes,1)||
      !Array.from({length:o.anonymousVolumes.length},(_,j)=>j).every(j=>
        typeof o.anonymousVolumes[j]==='string'&&SHA.test(o.anonymousVolumes[j])))error('isolation or ownership mismatch');
   ids.add(o.id);
   for(const volume of o.anonymousVolumes){
     if(volumeIds.has(volume))error('shared anonymous volume between roles');
     volumeIds.add(volume);
   }
 }
 return Object.freeze({
   observedSyntheticCount:4,
   source:'CALLER_SUPPLIED_NOT_DOCKER_ATTESTED',
   decision:'BLOCKED',allowCatalogPass:false,
   cleanupStatus:'NOT_EXECUTED',
   hostedMigration:NATIVE_TRIAL_NO_GO
 });
}

export function classifySyntheticCatalogComparisons({t0,t1,cleanup}){
 const valid=x=>exact(x,['sourceConbinSha256','restoredConbinSha256',
   'sourceCatalogSha256','restoredCatalogSha256','sourceBuildSha256','restoredBuildSha256'])&&
   Object.values(x).every(y=>typeof y==='string'&&SHA.test(y));
 if(!valid(t0)||!valid(t1)||cleanup!=='COMPLETE')error('incomplete synthetic catalog or cleanup');
 if(t0.sourceBuildSha256!==t0.restoredBuildSha256||
    t1.sourceBuildSha256!==t1.restoredBuildSha256||
    t0.sourceBuildSha256!==t1.sourceBuildSha256)error('build mismatch');
 const eq=x=>x.sourceConbinSha256===x.restoredConbinSha256&&
   x.sourceCatalogSha256===x.restoredCatalogSha256;
 const a=eq(t0),b=eq(t1);
 const finding=!a&&b?'T1_MICROSCHEMA_CANDIDATE_ONLY':
   !a&&!b?'T1_NOT_CONFIRMED':a&&b?'NOT_REPRODUCED':'INCONCLUSIVE';
 return Object.freeze({finding,evidence:'SYNTHETIC_INPUT_NOT_NATIVE',
   decision:'BLOCKED',allowCatalogPass:false,hostedMigration:NATIVE_TRIAL_NO_GO});
}
