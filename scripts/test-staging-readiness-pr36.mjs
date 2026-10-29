// Offline negative tests for the PR36 contract. Never connect to hosted services.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {strict as assert} from 'node:assert';
import {verifyReadinessInputs,REVIEWED_SOURCES,PRODUCTION_REF} from './pr36-readiness-contract.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const original=JSON.parse(read('supabase/staging/raxi-hq-staging.manifest.json'));
const catalog=read('supabase/tests/staging-b2-preflight.readonly.sql');
const expected=read(original.expectedSchemaPath);
const check=(m=original,reader=read,sql=catalog,schema=expected)=>
 verifyReadinessInputs(m,reader,sql,schema);
assert.equal(check().stage,'PREINSTALL_ONLY');
assert.equal(check(original,read,catalog,JSON.stringify(JSON.parse(expected),null,4)+'\n').stage,'PREINSTALL_ONLY');
assert.equal(check(original,read,catalog.replaceAll('\n','\r\n')).stage,'PREINSTALL_ONLY');
console.log('PASS: pinned manifest / canonical JSON + LF/CRLF catalog preserve NO-GO');
const mutate=fn=>{const copy=structuredClone(original);fn(copy);return copy;};
const rejects=[
 ['production ref',()=>check(mutate(m=>m.project.ref=PRODUCTION_REF))],
 ['foreign staging ref',()=>check(mutate(m=>m.project.ref='abcdefghijklmnopqrst'))],
 ['executionReady=true',()=>check(mutate(m=>m.executionReady=true))],
 ['B2 authorized',()=>check(mutate(m=>m.authorizations.runB2=true))],
 ['missing hosted denial',()=>check(mutate(m=>delete m.authorizations.applySql))],
 ['extra hosted flag',()=>check(mutate(m=>m.authorizations.unsafeOverride=false))],
 ['changed source order',()=>check(mutate(m=>m.applicationPlan.steps.reverse()))],
 ['campaign migration inclusion',()=>check(mutate(m=>m.applicationPlan.excluded=[]))],
 ['SQL source tamper',()=>check(original,path=>read(path)+(path===REVIEWED_SOURCES[0]?'\n-- altered':''))],
 ['semantic schema tamper',()=>check(original,read,catalog,expected.replace('"postgresMajor": 18','"postgresMajor": 17'))],
 ['manifest and SQL hash co-tamper',()=>check(mutate(m=>m.applicationPlan.steps[0].sha256Lf='0'.repeat(64)),
   path=>read(path)+(path===REVIEWED_SOURCES[0]?'\n-- covert source mutation':''))],
 ['manifest and schema hash co-tamper',()=>check(mutate(m=>m.expectedSchemaSha256='0'.repeat(64)),
   read,catalog,expected.replace('"postgresMajor": 18','"postgresMajor": 17'))],
 ['catalog quoted Auth row reference',()=>check(original,read,catalog.replace(
   'WITH checks AS (',
   'WITH checks AS (\n SELECT \'probe\' name, EXISTS(SELECT 1 FROM "auth"."users") ok UNION ALL'
 ))],
 ['catalog fake privilege checks',()=>check(original,read,catalog.replaceAll('has_column_privilege(','true /* has_column_privilege */('))],
 ['hosted GRANT injection',()=>check(original,read,catalog+'\nGRANT SELECT ON auth.users TO anon;')],
 ['second catalog statement',()=>check(original,read,catalog+'\nSELECT 1;')],
 ['Auth private row SELECT',()=>check(original,read,catalog.replace('FROM checks ORDER BY name','FROM auth.users ORDER BY name'))],
 ['removed exact column checks',()=>check(original,read,catalog.replaceAll('has_column_privilege','has_table_privilege'))]
];
for(const [label,fn] of rejects){
 assert.throws(fn,/PR36 STOP:/,label+' must be denied');
 console.log('PASS: rejected '+label);
}
console.log('PASS: PR36_READINESS_NEGATIVE_TESTS ('+rejects.length+' negative cases, no network, no Docker).');
