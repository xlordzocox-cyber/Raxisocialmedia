// Local-only static source evidence. No database, network, Docker, or subprocesses.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const targets={
 'apps/raxi-hq/tests/supervisedHostIntegration.test.ts':['createLocalSupervisedHost','localSupervisedRepository','simulatedProvider','runOne','PGlite'],
 'apps/raxi-hq/tests/supabaseSupervised.test.ts':['supabaseSupervisedAuth','supabaseSupervisedRepository','createSupabaseSupervisedHost','simulatedProvider','PGlite'],
 'apps/raxi-hq/tests/nativePg17Safety.test.ts':['validateLab','validateSqlTarget'],
 'apps/raxi-hq/scripts/native-pg17-lab.mjs':['raxi-pg17-validation','raxi-pg17-isolated']
};
for(const [path,needles] of Object.entries(targets)){
 const content=await readFile(resolve(root,path),'utf8');
 for(const needle of needles)if(!content.includes(needle))throw Error('Missing integration contract '+path+': '+needle);
}
const manifest=JSON.parse(await readFile(resolve(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
if(manifest.executionReady!==false||Object.values(manifest.authorizations||{}).some(x=>x!==false))throw Error('Hosted execution gate changed');
console.log(JSON.stringify({kind:'LOCAL_DIRECTOR_E2E_WIRING_STATIC_CHECK',filesChecked:Object.keys(targets).length,manifestBlocked:true,behaviorExecuted:false,nativePg17Executed:false,hostedAccess:false,providersInvoked:false}));
