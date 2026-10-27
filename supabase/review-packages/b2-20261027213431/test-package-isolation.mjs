// Isolated, read-only-against-checkout mutation tests: only temporary copies are modified.
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const folder='supabase/review-packages/b2-20261027213431';
const pkg=JSON.parse(await readFile(resolve(root,folder,'package.review.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
const paths=[
  'apps/raxi-hq/scripts/verify-staging-preparation.mjs',
  'apps/raxi-hq/scripts/staging-manifest.mjs',
  'apps/raxi-hq/scripts/consolidate-runtime-candidate.mjs',
  'supabase/staging/raxi-hq-staging.manifest.json',
  manifest.expectedSchemaPath,manifest.candidate.path,
  ...manifest.applicationPlan.steps.map(x=>x.path),
  folder+'/verify-package.mjs',folder+'/package.review.json',
  ...pkg.fileOrder.map(x=>folder+'/'+x.name)
];
const tmp=await mkdtemp(join(tmpdir(),'raxi-b2-review-test-'));
async function copy(relative){
 const to=resolve(tmp,relative);
 await mkdir(dirname(to),{recursive:true});
 await copyFile(resolve(root,relative),to);
}
function run(expectPass,label){
 const result=spawnSync(process.execPath,[resolve(tmp,folder,'verify-package.mjs')],{cwd:tmp,encoding:'utf8',timeout:15000,env:{...process.env}});
 if(result.error)throw result.error;
 if(expectPass){
  if(result.status!==0)throw Error(label+' should PASS: '+result.stderr);
  const output=JSON.parse(result.stdout.trim());
  if(output.verified!==true||output.sqlExecuted!==false||output.remoteAccess!==false||output.executionReady!==false)throw Error(label+' produced unsafe success');
 }else if(result.status===0)throw Error(label+' unexpectedly passed: '+result.stdout);
 console.log(JSON.stringify({case:label,result:expectPass?'PASS_EXPECTED':'REJECTED_EXPECTED'}));
}
try{
 for(const path of new Set(paths))await copy(path);
 run(true,'original_package');
 const runtime='supabase/proposals/agent_runtime.sql';
 await writeFile(resolve(tmp,runtime),await readFile(resolve(tmp,runtime),'utf8')+'\n-- mutated in disposable fixture only\n');
 run(false,'runtime_source_mutation');
 await copy(runtime);
 const manifestPath='supabase/staging/raxi-hq-staging.manifest.json';
 for(const [label,mutate] of [
  ['execution_ready_mutation',x=>{x.executionReady=true;}],
  ['apply_sql_authorization_mutation',x=>{x.authorizations.applySql=true;}]
 ]){
  const original=JSON.parse(await readFile(resolve(tmp,manifestPath),'utf8'));
  mutate(original);
  await writeFile(resolve(tmp,manifestPath),JSON.stringify(original,null,2)+'\n');
  run(false,label);
  await copy(manifestPath);
 }
}finally{await rm(tmp,{recursive:true,force:true});}
