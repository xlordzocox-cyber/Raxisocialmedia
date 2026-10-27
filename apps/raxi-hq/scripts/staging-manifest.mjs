// Offline preparation and read-only verification only. No network or SQL application.
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export const STAGING_PROJECT=Object.freeze({ref:'zvhxjindgyvtasstfjut',name:'raxi-hq-staging',organizationId:'qpjzdqkvjzgqwvismeku',region:'us-east-2',postgresMajor:17});
export const REVIEWED_STAGING_MANIFEST_SHA256='872378b984779365f3bd0106a13191edfddf99978e3faa8b0c6eb76f6d919ce4';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const manifestPath='supabase/staging/raxi-hq-staging.manifest.json';
export function canonical(value) {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const sqlDigest=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
export function verifyPreparationManifest(manifest) {
 if(digest(manifest)!==REVIEWED_STAGING_MANIFEST_SHA256)throw Error('Reviewed staging manifest changed');
 if(canonical(manifest.project)!==canonical(STAGING_PROJECT)||manifest.project.ref==='jrkefsylpfriiqefcmzq')throw Error('Pinned staging project required');
 return manifest;
}
export async function loadPreparationManifest() {
 const manifest=verifyPreparationManifest(JSON.parse(await readFile(resolve(root,manifestPath),'utf8')));
 await verifySqlSources(manifest);
 verifySchemaCandidate(manifest,JSON.parse(await readFile(resolve(root,manifest.expectedSchemaPath),'utf8')));
 return manifest;
}
export async function verifySqlSources(manifest,readSource=async path=>{
 const full=await realpath(resolve(root,path));
 if(!full.startsWith((await realpath(root))+sep))throw Error('Source outside repository');
 return readFile(full,'utf8');
}) {
 manifest=structuredClone(verifyPreparationManifest(manifest)); // capture before the first source-read await
 const sources=[];
 for(const step of manifest.applicationPlan.steps) {
  const text=await readSource(step.path);
  if(sqlDigest(text)!==step.sha256Lf)throw Error('SQL source hash mismatch');
  sources.push({id:step.id,kind:step.kind,version:step.version,text});
 }
 return sources; // In-memory assembly only; no executor, shell command or migration history write.
}
export function assertPinnedTarget(target) {
 if(target.ref!==STAGING_PROJECT.ref||target.api!==`https://${STAGING_PROJECT.ref}.supabase.co`)throw Error('Only reviewed staging project allowed');
}
export function verifyObservedProject(project) {
 if(!project||project.id!==STAGING_PROJECT.ref||project.name!==STAGING_PROJECT.name||project.organization_id!==STAGING_PROJECT.organizationId||
  project.region!==STAGING_PROJECT.region||project.status!=='ACTIVE_HEALTHY')throw Error('Authenticated project identity mismatch');
}
export function verifyExecutionApproval(manifest,approval) {
 verifyPreparationManifest(manifest);
 if(!approval||approval.stagingManifestSha256!==REVIEWED_STAGING_MANIFEST_SHA256||approval.kind!=='SUPERVISED_B2_SIMULATION'||
  approval.projectRef!==STAGING_PROJECT.ref||approval.organizationId!==STAGING_PROJECT.organizationId||
  approval.baseCommit!==manifest.baseCommit||approval.providers!=='SIMULATED_ONLY'||approval.productionClone!==false||
  !Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=Date.now())throw Error('Approval expired or incompatible');
 // Preparation approval is explicitly NOT approval to migrate or run B2.
 // Future activation requires a reviewed manifest revision and assigned migration version.
 if(manifest.executionReady!==true||manifest.authorizations.runB2!==true||manifest.schemaCompatibility.status!=='VERIFIED_PG17'||manifest.applicationPlan.consolidatedRuntimeVersion===null)throw Error('B2 remains blocked: preparation only, no migration/execution authorization');
}
export function verifySchemaCandidate(manifest,schema) {
 verifyPreparationManifest(manifest);
 if(digest(schema)!==manifest.expectedSchemaSha256||schema.postgresMajor!==manifest.schemaCompatibility.localFixturePostgresMajor)throw Error('Schema candidate changed');
}
/** Metadata only. These SELECTs are invoked locally in tests; future hosted use
 * requires the separate B2 gate. Hashes exclude row data, owners and OIDs. */
export async function inspectRaxiSchema(db) {
 const tables=await db.query(`select c.relname as name,c.relkind as kind,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
  case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) else null end as view_definition,
  (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
  (select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid=c.oid) as constraints,
  (select jsonb_agg(pg_get_indexdef(indexrelid) order by pg_get_indexdef(indexrelid)) from pg_index where indrelid=c.oid) as indexes,
  (select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid=c.oid and not tgisinternal) as triggers,
  (select jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'cmd',cmd,'permissive',permissive,'qual',qual,'check',with_check) order by policyname) from pg_policies where schemaname='public' and tablename=c.relname) as policies,
  (select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee::regrole::text,x.privilege_type)
   from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where x.grantee=0 or pg_get_userbyid(x.grantee) in ('anon','authenticated','service_role')) as grants,
  (select jsonb_agg(jsonb_build_object('column',a.attname,'role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by a.attname,x.grantee::regrole::text,x.privilege_type)
   from pg_attribute a cross join lateral aclexplode(a.attacl) x where a.attrelid=c.oid and (x.grantee=0 or pg_get_userbyid(x.grantee) in ('anon','authenticated','service_role'))) as column_grants
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'raxi\\_%' escape '\\' and c.relkind in ('r','p','v','m','f') order by c.relname`);
 const functions=await db.query(`select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as name,
  p.prosecdef as definer,p.proconfig as config,pg_get_functiondef(p.oid) as definition,
  (select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee::regrole::text,x.privilege_type)
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 or pg_get_userbyid(x.grantee) in ('anon','authenticated','service_role')) as grants
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'raxi\\_%' escape '\\' order by 1`);
 const roles=await db.query("select rolname name,rolsuper superuser,rolbypassrls bypass_rls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname");
 const version=await db.query("select current_setting('server_version_num')::integer as version");
 const otherTables=await db.query("select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and left(c.relname,5)<>'raxi_' and c.relkind in ('r','p','v','m','f') order by c.relname");
 return {postgresMajor:Math.floor(version.rows[0].version/10000),tables:tables.rows.map(row=>({name:row.name,rls:row.rls,sha256:digest(row)})),
  functions:functions.rows.map(row=>({name:row.name,definer:row.definer,sha256:digest({...row,definition:row.definition.replaceAll('\r\n','\n')})})),roles:roles.rows,otherPublicRelations:otherTables.rows};
}
export function verifyObservedSchema(manifest,phase,observed) {
 verifyPreparationManifest(manifest);
 if(observed.postgresMajor!==STAGING_PROJECT.postgresMajor||observed.schema.postgresMajor!==observed.postgresMajor)throw Error('Unexpected PostgreSQL major version');
 if(canonical(observed.schema.otherPublicRelations)!=='[]')throw Error('Unexpected public relations');
 if(phase==='EMPTY') {
  if(canonical(observed.migrations)!=='[]'||canonical(observed.schema.tables)!=='[]'||canonical(observed.schema.functions)!=='[]')throw Error('Staging is not empty');
 }else if(phase==='READY') {
  if(manifest.applicationPlan.consolidatedRuntimeVersion===null)throw Error('Runtime migration version unassigned');
  if(canonical(observed.migrations)!==canonical(manifest.expectedReadyMigrationVersions)||digest(observed.schema)!==manifest.expectedSchemaSha256)throw Error('Unexpected staging schema or migration history');
 }else throw Error('Unknown schema phase');
}
