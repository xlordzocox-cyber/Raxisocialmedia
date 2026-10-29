// PR39: offline-only negative tests. NEVER execute the --run-local path here.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyPreparationManifest,loadPreparationManifest,verifySqlSources}
 from '../apps/raxi-hq/scripts/staging-manifest.mjs';
import {assertBootstrapIntegrity} from './pr35-bootstrap-guard.mjs';
import {verifyPr38RecoveryEvidence} from './pr38-recovery-contract.mjs';
import {describePr39CatalogMismatch} from './pr39-catalog-diagnostic.mjs';

if(process.argv.length!==2)throw Error('PR39 STOP: offline test takes no flags');
const root=fileURLToPath(new URL('..',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const manifest=JSON.parse(read('supabase/staging/raxi-hq-staging.manifest.json'));
const evidence=JSON.parse(read('docs/RAXI_HQ_PR38_RECOVERY_EVIDENCE.json'));
const bootstrap=read('supabase/tests/pg17-bootstrap.sql');
const baseline=verifyPreparationManifest(manifest);
assert.equal(baseline.executionReady,false);
assert.equal(verifyPr38RecoveryEvidence(evidence,manifest).status,'NO_GO_HOSTED_MIGRATION');
assertBootstrapIntegrity(bootstrap);
const pinned=await loadPreparationManifest();
const sources=await verifySqlSources(pinned);
assert.equal(sources.length,7);
console.log('PASS: PR39_PINNED_OFFLINE_BASELINE (7 source hashes, bootstrap pin and PR38 NO-GO)');

let failures=0;
const mutated=(value,fn)=>{const copy=structuredClone(value);fn(copy);return copy;};
function negative(label,fn){
 assert.throws(fn,undefined,label);
 failures++;
 console.log('PASS: rejected '+label);
}
negative('production manifest project',()=>verifyPreparationManifest(
 mutated(manifest,m=>m.project.ref='jrkefsylpfriiqefcmzq')));
negative('hosted SQL permission',()=>verifyPreparationManifest(
 mutated(manifest,m=>m.authorizations.applySql=true)));
negative('hosted B2 permission',()=>verifyPreparationManifest(
 mutated(manifest,m=>m.authorizations.runB2=true)));
negative('unreviewed migration source',()=>verifyPreparationManifest(
 mutated(manifest,m=>m.applicationPlan.steps[0].path='supabase/migrations/unreviewed.sql')));
negative('staging manifest forged whole-hash',()=>verifyPreparationManifest(
 mutated(manifest,m=>m.expectedSchemaSha256='0'.repeat(64))));
negative('fake backup complete',()=>verifyPr38RecoveryEvidence(
 mutated(evidence,e=>e.provenScope='BACKUP_COMPLETE'),manifest));
negative('fake managed Auth recovery',()=>verifyPr38RecoveryEvidence(
 mutated(evidence,e=>e.gaps.authServiceRecovery='VERIFIED'),manifest));
negative('fake Storage object bytes',()=>verifyPr38RecoveryEvidence(
 mutated(evidence,e=>e.gaps.storageObjectBytes='VERIFIED'),manifest));
negative('fabricated RPO',()=>verifyPr38RecoveryEvidence(
 mutated(evidence,e=>e.objectives.rpoMinutes=15),manifest));
negative('fake project restore permission',()=>verifyPr38RecoveryEvidence(
 mutated(evidence,e=>e.authorizedOperations.restore=true),manifest));
negative('altered synthetic bootstrap',()=>assertBootstrapIntegrity(bootstrap+'\n-- tampered'));

async function negativeAsync(label,fn){
 await assert.rejects(fn,undefined,label);
 failures++;
 console.log('PASS: rejected '+label);
}
await negativeAsync('changed SQL with unchanged reviewed hash',()=>
 verifySqlSources(pinned,async path=>read(path)+(path===pinned.applicationPlan.steps[0].path?'\n-- unreviewed content':'')));

const baselineCatalog={
 schema:{tables:[{name:'raxi_workspaces',sha256:'baseline'}]},
 postgresMajor:17,
 tables:[{name:'raxi_workspaces',rls:true,policies:[{name:'owner',qual:'owner_user_id=auth.uid()'}],
  constraints:[{name:'raxi_workspaces_slug_check',definition:'CHECK (length(slug) > 2)' }],
  grants:[{role:'authenticated',privilege:'SELECT'}]}],
 functions:[{name:'raxi_probe()',definition:'SELECT 1'}],
 roles:[{name:'authenticated',bypass_rls:false}],
 otherPublicRelations:[]
};
assert.equal(describePr39CatalogMismatch(baselineCatalog,structuredClone(baselineCatalog)).count,0);
console.log('PASS: identical synthetic catalog has zero differences');
const driftCase=(label,mutation,pattern)=>{
 const changed=structuredClone(baselineCatalog);
 mutation(changed);
 const diff=describePr39CatalogMismatch(baselineCatalog,changed);
 assert.ok(diff.count>0,label+' must produce diagnostic');
 assert.match(diff.issues.join('\n'),pattern);
 failures++;
 console.log('PASS: synthetic catalog drift found '+label);
};
driftCase('RLS policy changes',c=>c.tables[0].policies[0].qual='true',/RLS policy definitions/);
driftCase('ACL grant changes',c=>c.tables[0].grants[0].privilege='INSERT',/ACL grant list/);
driftCase('function definition changes',c=>c.functions[0].definition='SELECT 0',/function definition/);
driftCase('missing restored Raxi table',c=>c.tables=[],/missing restored/);
driftCase('changed named constraint definition',
 c=>c.tables[0].constraints[0].definition='CHECK (false)',
 /constraint\\/raxi_workspaces_slug_check: definition differs/);
driftCase('missing named constraint',
 c=>c.tables[0].constraints=[],
 /constraint\\/raxi_workspaces_slug_check: missing in restore/);
driftCase('unexpected named constraint',
 c=>c.tables[0].constraints.push({name:'raxi_workspaces_new_check',definition:'CHECK (true)'}),
 /constraint\\/raxi_workspaces_new_check: unexpected in restore/);
driftCase('constraint metadata order-only drift',
 c=>c.tables[0].constraints=[{name:'raxi_workspaces_other_check',definition:'CHECK (true)'},...c.tables[0].constraints],
 /constraint\\/raxi_workspaces_other_check: unexpected in restore/);


for(const args of [['--hosted'],['--run'],['--run-local','--hosted']]){
 const result=spawnSync(process.execPath,
  [resolve(root,'scripts/pr39-local-synthetic-recovery.mjs'),...args],
  {encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024});
 assert.equal(result.status,1,'invalid flags rejected '+args);
 assert.match(result.stderr,/PR39 STOP: only --run-local is accepted/);
 failures++;
 console.log('PASS: rejected executable args '+args.join(' '));
}
const preflight=spawnSync(process.execPath,
 [resolve(root,'scripts/pr39-local-synthetic-recovery.mjs')],
 {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024,
  env:{...process.env,PATH:''}});
assert.equal(preflight.status,0,preflight.stderr);
assert.match(preflight.stdout,/PASS: PR39_PINNED_OFFLINE_PREFLIGHT/);
assert.match(preflight.stdout,/PRECHECK ONLY: no Docker, network, SQL, backup or restore performed\./);
console.log('PASS: default preflight succeeds without a PATH to Docker');
console.log('PASS: PR39_OFFLINE_NEGATIVE_TESTS ('+failures+' denied cases; no Docker/network/SQL).');
