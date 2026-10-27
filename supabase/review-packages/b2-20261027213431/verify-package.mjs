// Offline, read-only verifier. No database or CLI access.
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {checkStagingPreparation} from '../../../apps/raxi-hq/scripts/verify-staging-preparation.mjs';
const folder=dirname(fileURLToPath(import.meta.url));
const root=resolve(folder,'../../..');
const digest=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
const fail=s=>{throw Error(s);};
const prerequisite=await checkStagingPreparation();
if(prerequisite.sqlSources!==7||prerequisite.executionReady!==false||prerequisite.remoteAccess!==false||prerequisite.sqlApplied!==false||prerequisite.candidate?.sqlExecuted!==false)fail('Authoritative staging preparation not in safe verified state');
const pkg=JSON.parse(await readFile(resolve(folder,'package.review.json'),'utf8'));
if(pkg.kind!=='RAXI_B2_REVIEW_ONLY'||pkg.executionReady!==false||pkg.sqlExecutionAuthorized!==false||pkg.b2Authorized!==false||pkg.deployAuthorized!==false||pkg.providersAuthorized!==false||pkg.accountsAuthorized!==false)fail('Review-only flags invalid');
if(pkg.stagingProjectRef!=='zvhxjindgyvtasstfjut'||pkg.fileOrder?.length!==5||pkg.cliGeneratedFilename!=='20261027213431_supervised_runtime_b2.sql')fail('Unexpected package identity');
const names=(await readdir(folder)).filter(x=>x.endsWith('.sql')).sort();
const expected=pkg.fileOrder.map(x=>x.name).sort();
if(JSON.stringify(names)!==JSON.stringify(expected)||names.some(x=>x.includes('campaign_strategy')))fail('Unexpected SQL file names');
const originalManifest=JSON.parse(await readFile(resolve(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
const expectedSources=[...originalManifest.applicationPlan.steps.slice(0,4).map(x=>({name:x.path.split('/').at(-1),source:x.path,sha256Lf:x.sha256Lf})),{name:pkg.cliGeneratedFilename,source:originalManifest.candidate.path,sha256Lf:originalManifest.candidate.sha256Lf}];
if(JSON.stringify(pkg.fileOrder)!==JSON.stringify(expectedSources))fail('Order or source hashes diverged from authoritative manifest');
for(const entry of pkg.fileOrder){
 const staged=await readFile(resolve(folder,entry.name),'utf8');
 const source=await readFile(resolve(root,entry.source),'utf8');
 if(digest(staged)!==entry.sha256Lf||digest(source)!==entry.sha256Lf||staged.replaceAll('\r\n','\n')!==source.replaceAll('\r\n','\n'))fail('Content or source mismatch: '+entry.name);
}
if(!pkg.excluded?.includes('20261020234358_raxi_hq_campaign_strategy_pending_review.sql'))fail('Campaign exclusion missing');
console.log(JSON.stringify({kind:pkg.kind,files:5,verified:true,remoteAccess:false,sqlExecuted:false,executionReady:false,version:pkg.cliGeneratedFilename}));
