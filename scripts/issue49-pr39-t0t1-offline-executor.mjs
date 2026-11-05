// Issue49 / PR39 — OFFLINE T0/T1 preflight executor. No native execution path.
// No Docker invocation, SQL connection, subprocess, file writes, or network calls.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const T0T1_REVISION='ISSUE49_PG17_T0T1_OFFLINE_PLAN_V1';
export const T0T1_NO_GO='NO_GO_HOSTED_MIGRATION';
export const T0T1_SOURCE_PATH='supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql';
export const T0T1_SOURCE_SHA='e0f0a828b5d4f31960f2153ad910bb84a399a449754db8761057e91047cd7ba0';
export const T0T1_ORIGINAL="slug text not null check(length(slug) between 2 and 64 and slug ~ '^[a-z0-9-]+$')";
export const T0T1_EXPLICIT="slug text not null check(length(slug) >= 2 and length(slug) <= 64 and slug ~ '^[a-z0-9-]+$')";
const EXPECTED_SOURCE_STEPS=Object.freeze([
 ['20261019030541','supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql','e0f0a828b5d4f31960f2153ad910bb84a399a449754db8761057e91047cd7ba0','BASE_MIGRATION'],
 ['20261019030659','supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql','2967d26201b0e335edec509e5cb40cc0808e3c422ff5eceeff1251b3ae43cf49','BASE_MIGRATION'],
 ['20261019030808','supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql','67472da139bbe3146f6e21ff8f1a5992a41a73fe80fd52800a9448ef15d3e375','BASE_MIGRATION'],
 ['20261019231655','supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql','89d9db4a1fa22eef45d34f279dbb10fd5feada5b495dab12eedfbbc4b66188ec','BASE_MIGRATION'],
 ['agent_runtime','supabase/proposals/agent_runtime.sql','36114c12797976ebfc0afdf94ca59c6a0c3dd11b184efdc5c83803b4eeefcb8c','RUNTIME_PROPOSAL'],
 ['supervised_host_stage_a','supabase/proposals/supervised_host_stage_a.sql','7f6de9365a6e85492b3e8e18b929f5caecfb3a01791d1326b34686e436c6ef3d','RUNTIME_PROPOSAL'],
 ['supervised_host_stage_b','supabase/proposals/supervised_host_stage_b.sql','59595546fdf1302342df0691fd5c3c7645d2a521861221ca11ae05b184bcb689','RUNTIME_PROPOSAL']
]);
const DANGER_ENV=['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH',
  'PGHOST','PGHOSTADDR','PGSERVICE','PGPASSWORD','PGDATABASE','DATABASE_URL','SUPABASE_DB_URL'];
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fail=message=>{throw Error('ISSUE49 T0T1 OFFLINE STOP: '+message);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const keys=(obj,list)=>plain(obj)&&Object.keys(obj).length===list.length&&list.every(k=>Object.hasOwn(obj,k));
export function assertOfflineOnly({argv,environment}){
 if(!Array.isArray(argv)||argv.length!==2||argv.some(x=>typeof x!=='string'))fail('CLI options and native execution forbidden');
 if(environment===null||typeof environment!=='object'||Array.isArray(environment))fail('environment required');
 for(const key of DANGER_ENV)if(Object.hasOwn(environment,key))fail('unexpected external endpoint or credential environment');
}
export function makeT0T1Plan({source,manifest,environment={},argv=['node','offline']}){
 assertOfflineOnly({environment,argv});
 if(typeof source!=='string'||source.length<100||source.length>1000000||source.includes('\r'))fail('source not LF canonical');
 if(!keys(manifest,['kind','formatVersion','baseCommit','project','baseline','executionReady','schemaCompatibility','authorizations','applicationPlan','expectedReadyMigrationVersions','expectedSchemaPath','expectedSchemaSha256','candidate']))fail('manifest shape changed');
 if(manifest.kind!=='RAXI_STAGING_PREPARATION'||manifest.executionReady!==false||
   manifest.schemaCompatibility?.status!=='PENDING_PG17_REVIEW'||manifest.schemaCompatibility?.targetPostgresMajor!==17||
   !plain(manifest.authorizations)||
   !keys(manifest.authorizations,['applySql','runB2','deploy','createUsers','realProviders','additionalSpend'])||
   Object.values(manifest.authorizations).some(v=>v!==false))fail('staging not disabled');
 if(!Array.isArray(manifest.applicationPlan?.steps)||manifest.applicationPlan.steps.length!==7||
   !plain(manifest.project)||manifest.project.postgresMajor!==17||
   !plain(manifest.candidate)||manifest.candidate.executionAuthorized!==false||
   manifest.candidate.pg17Status!=='BLOCKED_NOT_AVAILABLE'||
   manifest.candidate.cliStatus!=='BLOCKED_NOT_AVAILABLE')fail('unexpected staging inventory or candidate status');
 for(let i=0;i<EXPECTED_SOURCE_STEPS.length;i++){
   const item=manifest.applicationPlan.steps[i],expected=EXPECTED_SOURCE_STEPS[i];
   if(!plain(item)||item.id!==expected[0]||item.path!==expected[1]||
      item.sha256Lf!==expected[2]||item.kind!==expected[3]||item.order!==i+1)
      fail('pinned source inventory changed at '+i);
 }
 const matching=manifest.applicationPlan.steps.filter(x=>x.id==='20261019030541');
 if(matching.length!==1||matching[0].path!==T0T1_SOURCE_PATH||
   matching[0].sha256Lf!==T0T1_SOURCE_SHA||matching[0].kind!=='BASE_MIGRATION'||matching[0].order!==1)fail('source manifest pin mismatch');
 if(hash(source)!==T0T1_SOURCE_SHA)fail('pinned SQL hash mismatch');
 if(source.split(T0T1_ORIGINAL).length!==2||source.includes(T0T1_EXPLICIT))fail('expected CHECK missing or duplicated');
 const t1=source.replace(T0T1_ORIGINAL,()=>T0T1_EXPLICIT);
 if(t1===source||t1.replace(T0T1_EXPLICIT,()=>T0T1_ORIGINAL)!==source)fail('T0/T1 transformation not reversible');
 const anchor="slug ~ '^[a-z0-9-]+$'";
 if(t1.split(anchor).length!==2||source.split(anchor).length!==2)fail('regex anchor changed');
 const mk=(predicate)=>'CREATE TABLE public.raxi_workspaces (\n'+
   '  slug text NOT NULL CHECK ('+predicate+')\n);\n';
 const t0=mk("length(slug) BETWEEN 2 AND 64 AND slug ~ '^[a-z0-9-]+$'");
 const t1Micro=mk("length(slug) >= 2 AND length(slug) <= 64 AND slug ~ '^[a-z0-9-]+$'");
 // The micro-schema SQL is NEVER returned or executed by this executable;
 // fingerprints provide planning traceability without authorizing SQL.
 if(t0===t1Micro||t0.includes(';')!==true||t1Micro.includes(';')!==true)fail('micro-schema plan invalid');
 return Object.freeze({
  revision:T0T1_REVISION,
  scope:'SYNTHETIC_MICROSCHEMA_PLAN_ONLY',
  variants:Object.freeze([
   Object.freeze({id:'T0',ddlSha256:hash(t0),sourcePredicateSha256:hash(T0T1_ORIGINAL)}),
   Object.freeze({id:'T1',ddlSha256:hash(t1Micro),sourcePredicateSha256:hash(T0T1_EXPLICIT)})
  ]),
  pinnedMigrationSha256:T0T1_SOURCE_SHA,
  inMemoryCandidateSha256:hash(t1),
  stages:Object.freeze(['PINNED_PREFLIGHT','LOCAL_DAEMON_ATTESTATION_REQUIRED',
   'PINNED_IMAGE_REQUIRED','FOUR_EPHEMERAL_CONTAINERS_SEPARATE_AUTHORIZATION',
   'SOURCE_DUMP_RESTORE_TARGET_PER_VARIANT','STRICT_CATALOG_COMPARISON',
   'EXACT_ID_CLEANUP','HUMAN_EVIDENCE_REVIEW']),
  nativeExecutionAvailable:false,
  dockerInvoked:false,sqlExecuted:false,writePerformed:false,
  allowCatalogPass:false,semanticEquivalence:'NOT_VERIFIED',
  decision:'BLOCKED',hostedMigration:T0T1_NO_GO
 });
}
export function assertPlanIsBlocked(plan){
 if(!plain(plan)||plan.revision!==T0T1_REVISION||
   plan.scope!=='SYNTHETIC_MICROSCHEMA_PLAN_ONLY'||
   plan.nativeExecutionAvailable!==false||plan.dockerInvoked!==false||
   plan.sqlExecuted!==false||plan.writePerformed!==false||
   plan.decision!=='BLOCKED'||plan.semanticEquivalence!=='NOT_VERIFIED'||
   plan.allowCatalogPass!==false||plan.hostedMigration!==T0T1_NO_GO||
   plan.pinnedMigrationSha256!==T0T1_SOURCE_SHA||
   typeof plan.inMemoryCandidateSha256!=='string'||!(/^[a-f0-9]{64}$/.test(plan.inMemoryCandidateSha256))||
   !Array.isArray(plan.variants)||plan.variants.length!==2||
   plan.variants[0]?.id!=='T0'||plan.variants[1]?.id!=='T1'||
   plan.variants.some(v=>!(/^[a-f0-9]{64}$/.test(v.ddlSha256)))||
   !Array.isArray(plan.stages)||plan.stages.length!==8)fail('unsafe or incomplete plan');
 return true;
}
function main(){
 assertOfflineOnly({argv:process.argv,environment:process.env});
 const root=process.cwd();
 const source=readFileSync(join(root,T0T1_SOURCE_PATH),'utf8').replace(/\r\n/g,'\n');
 const manifest=JSON.parse(readFileSync(join(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
 const plan=makeT0T1Plan({source,manifest,environment:process.env,argv:process.argv});
 assertPlanIsBlocked(plan);
 console.log('PASS ISSUE49 T0T1 OFFLINE PREFLIGHT: pinned migration, staged authorizations and exact reversible predicates');
 console.log('ISSUE49 T0 SHA256: '+plan.variants[0].ddlSha256);
 console.log('ISSUE49 T1 SHA256: '+plan.variants[1].ddlSha256);
 console.log('ISSUE49 NATIVE EXECUTION: UNAVAILABLE; 4 ephemeral containers require separate authorization and reviewed implementation');
 console.log('ISSUE49 DECISION: BLOCKED / NOT_VERIFIED; allowCatalogPass=false; '+T0T1_NO_GO);
}
if(process.argv[1]&&process.argv[1]!=='-'&&resolve(fileURLToPath(import.meta.url))===resolve(process.argv[1])){
 try{main()}catch(error){console.error(String(error));process.exitCode=1;}
}
// No native execution path exists in this offline module.
