// PR36 static, offline-only preflight. Never performs network, SQL, Docker or writes.
import {
 verifyPreparationManifest,verifySchemaCandidate,sqlDigest,
 REVIEWED_STAGING_MANIFEST_SHA256
} from '../apps/raxi-hq/scripts/staging-manifest.mjs';

export const STAGING_REF='zvhxjindgyvtasstfjut';
export const PRODUCTION_REF='jrkefsylpfriiqefcmzq';
export const GUARDED_FLAGS=['applySql','runB2','deploy','createUsers','realProviders','additionalSpend'];
export const REVIEWED_SOURCES=[
 'supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql',
 'supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql',
 'supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql',
 'supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql',
 'supabase/proposals/agent_runtime.sql',
 'supabase/proposals/supervised_host_stage_a.sql',
 'supabase/proposals/supervised_host_stage_b.sql'
];
export const EXCLUDED='supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql';
const reject=(reason)=>{throw Error('PR36 STOP: '+reason);};
// Exact previously reviewed catalog SQL, never an executable SQL permission grant.
export const REVIEWED_AUTH_CATALOG_SQL_SHA256_LF=
 '75a3977f52b17a9628d9b9cb19bdbf1814dd355066769f81ce2745cb7d73630b';

export function verifyReadinessInputs(manifest,readText,catalogSql,expectedSchemaText){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))reject('manifest missing');
 // Pin the ENTIRE reviewed manifest; seven per-source hashes alone are not sufficient.
 // This rejects any coordinated manifest+SQL or manifest+schema mutation.
 try{verifyPreparationManifest(manifest);}
 catch{reject('reviewed staging manifest SHA256 changed: '+REVIEWED_STAGING_MANIFEST_SHA256);}
 const project=manifest.project;
 if(!project||project.ref!==STAGING_REF||project.ref===PRODUCTION_REF||
   project.name!=='raxi-hq-staging'||project.region!=='us-east-2'||
   project.organizationId!=='qpjzdqkvjzgqwvismeku'||project.postgresMajor!==17)
  reject('staging identity changed');
 if(manifest.kind!=='RAXI_STAGING_PREPARATION'||manifest.executionReady!==false)
  reject('manifest type or execution gate changed');
 const auth=manifest.authorizations;
 if(!auth||typeof auth!=='object'||Array.isArray(auth)||
    Object.keys(auth).length!==GUARDED_FLAGS.length||
    GUARDED_FLAGS.some(key=>!Object.hasOwn(auth,key)||auth[key]!==false))
  reject('hosted authorizations must all be explicit false');
 const plan=manifest.applicationPlan;
 if(!plan||!Array.isArray(plan.steps)||plan.steps.length!==REVIEWED_SOURCES.length)
  reject('reviewed seven-source plan changed');
 if(!Array.isArray(plan.excluded)||plan.excluded.length!==1||
    plan.excluded[0]?.path!==EXCLUDED)
  reject('campaign migration exclusion changed');
 for(let i=0;i<REVIEWED_SOURCES.length;i++){
  const step=plan.steps[i],path=REVIEWED_SOURCES[i];
  if(step?.order!==i+1||step.path!==path||
     step.kind!==(i<4?'BASE_MIGRATION':'RUNTIME_PROPOSAL')||
     !/^[a-f0-9]{64}$/.test(step.sha256Lf))
    reject('SQL source identity/order changed: '+i);
  const source=readText(path);
  if(typeof source!=='string'||sqlDigest(source)!==step.sha256Lf)
    reject('SQL SHA256(LF) differs: '+path);
 }
 if(manifest.expectedSchemaPath!=='supabase/staging/raxi-hq-staging.expected-schema.json')
  reject('unexpected expected schema path');
 if(typeof expectedSchemaText!=='string')reject('expected schema missing');
 let expected;
 try{expected=JSON.parse(expectedSchemaText);}
 catch{reject('expected schema invalid JSON');}
 // Existing Raxi HQ contract hashes the CANONICALIZED JSON OBJECT, not LF text.
 try{verifySchemaCandidate(manifest,expected);}
 catch{reject('canonical expected schema checksum or historical major changed');}
 if(expected.postgresMajor!==18)
  reject('historical PG18 baseline changed; never claim hosted PG17 parity');
 // Never certify a query with regex/substrings; compare the exact reviewed source.
 if(typeof catalogSql!=='string'||sqlDigest(catalogSql)!==REVIEWED_AUTH_CATALOG_SQL_SHA256_LF)
  reject('pinned read-only Auth catalog SQL SHA256(LF) changed');
 return Object.freeze({
  stage:'PREINSTALL_ONLY',projectRef:STAGING_REF,sqlSources:7,
  hostedFlagsDisabled:6,expectedSchema:'HISTORICAL_PG18_NOT_HOSTED_PARITY',
  effectiveAuthPrivileges:'UNVERIFIED_BY_OFFLINE_CHECK',
  hostedRls:'UNTESTED_PREINSTALL',workspaceIsolation:'UNTESTED_HOSTED',
  recovery:'PUBLIC_ONLY_VERIFIED_NOT_FULL_BACKUP',
  b2:'BLOCKED',deployment:'BLOCKED'
 });
}
