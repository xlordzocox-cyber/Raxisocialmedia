// Offline-only negative tests for Issue49 T0/T1 preflight.
// Executes Node child processes only; no Docker, SQL, network, or writes.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  assertOfflineOnly,makeT0T1Plan,assertPlanIsBlocked,T0T1_SOURCE_PATH,
  T0T1_ORIGINAL,T0T1_EXPLICIT,T0T1_NO_GO
} from './issue49-pr39-t0t1-offline-executor.mjs';

assert.equal(process.argv.length,2,'No test CLI flags accepted');
const root=process.cwd();
const source=readFileSync(join(root,T0T1_SOURCE_PATH),'utf8').replace(/\r\n/g,'\n');
const manifest=JSON.parse(readFileSync(join(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
const clone=x=>structuredClone(x);
const input=()=>({source,manifest:clone(manifest),environment:{},argv:['node','offline']});
const digest=x=>createHash('sha256').update(x).digest('hex');
let denied=0;
function negative(label,mutate){
 const v=input();mutate(v);
 assert.throws(()=>makeT0T1Plan(v),/ISSUE49 T0T1 OFFLINE STOP/,label);
 denied++;
}
const plan=makeT0T1Plan(input());
assertPlanIsBlocked(plan,source);
assert.equal(plan.hostedMigration,T0T1_NO_GO);
assert.equal(plan.nativeExecutionAvailable,false);
assert.equal(plan.dockerInvoked,false);
assert.equal(plan.sqlExecuted,false);
assert.equal(plan.writePerformed,false);
assert.throws(()=>assertPlanIsBlocked(plan,undefined),/ISSUE49 T0T1 OFFLINE STOP/);
assert.throws(()=>assertPlanIsBlocked(plan,source+' -- forged'),/ISSUE49 T0T1 OFFLINE STOP/);
assert.deepEqual(plan.variants.map(x=>x.id),['T0','T1']);
const micro0="CREATE TABLE public.raxi_workspaces (\n  slug text NOT NULL CHECK (length(slug) BETWEEN 2 AND 64 AND slug ~ '^[a-z0-9-]+$')\n);\n";
const micro1="CREATE TABLE public.raxi_workspaces (\n  slug text NOT NULL CHECK (length(slug) >= 2 AND length(slug) <= 64 AND slug ~ '^[a-z0-9-]+$')\n);\n";
assert.equal(plan.variants[0].ddlSha256,digest(micro0));
assert.equal(plan.variants[1].ddlSha256,digest(micro1));
assert.notEqual(plan.variants[0].ddlSha256,plan.variants[1].ddlSha256);
assert.equal(source.split(T0T1_ORIGINAL).length,2);
assert.equal(source.replace(T0T1_ORIGINAL,()=>T0T1_EXPLICIT).replace(T0T1_EXPLICIT,()=>T0T1_ORIGINAL),source);
console.log('PASS: T0T1 exact micro-schema fingerprints and literal regex anchor; plan remains BLOCKED');

for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS','DOCKER_TLS_VERIFY',
 'DOCKER_CERT_PATH','PGHOST','PGHOSTADDR','PGSERVICE','PGPASSWORD','PGDATABASE','DATABASE_URL','SUPABASE_DB_URL']){
 negative('external endpoint '+key,v=>{v.environment[key]='not-allowed';});
}
negative('native flag',v=>{v.argv.push('--run-local');});
negative('unknown flag',v=>{v.argv.push('--help');});
negative('missing argv',v=>{v.argv=[];});
negative('missing environment',v=>{v.environment=null;});
negative('manifest execution ready',v=>{v.manifest.executionReady=true;});
negative('format version null',v=>{v.manifest.formatVersion=null;});
negative('format version unknown',v=>{v.manifest.formatVersion=999;});
negative('format version string',v=>{v.manifest.formatVersion='1';});
negative('migration apply authorized',v=>{v.manifest.authorizations.applySql=true;});
negative('host run authorized',v=>{v.manifest.authorizations.runB2=true;});
negative('extra staging authorization',v=>{v.manifest.authorizations.restore=true;});
negative('missing staging authorization',v=>{delete v.manifest.authorizations.deploy;});
negative('PG status suddenly READY',v=>{v.manifest.schemaCompatibility.status='READY';});
negative('wrong PG target',v=>{v.manifest.schemaCompatibility.targetPostgresMajor=18;});
negative('wrong source path',v=>{v.manifest.applicationPlan.steps[0].path='supabase/migrations/different.sql';});
negative('wrong source SHA',v=>{v.manifest.applicationPlan.steps[0].sha256Lf='0'.repeat(64);});
negative('other pinned source corrupted',v=>{v.manifest.applicationPlan.steps[4].sha256Lf='f'.repeat(64);});
negative('staging source order altered',v=>{v.manifest.applicationPlan.steps.reverse();});
negative('candidate executable',v=>{v.manifest.candidate.executionAuthorized=true;});
negative('candidate unexpectedly available',v=>{v.manifest.candidate.pg17Status='READY';});
negative('project PG18',v=>{v.manifest.project.postgresMajor=18;});
negative('wrong migration kind',v=>{v.manifest.applicationPlan.steps[0].kind='RUNTIME_PROPOSAL';});
negative('duplicate source step',v=>{v.manifest.applicationPlan.steps.push(clone(v.manifest.applicationPlan.steps[0]));});
negative('missing source step',v=>{v.manifest.applicationPlan.steps.shift();});
negative('extra manifest field',v=>{v.manifest.allowCatalogPass=true;});
negative('missing manifest field',v=>{delete v.manifest.candidate;});
negative('tampered migration',v=>{v.source+=' -- tamper';});
negative('regex changed',v=>{v.source=v.source.replace('^[a-z0-9-]+$','^.*$');});
negative('bounds inverted',v=>{v.source=v.source.replace('between 2 and 64','between 64 and 2');});
negative('duplicate CHECK',v=>{v.source+=' '+T0T1_ORIGINAL;});
negative('CRLF noncanonical',v=>{v.source=v.source.replace(/\n/,'\r\n');});
negative('missing source',v=>{v.source='';});
for(const [label,change] of [
 ['forged catalog approval',p=>({...p,allowCatalogPass:true})],
 ['forged decision',p=>({...p,decision:'GO'})],
 ['forged native flag',p=>({...p,nativeExecutionAvailable:true})],
 ['forged hosted permission',p=>({...p,hostedMigration:'READY'})],
 ['changed scope',p=>({...p,scope:'HOSTED'})],
 ['missing variant',p=>({...p,variants:[p.variants[0]]})],
 ['extra step',p=>({...p,stages:[...p.stages,'OVERRIDE']})],
 ['reordered mandatory steps',p=>({...p,stages:[...p.stages].reverse()})],
 ['sparse offline stages',p=>({...p,stages:new Array(8)})],
 ['deleted offline stage slot',p=>{const q=structuredClone(p);delete q.stages[2];return q;}],
 ['extra offline stage property',p=>{const q=structuredClone(p);q.stages.canExecute=true;return q;}],
 ['extra plan permission',p=>({...p,runNative:true})],
 ['missing plan field',p=>{const q={...p};delete q.writePerformed;return q;}],
 ['extra variant permission',p=>({...p,variants:[{...p.variants[0],allowRestore:true},p.variants[1]]})],
 ['forged T0 predicate digest',p=>({...p,variants:[{...p.variants[0],sourcePredicateSha256:'0'.repeat(64)},p.variants[1]]})],
 ['forged T1 predicate digest',p=>({...p,variants:[p.variants[0],{...p.variants[1],sourcePredicateSha256:'0'.repeat(64)}]})],
 ['missing variant metadata',p=>{const v={...p.variants[0]};delete v.sourcePredicateSha256;return {...p,variants:[v,p.variants[1]]};}],
 ['forged T0 DDL digest',p=>({...p,variants:[{...p.variants[0],ddlSha256:'0'.repeat(64)},p.variants[1]]})],
 ['forged T1 DDL digest',p=>({...p,variants:[p.variants[0],{...p.variants[1],ddlSha256:'0'.repeat(64)}]})],
 ['identical forged DDL digests',p=>({...p,variants:p.variants.map(v=>({...v,ddlSha256:'0'.repeat(64)}))})],
 ['swapped DDL digests',p=>({...p,variants:[{...p.variants[0],ddlSha256:p.variants[1].ddlSha256},{...p.variants[1],ddlSha256:p.variants[0].ddlSha256}]})],
 ['forged full candidate digest',p=>({...p,inMemoryCandidateSha256:'0'.repeat(64)})]
]){
 assert.throws(()=>assertPlanIsBlocked(change(plan),source),/ISSUE49 T0T1 OFFLINE STOP/,label);denied++;
}
// Confirm CLI never accepts --run-local, and its normal execution only reports a blocked plan.
const executable=fileURLToPath(new URL('./issue49-pr39-t0t1-offline-executor.mjs',import.meta.url));
const safeEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS','DOCKER_TLS_VERIFY',
 'DOCKER_CERT_PATH','PGHOST','PGHOSTADDR','PGSERVICE','PGPASSWORD','PGDATABASE','DATABASE_URL','SUPABASE_DB_URL']) delete safeEnv[key];
const run=(args)=>spawnSync(process.execPath,[executable,...args],{
 cwd:root,env:safeEnv,encoding:'utf8',timeout:7000,maxBuffer:100000
});
const ok=run([]);
assert.equal(ok.status,0,ok.stderr);
assert.match(ok.stdout,/PASS ISSUE49 T0T1 OFFLINE PREFLIGHT/);
assert.match(ok.stdout,/NATIVE EXECUTION: UNAVAILABLE/);
assert.match(ok.stdout,/BLOCKED \/ NOT_VERIFIED/);
for(const flag of ['--run-local','--native','--restore','--approve']){
 const result=run([flag]);
 assert.notEqual(result.status,0,flag+' unexpectedly accepted');
 assert.match(result.stderr,/OFFLINE STOP/);
 denied++;
}
console.log('PASS ISSUE49 T0T1 OFFLINE NEGATIVES ('+denied+' rejected cases; no Docker/SQL/filesystem writes)');
console.log('ISSUE49 POLICY: '+T0T1_NO_GO+'; allowCatalogPass=false; native execution unavailable');
