// Issue49 / PR39 — OFFLINE T0/T1 preflight executor. No native execution path.
// No Docker invocation, SQL connection, subprocess, file writes, or network calls.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const T0T1_REVISION='ISSUE49_PG17_T0T1_OFFLINE_PLAN_V1';
export const T0T1_NO_GO='NO_GO_HOSTED_MIGRATION';
export const T0T1_SOURCE_PATH='supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql';
export const T0T1_SOURCE_SHA='e0f0a828b5d4f31960f2153ad910bb84a399a449754db8761057e91047cd7ba0';
export const T0T1_ORIGINAL="slug text not null check(length(slug) between 2 and 64 and slug ~ '^[a-z0-9-]+$')";
export const T0T1_EXPLICIT="slug text not null check(length(slug) >= 2 and length(slug) <= 64 and slug ~ '^[a-z0-9-]+$')";
const DANGER_ENV=['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH',
  'PGHOST','PGHOSTADDR','PGSERVICE','PGPASSWORD','PGDATABASE','DATABASE_URL','SUPABASE_DB_URL'];
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fail=message=>{throw Error('ISSUE49 T0T1 OFFLINE STOP: '+message);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const keys=(obj,list)=>plain(obj)&&Object.keys(obj).length===list.length&&list.every(k=>Object.hasOwn(obj,k));
export function assertOfflineOnly({argv,environment}){
 if(!Array.isArray(argv)||argv.length!==2||argv.some(x=>typeof x!=='string'))fail('CLI options and native execution forbidden');
 if(!plain(environment))fail('environment required');
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
 if(!Array.isArray(manifest.applicationPlan?.steps)||manifest.applicationPlan.steps.length!==7)fail('unexpected migration inventory');
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
if(process.argv[1]&&import.meta.url===new URL('file:'+process.argv[1].replaceAll('\\','/')).href){
 try{main()}catch(error){console.error(String(error));process.exitCode=1;}
}
// The entrypoint comparison intentionally does not attempt to infer the real
// PostgreSQL or Docker environment, which is outside this offline module.
