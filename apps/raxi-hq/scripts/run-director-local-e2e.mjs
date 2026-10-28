// Opt-in targeted PGlite integration tests; never connects to hosted Supabase.
// Run only from apps/raxi-hq: node scripts/run-director-local-e2e.mjs --run-local
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

if(process.argv.length!==3||process.argv[2]!=='--run-local'){
 console.error('REFUSED: opt in explicitly with --run-local. This is PGlite, NOT native PG17 or hosted Auth.');
 process.exit(2);
}
const entries=['supervisedHostIntegration.test.ts','supabaseSupervised.test.ts'];
const dir='.validation';
await mkdir(dir,{recursive:true});
await build({
 entryPoints:entries.map(name=>`tests/${name}`),
 outdir:dir,outExtension:{'.js':'.mjs'},bundle:true,
 platform:'node',format:'esm',
 define:{'import.meta.env':'{}'},
 external:['@electric-sql/pglite','@supabase/supabase-js','../scripts/staging-runtime-acceptance.mjs']
});
console.log('SCOPE: two existing local PGlite integration suites; no native PG17, no real Supabase Auth or hosted execution.');
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...entries.map(name=>`${dir}/${name.replace(/\.tsx?$/,'.mjs')}`)],{stdio:'inherit',env:{...process.env,RAXI_DIRECTOR_LOCAL_E2E:'1'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
