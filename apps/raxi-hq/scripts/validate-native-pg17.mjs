// Only the pre-existing, explicitly approved local Docker laboratory. No B2.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {inspectLab,installLab,labPort,LAB,PG17_SCHEMA_SHA256,closeNativePorts} from './native-pg17-lab.mjs';
import {inspectRaxiSchema,loadPreparationManifest,digest,verifySqlSources} from './staging-manifest.mjs';
const mode=process.argv.slice(2);
if(mode.length!==1||!['--install-and-test','--test-existing'].includes(mode[0]))throw Error('Explicit --install-and-test or --test-existing required; no arbitrary target');
await mkdir('.validation',{recursive:true});
try {
const manifest=await loadPreparationManifest();await verifySqlSources(manifest);
const installed=mode[0]==='--install-and-test'?await installLab():null;
const isolation=inspectLab(),schema=await inspectRaxiSchema(labPort('raxi_local'));
// PG18 adds NOT NULL pg_constraint rows; locale can reorder index aggregation.
// Preserve the hosted/PG18 pin; compare against a separate reviewed PG17 baseline.
const expected=JSON.parse(await readFile('../../supabase/tests/pg17.expected-schema.json','utf8'));
if(schema.postgresMajor!==17||digest(expected)!==PG17_SCHEMA_SHA256||digest(schema)!==PG17_SCHEMA_SHA256)
 throw Error('PG17 catalog differs from reviewed local baseline; stop and inspect');
await closeNativePorts();
await build({entryPoints:['tests/nativePg17.test.ts'],outfile:'.validation/nativePg17.test.mjs',bundle:true,platform:'node',format:'esm',
 external:['../scripts/native-pg17-lab.mjs','../scripts/staging-manifest.mjs']});
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','.validation/nativePg17.test.mjs'],{stdio:'inherit'});
const report={kind:'NATIVE_PG17_LOCAL_ONLY',checkedAt:new Date().toISOString(),isolation,serverVersion:LAB.version,
 sources:manifest.applicationPlan.steps.map(s=>({id:s.id,sha256Lf:s.sha256Lf})),schemaSha256:digest(schema),
 installedThisInvocation:installed!==null,
 testsPassed:result.status===0,b2Executed:false,hostedAuthValidated:false,providersCalled:0};
await writeFile('.validation/native-pg17-result.json',JSON.stringify(report,null,2)+'\n');
if(result.status!==0)process.exitCode=result.status??1;
} finally {await closeNativePorts();}
