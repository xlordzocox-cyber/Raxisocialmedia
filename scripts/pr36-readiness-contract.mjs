// PR36 static, offline-only preflight. Never performs network, SQL, Docker or writes.
import {createHash} from 'node:crypto';

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
const digest=(text)=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');

export function verifyReadinessInputs(manifest,readText,catalogSql,expectedSchemaText){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))reject('manifest missing');
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
  if(typeof source!=='string'||digest(source)!==step.sha256Lf)
    reject('SQL SHA256(LF) differs: '+path);
 }
 if(manifest.expectedSchemaPath!=='supabase/staging/raxi-hq-staging.expected-schema.json'||
    !/^[a-f0-9]{64}$/.test(manifest.expectedSchemaSha256)||
    digest(expectedSchemaText)!==manifest.expectedSchemaSha256)
  reject('expected schema reference changed');
 const expected=JSON.parse(expectedSchemaText);
 if(expected.postgresMajor!==18)
  reject('historical PG18 expected schema baseline changed; review before declaring parity');
 // This SQL is a pre-existing catalog-query artifact, not an execution mechanism.
 if(typeof catalogSql!=='string')reject('catalog SQL missing');
 const stripped=catalogSql.replace(/--[^\n]*/g,'').trim();
 if(!/^WITH\s+checks\s+AS\s*\(/i.test(stripped)||
     !/FROM\s+checks\s+ORDER\s+BY\s+name\s*;?\s*$/i.test(stripped)||
     (stripped.match(/;/g)||[]).length!==1||
     /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|DO|CALL|EXECUTE|MERGE|VACUUM|ANALYZE|pg_read_file|pg_ls_dir)\b/i.test(stripped)||
     /\b(?:FROM|JOIN)\s+(?:auth|storage|public)\s*\./i.test(stripped))
  reject('catalog query has unreviewed shape or prohibited row access');
 if(!catalogSql.includes('has_column_privilege')||
     !catalogSql.includes('service_role_select_auth_sessions_required_columns')||
     !catalogSql.includes('service_role_select_auth_users_required_columns'))
  reject('required exact Auth catalog privilege checks missing');
 return Object.freeze({
  stage:'PREINSTALL_ONLY',projectRef:STAGING_REF,sqlSources:7,
  hostedFlagsDisabled:6,expectedSchema:'HISTORICAL_PG18_NOT_HOSTED_PARITY',
  effectiveAuthPrivileges:'UNVERIFIED_BY_OFFLINE_CHECK',
  hostedRls:'UNTESTED_PREINSTALL',workspaceIsolation:'UNTESTED_HOSTED',
  recovery:'PUBLIC_ONLY_VERIFIED_NOT_FULL_BACKUP',
  b2:'BLOCKED',deployment:'BLOCKED'
 });
}
