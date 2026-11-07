// Offline-only diagnostic. Reports catalog hash drift without writing any schema or accessing Supabase.
// Run from apps/raxi-hq after dependencies are available: node scripts/report-workspace-schema-drift.mjs
import {build} from 'esbuild';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectRaxiSchema, digest, verifyPreparationManifest, verifySqlSources} from './staging-manifest.mjs';

if (process.argv.length !== 2) throw Error('This diagnostic takes no arguments; hosted execution is forbidden.');
const cwd=process.cwd();
const root=resolve(cwd,'../..');
const manifest=verifyPreparationManifest(JSON.parse(await readFile(resolve(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8')));
const sources=await verifySqlSources(manifest);
const expected=JSON.parse(await readFile(resolve(root,manifest.expectedSchemaPath),'utf8'));
await mkdir(resolve(cwd,'.validation'),{recursive:true});
await build({
 entryPoints:['tests/campaignDatabase.ts'],outfile:'.validation/campaignDatabase-schema-drift.mjs',
 bundle:true,platform:'node',format:'esm',external:['@electric-sql/pglite'],
});
const {campaignDatabase}=await import(pathToFileURL(resolve(cwd,'.validation/campaignDatabase-schema-drift.mjs')).href);
const db=await campaignDatabase(false);
let observed;
try {
 await db.exec('alter table auth.users add column is_anonymous boolean not null default false;create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz)');
 for(const src of sources.filter(item=>item.kind==='RUNTIME_PROPOSAL'))await db.exec(src.text);
 observed=await inspectRaxiSchema(db);
}finally{await db.close()}
const diffs=[];
const byName=new Map(expected.tables.map(x=>[x.name,x]));
if(expected.tables.length!==observed.tables.length)throw Error('Different number of tables: inspect full schema before updating any fixture');
for(const t of observed.tables){
 const old=byName.get(t.name);
 if(!old)throw Error('Unexpected table '+t.name);
 if(old.sha256!==t.sha256)diffs.push({table:t.name,oldSha256:old.sha256,newSha256:t.sha256});
}
const sameShape=JSON.stringify({...expected,tables:[]})===JSON.stringify({...observed,tables:[]});
const schemaMatchesPinnedSnapshot= sameShape && diffs.length===0 && digest(observed)===manifest.expectedSchemaSha256;
const onlyExpectedWorkspaceDrift= sameShape && diffs.length===1 && diffs[0].table==='raxi_workspaces';
const result={
 status:schemaMatchesPinnedSnapshot?'SCHEMA_MATCH':onlyExpectedWorkspaceDrift?'EXPECTED_WORKSPACE_ACL_DRIFT':'UNEXPECTED_SCHEMA_DRIFT',
 previousExpectedDigest:manifest.expectedSchemaSha256,
 candidateDigest:digest(observed),
 changedTables:diffs,otherCatalogComponentsMatch:sameShape,
 inspectionScope:'ISOLATED_PGLITE_ONLY',hostedActions:false,
};
console.log(JSON.stringify(result,null,2));
if(!schemaMatchesPinnedSnapshot && !onlyExpectedWorkspaceDrift)process.exitCode=1;
