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
import {describePr39CatalogMismatch,assertPr39CatalogEquality} from './pr39-catalog-diagnostic.mjs';
import {reviewedSlugDefinitions,classifySlugRepresentation,constraintFingerprint,summarizeSlugContexts} from './pr39-constraint-analysis.mjs';

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
 schema:{postgresMajor:17,tables:[{name:'raxi_workspaces',rls:true,sha256:'0'.repeat(64)}],functions:[],roles:[],otherPublicRelations:[]},
 postgresMajor:17,
 tables:[{name:'raxi_workspaces',kind:'r',rls:true,force_rls:false,view_definition:null,indexes:[],triggers:null,column_grants:null,
  columns:[{name:'slug',type:'text',required:true,identity:'',generated:'',default:null}],
  policies:[{name:'owner',qual:'owner_user_id=auth.uid()',roles:['authenticated'],cmd:'SELECT',permissive:'PERMISSIVE',check:null}],
  constraints:[{name:'raxi_workspaces_slug_check',definition:'CHECK (length(slug) > 2)' },
   {name:'raxi_workspaces_name_check',definition:'CHECK (length(name) > 2)'}],
  grants:[{role:'authenticated',privilege:'SELECT',grantable:false}]}],
 functions:[{name:'raxi_probe()',definition:'SELECT 1',definer:false,config:null,grants:[]}],
 roles:[{name:'authenticated',superuser:false,bypass_rls:false}],
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
 /raxi_workspaces_slug_check: definition differs/);
driftCase('missing named constraint',
 c=>c.tables[0].constraints=[],
 /raxi_workspaces_slug_check: missing in restore/);
driftCase('unexpected named constraint',
 c=>c.tables[0].constraints.push({name:'raxi_workspaces_new_check',definition:'CHECK (true)'}),
 /raxi_workspaces_new_check: unexpected in restore/);
driftCase('constraint metadata order-only drift',
 c=>c.tables[0].constraints.reverse(),
 /constraint lists differ only by ordering or representation/);

