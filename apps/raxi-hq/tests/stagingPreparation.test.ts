/** LOCAL metadata/SQL fixtures only. No project query or PostgreSQL 17 claim. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {campaignDatabase} from './campaignDatabase';
// @ts-ignore Existing .mjs modules have no declarations; test their real exports.
import {loadPreparationManifest,verifyPreparationManifest,verifySqlSources,verifySchemaCandidate,verifyObservedProject,verifyObservedSchema,verifyExecutionApproval,inspectRaxiSchema,digest,sqlDigest,STAGING_PROJECT,REVIEWED_STAGING_MANIFEST_SHA256} from '../scripts/staging-manifest.mjs';
// @ts-ignore Existing .mjs module has no declarations.
import {runtimeStagingGate,runStagingRuntime} from '../scripts/staging-runtime-acceptance.mjs';
const raw=()=>JSON.parse(readFileSync('../../supabase/staging/raxi-hq-staging.manifest.json','utf8'));
const schema=()=>JSON.parse(readFileSync('../../supabase/staging/raxi-hq-staging.expected-schema.json','utf8'));
const project={id:STAGING_PROJECT.ref,name:STAGING_PROJECT.name,organization_id:STAGING_PROJECT.organizationId,region:STAGING_PROJECT.region,status:'ACTIVE_HEALTHY'};
test('PR21 reviewed manifest and SQL hashes bind the exact staging project, base commit and 4+3 ordered sources',async()=>{
 const m=await loadPreparationManifest();assert.equal(digest(m),REVIEWED_STAGING_MANIFEST_SHA256);
 assert.equal(m.executionReady,false);assert.equal(m.baseCommit,'b56b26567bc97078fa58ef16385b851d890d6408');
 assert.deepEqual(m.project,STAGING_PROJECT);assert.equal(m.applicationPlan.steps.length,7);
 assert.deepEqual(m.applicationPlan.steps.map((s:{order:number})=>s.order),[1,2,3,4,5,6,7]);
 assert.equal(m.applicationPlan.steps.filter((s:{version:string|null})=>s.version===null).length,3);
 assert.equal(m.applicationPlan.consolidatedRuntimeVersion,null);assert.equal(m.schemaCompatibility.localFixturePostgresMajor,18);
 const text=execFileSync(process.execPath,['scripts/verify-staging-preparation.mjs'],{encoding:'utf8'});
 assert.equal(JSON.parse(text).remoteAccess,false);assert.equal(JSON.parse(text).sqlApplied,false);
});
for(const change of ['project','organization','region','base','source','order','version','unknown','authorization','schema']){
 test(`PR21 altered manifest rejected: ${change}`,()=>{
  const m=raw();
  if(change==='project')m.project.ref='jrkefsylpfriiqefcmzq';
  if(change==='organization')m.project.organizationId='other';
  if(change==='region')m.project.region='other';
  if(change==='base')m.baseCommit='0'.repeat(40);
  if(change==='source')m.applicationPlan.steps[0].sha256Lf='0'.repeat(64);
  if(change==='order')m.applicationPlan.steps.reverse();
  if(change==='version')m.applicationPlan.consolidatedRuntimeVersion='20261026000000';
  if(change==='unknown')m.extra='unexpected';
  if(change==='authorization')m.executionReady=true;
  if(change==='schema')m.expectedSchemaSha256='f'.repeat(64);
  assert.throws(()=>verifyPreparationManifest(m));
 });
}
test('PR21 SQL content changes fail; CRLF-only checkout and JSON key order preserve the reviewed meaning',async()=>{
 const m=raw();assert.equal(verifyPreparationManifest(JSON.parse(JSON.stringify(m,null,4))).executionReady,false);
 const read=(path:string)=>readFileSync('../../'+path,'utf8');
 await assert.rejects(verifySqlSources(m,async(path:string)=>read(path)+'\n-- unauthorized change'));
 const valid=await verifySqlSources(m,async(path:string)=>read(path).replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
 assert.equal(valid.length,7);assert.equal(sqlDigest('a\r\nb'),sqlDigest('a\nb'));
 const snapshot=raw();let first=true;
 await verifySqlSources(snapshot,async(path:string)=>{if(first){first=false;snapshot.applicationPlan.steps[1].sha256Lf='0'.repeat(64);}return read(path);});
});
for(const patch of [{id:'jrkefsylpfriiqefcmzq'},{id:'abcdefghijklmnopqrst'},{name:'raxi-hq'},{organization_id:'other'},{region:'other'},{status:'UNKNOWN'}]){
 test(`PR21 authenticated project mismatch rejected: ${JSON.stringify(patch)}`,()=>{
  verifyObservedProject(project);assert.throws(()=>verifyObservedProject({...project,...patch}));
 });
}
test('PR21 EMPTY metadata fixture is checked separately from the unverified PostgreSQL 18 schema candidate',()=>{
 const m=raw(),empty={postgresMajor:17,migrations:[],schema:{postgresMajor:17,tables:[],functions:[],otherPublicRelations:[]}};
 verifyObservedSchema(m,'EMPTY',empty); // Synthetic metadata, never a hosted observation.
 for(const changed of [{...empty,postgresMajor:18},{...empty,migrations:['20261019030541']},
  {...empty,schema:{...empty.schema,tables:[{name:'raxi_ideas'}]}},{...empty,schema:{...empty.schema,functions:[{name:'raxi_unknown'}]}},
  {...empty,schema:{...empty.schema,otherPublicRelations:[{name:'unexpected'}]}}])assert.throws(()=>verifyObservedSchema(m,'EMPTY',changed));
 assert.throws(()=>verifyObservedSchema(m,'READY',empty),/unassigned/);
 assert.throws(()=>verifyObservedSchema(m,'UNKNOWN',empty));
 verifySchemaCandidate(m,schema());const altered=schema();altered.tables[0].sha256='0'.repeat(64);assert.throws(()=>verifySchemaCandidate(m,altered));
});
test('PR21 consolidated proposal executes ONLY inside the local fixture and matches the reviewed candidate catalog',async()=>{
 const m=await loadPreparationManifest(),sources=await verifySqlSources(m),db=await campaignDatabase(false);
 try {
  await db.exec('alter table auth.users add column is_anonymous boolean not null default false;create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz)');
  await db.exec(sources.filter((s:{kind:string})=>s.kind==='RUNTIME_PROPOSAL').map((s:{text:string})=>s.text).join('\n'));
  const observed=await inspectRaxiSchema(db);assert.deepEqual(observed,schema());
  assert.equal(observed.tables.length,20);assert.equal(observed.functions.length,23);
  assert.ok(observed.tables.every((t:{rls:boolean})=>t.rls));assert.ok(observed.functions.every((f:{definer:boolean})=>!f.definer));
  await db.exec('alter table public.raxi_agent_events add column unexpected text');
  const altered=await inspectRaxiSchema(db);assert.throws(()=>verifySchemaCandidate(m,altered));
 }finally{await db.close();}
});
test('PR21 expired/altered approval and current preparation never authorize B2 or network',async()=>{
 const m=raw(),approval={kind:'SUPERVISED_B2_SIMULATION',projectRef:STAGING_PROJECT.ref,organizationId:STAGING_PROJECT.organizationId,baseCommit:m.baseCommit,
  stagingManifestSha256:REVIEWED_STAGING_MANIFEST_SHA256,providers:'SIMULATED_ONLY',productionClone:false,expiresAt:new Date(Date.now()+60000).toISOString()};
 assert.throws(()=>verifyExecutionApproval(m,approval),/preparation only/);
 for(const p of [{expiresAt:'invalid'},{expiresAt:'2000-01-01T00:00:00Z'},{stagingManifestSha256:'f'.repeat(64)},{providers:'REAL'},{projectRef:'jrkefsylpfriiqefcmzq'}])assert.throws(()=>verifyExecutionApproval(m,{...approval,...p}),/Approval/);
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Forbidden');};
 try {
  await assert.rejects(runStagingRuntime({},[]));
  const env={RAXI_STAGING_REF:STAGING_PROJECT.ref,RAXI_STAGING_URL:`https://${STAGING_PROJECT.ref}.supabase.co`,RAXI_STAGING_DATABASE_URL:`postgresql://postgres:fixture-only@db.${STAGING_PROJECT.ref}.supabase.co:5432/postgres`,RAXI_STAGING_ACK:'RUN_ISOLATED_STAGING_ACCEPTANCE',RAXI_STAGING_RUNTIME_ACK:'RUN_SUPERVISED_SIMULATION_B2',RAXI_STAGING_APPROVAL_FILE:'not-read',RAXI_STAGING_APPROVAL_SHA256:'a'.repeat(64)};
  runtimeStagingGate(env,['--run']);
  for(const patch of [{RAXI_STAGING_REF:'abcdefghijklmnopqrst'},{RAXI_STAGING_APPROVAL_FILE:''},{RAXI_STAGING_APPROVAL_SHA256:''},{RAXI_STAGING_DATABASE_URL:''}])assert.throws(()=>runtimeStagingGate({...env,...patch},['--run']));
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});
test('PR21 exact approval expiry boundary fails as expired, not merely preparation-only',()=>{
 const actual=Date.now;const instant=Date.parse('2026-10-26T12:00:00Z');Date.now=()=>instant;
 try {
  const m=raw(),approval={kind:'SUPERVISED_B2_SIMULATION',projectRef:STAGING_PROJECT.ref,organizationId:STAGING_PROJECT.organizationId,
   baseCommit:m.baseCommit,stagingManifestSha256:REVIEWED_STAGING_MANIFEST_SHA256,providers:'SIMULATED_ONLY',productionClone:false,expiresAt:new Date(instant+1).toISOString()};
  assert.throws(()=>verifyExecutionApproval(m,approval),/preparation only/);
  approval.expiresAt=new Date(instant).toISOString();assert.throws(()=>verifyExecutionApproval(m,approval),/Approval expired/);
 }finally{Date.now=actual;}
});
