/** PG18/PGlite tests only. Native PG17 and hosted B2 remain BLOCKED. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {campaignDatabase} from './campaignDatabase';
// @ts-ignore Real .mjs exports, no declarations.
import {loadPreparationManifest,verifySqlSources,inspectRaxiSchema,digest,sqlDigest,verifyObservedSchema} from '../scripts/staging-manifest.mjs';
// @ts-ignore Real offline .mjs builder, no declarations.
import {assembleRuntimeCandidate,buildRuntimeCandidate,checkRuntimeCandidate,verifyCandidateText} from '../scripts/consolidate-runtime-candidate.mjs';
const readCandidate=()=>readFileSync('../../supabase/candidates/supervised_runtime_b2.candidate.sql','utf8');
async function localFixture() {
 const db=await campaignDatabase(false);
 await db.exec('alter table auth.users add column is_anonymous boolean not null default false;create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz)');
 return db;
}
test('Issue22 source hashes and deterministic consolidated candidate preserve preparation-only provenance',async()=>{
 const m=await loadPreparationManifest(),sql=await buildRuntimeCandidate(m);
 assert.equal(m.candidate.baseCommit,'271f33d294b5dcdf7b36f6abae31baeb962d3820');
 assert.equal(m.candidate.generatedBy,'OFFLINE_ASSEMBLER_NOT_CLI');assert.equal(m.candidate.cliMigrationVersion,null);
 assert.equal(m.executionReady,false);assert.ok(Object.values(m.authorizations).every(v=>v===false));
 assert.equal(m.schemaCompatibility.status,'PENDING_PG17_REVIEW');assert.equal(m.candidate.executionAuthorized,false);
 assert.equal(readCandidate().replaceAll('\r\n','\n'),sql);assert.equal(sqlDigest(sql),m.candidate.sha256Lf);
 assert.ok(sql.endsWith('\n')&&!sql.endsWith('\n\n'),'Single final newline in generated artifact');
 assert.equal((await checkRuntimeCandidate(m)).pg17Validation,'BLOCKED');
 assert.equal((await verifySqlSources(m)).length,7);assert.equal(m.applicationPlan.excluded.length,1);
 assert.ok(!m.candidate.path.startsWith('supabase/migrations/'));
 const report=JSON.parse(execFileSync(process.execPath,['scripts/consolidate-runtime-candidate.mjs','--check'],{encoding:'utf8'}));
 assert.equal(report.cliMigrationVersion,null);assert.equal(report.sqlExecuted,false);
});
for(const alteration of ['append','permission','source-order','extra-source','assigned-version','manifest']){
 test(`Issue22 candidate integrity rejects ${alteration}`,async()=>{
  const m=await loadPreparationManifest(),sql=await buildRuntimeCandidate(m),sources=(await verifySqlSources(m)).filter((s:{kind:string})=>s.kind==='RUNTIME_PROPOSAL');
  if(alteration==='append')assert.throws(()=>verifyCandidateText(m,sql+'\nselect 1;'));
  if(alteration==='permission')assert.throws(()=>verifyCandidateText(m,sql.replace('revoke all','grant all')));
  if(alteration==='source-order')assert.throws(()=>assembleRuntimeCandidate([...sources].reverse(),m.candidate.baseCommit));
  if(alteration==='extra-source')assert.throws(()=>assembleRuntimeCandidate([...sources,sources[0]],m.candidate.baseCommit));
  if(alteration==='assigned-version')assert.throws(()=>assembleRuntimeCandidate(sources.map((s:object,i:number)=>({...s,...(i===0?{version:'unauthorized'}:{})})),m.candidate.baseCommit));
  if(alteration==='manifest'){m.candidate.sha256Lf='0'.repeat(64);assert.throws(()=>verifyCandidateText(m,sql));}
 });
}
test('Issue22 complete candidate compiles transactionally in PG18 only; permissions stay closed',async()=>{
 const m=await loadPreparationManifest(),db=await localFixture();try{
  await db.exec('begin;'+await buildRuntimeCandidate(m)+'\ncommit;');
  const observed=await inspectRaxiSchema(db);assert.equal(observed.postgresMajor,18);assert.equal(digest(observed),m.expectedSchemaSha256);
  assert.throws(()=>verifyObservedSchema(m,'READY',{postgresMajor:18,schema:observed,migrations:[]}));
  await db.exec('set role authenticated');await assert.rejects(db.query('select public.raxi_supervised_host_identity($1)',['{}']),/permission denied/);
  await db.exec('reset role');
  const before=digest(await inspectRaxiSchema(db));
  await assert.rejects(db.exec('begin;'+await buildRuntimeCandidate(m)+'\ncommit;'));
  await db.exec('rollback');assert.equal(digest(await inspectRaxiSchema(db)),before);
 }finally{await db.close();}
});
test('Issue22 injected late DDL failure rolls back the whole candidate and keeps four base migrations intact (PG18)',async()=>{
 const m=await loadPreparationManifest(),db=await localFixture();try{
  const before=await inspectRaxiSchema(db);
  await assert.rejects(db.exec('begin;'+await buildRuntimeCandidate(m)+'\nselect 1/0; commit;'),/division by zero/);
  await db.exec('rollback');assert.deepEqual(await inspectRaxiSchema(db),before);
  assert.equal((await db.query<{v:string|null}>("select to_regclass('public.raxi_agent_runs') v")).rows[0].v,null);
 }finally{await db.close();}
});
test('Issue22 offline tools do not connect or allow apply/run flags',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No network');};
 try{
  await checkRuntimeCandidate(await loadPreparationManifest());assert.equal(calls,0);
  for(const flag of ['--apply','--run','--db-url'])assert.throws(()=>execFileSync(process.execPath,['scripts/consolidate-runtime-candidate.mjs',flag],{stdio:'pipe'}));
 }finally{globalThis.fetch=old;}
});