const reviewed=reviewedSlugDefinitions(sources);
assert.equal(constraintFingerprint(reviewed.nested).slice(0,12),'484099262f84');
assert.equal(constraintFingerprint(reviewed.flat).slice(0,12),'1efa6e7fdbc4');
console.log('PASS: reviewed BETWEEN expansion candidates match both user-observed fingerprints');
const sourceShape=structuredClone(baselineCatalog),restoredShape=structuredClone(baselineCatalog);
sourceShape.tables[0].constraints[0].definition=reviewed.nested;
restoredShape.tables[0].constraints[0].definition=reviewed.flat;
assert.match(describePr39CatalogMismatch(sourceShape,restoredShape,reviewed).issues.join('\n'),/BETWEEN_EXPANSION_AND_REGROUPING_CANDIDATE/);
negative('recognized AND regrouping cannot become PASS even with same summary hash',()=>assertPr39CatalogEquality(sourceShape,restoredShape));
assertPr39CatalogEquality(sourceShape,structuredClone(sourceShape));
for(const [label,change] of [
 ['exclusive bound',s=>s.replace('>= 2','> 2')],['different minimum',s=>s.replace('>= 2','>= 1')],
 ['different maximum',s=>s.replace('<= 64','<= 65')],['OR instead of AND',s=>s.replace(' AND ',' OR ')],
 ['different function',s=>s.replace('length','octet_length')],['different operator',s=>s.replace(' ~ ',' ~* ')],
 ['different cast',s=>s.replace('::text','::varchar')],['changed regex',s=>s.replace('[a-z0-9-]','[A-Z0-9-]')],
 ['extra collation',s=>s+' COLLATE "C"'],['prefix/suffix injection',s=>s+' -- altered']]){
 const changed=structuredClone(restoredShape);changed.tables[0].constraints[0].definition=change(reviewed.flat);
 // No printing of SQL on assertion failure.
 assert.ok(changed.tables[0].constraints[0].definition!==reviewed.flat,'mutation must change fixture '+label);
 assert.equal(classifySlugRepresentation('tables/raxi_workspaces','raxi_workspaces_slug_check',reviewed.nested,changed.tables[0].constraints[0].definition,reviewed),'UNCLASSIFIED');
 negative(label+' rejected by strict comparator',()=>assertPr39CatalogEquality(sourceShape,changed));
}
for(const [label,mutation] of [
 ['null constraint',c=>c.tables[0].constraints[0]=null],['missing constraint name',c=>delete c.tables[0].constraints[0].name],
 ['empty definition',c=>c.tables[0].constraints[0].definition=''],['non-string definition',c=>c.tables[0].constraints[0].definition={}],
 ['duplicate constraint',c=>c.tables[0].constraints.push(c.tables[0].constraints[0])],['null constraints array',c=>c.tables[0].constraints=null],
 ['duplicate table',c=>c.tables.push(c.tables[0])],['null row',c=>c.functions[0]=null],['invalid RLS flag',c=>c.tables[0].rls='true'],
 ['malformed ACL array',c=>c.tables[0].grants={}],['missing section',c=>delete c.roles],['empty schema envelope',c=>c.schema={}],
 ['null ACL entry',c=>c.tables[0].grants=[null]],['empty ACL entry',c=>c.tables[0].grants=[{}]],
 ['empty RLS policy',c=>c.tables[0].policies=[{}]],['null RLS policy',c=>c.tables[0].policies=[null]],
 ['invalid index entry',c=>c.tables[0].indexes=[{}]],['invalid trigger entry',c=>c.tables[0].triggers=[null]],
 ['invalid column entry',c=>c.tables[0].columns=[{}]],['invalid column ACL entry',c=>c.tables[0].column_grants=[{}]],
 ['invalid role flag',c=>c.roles[0].bypass_rls='false'],['invalid function security',c=>c.functions[0].definer='false'],
 ['invalid function settings',c=>c.functions[0].config={}],
 ['missing function ACL',c=>delete c.functions[0].grants],['null function ACL entry',c=>c.functions[0].grants=[null]],
 ['empty function ACL entry',c=>c.functions[0].grants=[{}]],['missing table ACL',c=>delete c.tables[0].grants],
 ['missing indexes',c=>delete c.tables[0].indexes],['missing triggers',c=>delete c.tables[0].triggers],
 ['missing role superuser flag',c=>delete c.roles[0].superuser],['missing column definition',c=>delete c.tables[0].columns],
 ['non-PG17 envelope',c=>c.postgresMajor=18]]){
 const changed=mutated(baselineCatalog,mutation);
 negative('identical malformed catalogs '+label,()=>assertPr39CatalogEquality(changed,structuredClone(changed)));
}
for(const field of ['indexes','triggers','columns','column_grants']){
 const a=structuredClone(baselineCatalog);a.tables[0][field]=[];
 const b=structuredClone(a);b.tables[0][field]=field==='columns'?[{name:'synthetic-alteration',type:'text',required:false,identity:'',generated:'',default:null}]:field==='column_grants'?[{role:'authenticated',privilege:'UPDATE',column:'slug',grantable:false}]:['synthetic-alteration'];
 negative('strict '+field+' divergence',()=>assertPr39CatalogEquality(a,b));
}
negative('strict role divergence',()=>assertPr39CatalogEquality(baselineCatalog,mutated(baselineCatalog,c=>c.roles[0].bypass_rls=true)));
negative('strict canonical hash divergence',()=>assertPr39CatalogEquality(baselineCatalog,mutated(baselineCatalog,c=>c.schema.tables[0].sha256='altered')));
const context={settings:{searchPath:'"$user", public',strings:'on',encoding:'UTF8',lcCollate:'C',lcCtype:'C',version:'170011'},
 constraint:{kind:'c',validated:true,deferrable:false,deferred:false,local:true,noInherit:false,inherited:0,columns:[3]},
 column:{type:'text',notNull:true,typeMod:-1,collation:'pg_catalog.default'},operators:[{schema:'pg_catalog',name:'~',left:'text',right:'text',result:'boolean'}],
 functions:[{schema:'pg_catalog',name:'length',arguments:'text',result:'integer',volatility:'i'}],types:[{schema:'pg_catalog',name:'text'}],
 collations:[{schema:'pg_catalog',name:'default',provider:'d',deterministic:true,encoding:-1,collate:null,ctype:null,locale:null,rules:null,version:null}]};
assert.ok(summarizeSlugContexts(context,structuredClone(context)).every(x=>x.classification==='IDENTICAL_METADATA'));
for(const key of Object.keys(context)){
 const changed=structuredClone(context);changed[key]=Array.isArray(context[key])?[]:{};
 negative('malformed resolved context '+key,()=>summarizeSlugContexts(changed,changed));
}
for(const [label,change] of [
 ['resolved function volatility',c=>c.functions[0].volatility='v'],['resolved operator schema',c=>c.operators[0].schema='public'],
 ['resolved type',c=>c.types[0].name='varchar'],['resolved collation',c=>c.collations[0].deterministic=false],
 ['unvalidated constraint',c=>c.constraint.validated=false],['different session resolution',c=>c.settings.searchPath='public, pg_catalog']]){
 assert.ok(summarizeSlugContexts(context,mutated(context,change)).some(x=>x.classification==='DIFFERENT_METADATA'),label);
 console.log('PASS: diagnostic reports '+label+' without granting equality');
}


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
