// Issue49: offline-only PG17 adapter lifecycle. No Docker or SQL access.
import {assertPlanIsBlocked} from './issue49-pr39-t0t1-offline-executor.mjs';
import {makeNativeTrialBlueprint,inspectSyntheticContainerSet} from './issue49-pr39-native-trial-contract.mjs';

const fail=code=>{throw Error('ISSUE49 ADAPTER STOP: '+code);};
const sha=/^[a-f0-9]{64}$/;
const imagePin=/^sha256:[a-f0-9]{64}$/;
const roles=['T0_SOURCE','T0_RESTORED','T1_SOURCE','T1_RESTORED'];
const steps=['PRECHECK','ATTEST_LOCAL','ATTEST_IMAGE','DEFINE_RESOURCES',
 'CAPTURE_SOURCE','RESTORE_TARGET','COMPARE_STRICT','VERIFY_CLEANUP'];
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.getPrototypeOf(o)===Object.prototype&&
 Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const exactArray=(actual,expected)=>Array.isArray(actual)&&
 actual.length===expected.length&&
 Array.from({length:expected.length},(_,i)=>i).every(i=>
   Object.hasOwn(actual,i)&&typeof actual[i]==='string'&&actual[i]===expected[i]);

export function prepareOfflineNativeAdapter({plan,source,prerequisites,sessionId,expectedImageId}){
 assertPlanIsBlocked(plan,source);
 // The expected image ID must originate from an independent immutable pin,
 // not from the mutable Docker inspection object being checked.
 if(typeof expectedImageId!=='string'||!imagePin.test(expectedImageId)||
   prerequisites?.imageId!==expectedImageId)
   fail('image differs from independent pinned reference');
 const blueprint=makeNativeTrialBlueprint({plan,source,prerequisites,sessionId});
 if(blueprint.executionAvailable!==false||blueprint.executionAuthorized!==false||
   blueprint.specs.length!==4||blueprint.specs.some((s,i)=>
    s.role!==roles[i]||s.network!=='none'||s.privileged!==false||
    s.publishPorts!==false||s.binds.length!==0||s.mounts.length!==0||
    !sha.test(s.ddlSha256)))fail('unsafe blueprint');
 return Object.freeze({
  version:'ISSUE49_ADAPTER_OFFLINE_V1',
  origin:'SYNTHETIC_BLUEPRINT_NOT_ATTESTED',
  roles:Object.freeze([...roles]),
  stages:Object.freeze([...steps]),
  resourceNames:Object.freeze(blueprint.specs.map(s=>s.name)),
  sourcePlanHash:plan.inMemoryCandidateSha256,
  expectedImageId,
  runtimeAvailable:false,executionAuthorized:false,
  cleanupAuthorized:false,allowCatalogPass:false,
  decision:'BLOCKED',hostedMigration:'NO_GO_HOSTED_MIGRATION'
 });
}

export function validateOfflineNativeAdapter({adapter,plan,source,prerequisites,sessionId,expectedImageId}){
 const expected=prepareOfflineNativeAdapter({plan,source,prerequisites,sessionId,expectedImageId});
 const fields=Object.keys(expected);
 if(!exact(adapter,fields)||
    fields.some(key=>Array.isArray(expected[key])
      ?!exactArray(adapter[key],expected[key])
      :adapter[key]!==expected[key]))fail('modified adapter');
 return Object.freeze({
  validatedOffline:true,actualInfrastructureVerified:false,
  decision:'BLOCKED',allowCatalogPass:false,
  hostedMigration:'NO_GO_HOSTED_MIGRATION'
 });
}

export function describeOfflineCleanupBarrier({blueprint,observations,plan,source}){
 const inspected=inspectSyntheticContainerSet({blueprint,observations,plan,source});
 if(inspected.decision!=='BLOCKED'||inspected.cleanupStatus!=='NOT_EXECUTED')
   fail('invalid cleanup evidence');
 return Object.freeze({
  inputType:'SYNTHETIC_OBSERVATION_ONLY',
  observedRoles:inspected.observedSyntheticCount,
  actualResourceIdentityVerified:false,
  cleanupExecuted:false,cleanupAuthorized:false,
  deletionTargets:Object.freeze([]),
  decision:'BLOCKED',hostedMigration:'NO_GO_HOSTED_MIGRATION'
 });
}
