// Diagnostic ONLY: a recognized representation never authorizes catalog equality.
import {createHash} from 'node:crypto';
import {canonical} from '../apps/raxi-hq/scripts/staging-manifest.mjs';
export const constraintFingerprint=value=>createHash('sha256').update(canonical(value),'utf8').digest('hex');
export function reviewedSlugDefinitions(sources){
 const source=sources.find(s=>s.id==='20261019030541');
 const match=source?.text.match(/\bslug\s+text\s+not\s+null\s+check\s*\(length\(slug\)\s+between\s+(\d+)\s+and\s+(\d+)\s+and\s+slug\s*~\s*'((?:[^']|'')*)'\)/i);
 if(!match||match[1]!=='2'||match[2]!=='64')throw Error('PR39 STOP: reviewed slug contract not recognized');
 const lo='(length(slug) >= '+match[1]+')',hi='(length(slug) <= '+match[2]+')',regex="(slug ~ '"+match[3]+"'::text)";
 return Object.freeze({nested:`CHECK (((${lo} AND ${hi}) AND ${regex}))`,flat:`CHECK ((${lo} AND ${hi} AND ${regex}))`});
}
export function classifySlugRepresentation(table,name,before,after,reviewed){
 if(table!=='tables/raxi_workspaces'||name!=='raxi_workspaces_slug_check'||!reviewed)return 'UNCLASSIFIED';
 if(before===reviewed.nested&&after===reviewed.flat)return 'BETWEEN_EXPANSION_AND_REGROUPING_CANDIDATE';
 return 'UNCLASSIFIED';
}
// Read-only supplemental metadata for a FUTURE explicitly authorized native run.
// conbin stays inside PostgreSQL: only resolved identities/flags are returned.
export const slugContextQuery=`with target as (
 select c.*,a.atttypid,a.atttypmod,a.attcollation,a.attnotnull
 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid
 join pg_catalog.pg_namespace n on n.oid=r.relnamespace
 join pg_catalog.pg_attribute a on a.attrelid=r.oid and a.attname='slug' and not a.attisdropped
 where n.nspname='public' and r.relname='raxi_workspaces' and c.conname='raxi_workspaces_slug_check'
), ops as (
 select distinct o.* from target t cross join lateral pg_catalog.regexp_matches(t.conbin::text,':opno ([0-9]+)','g') m
 join pg_catalog.pg_operator o on o.oid=m[1]::oid
), funcs as (
 select o.oprcode::oid id from ops o union
 select m[1]::oid from target t cross join lateral pg_catalog.regexp_matches(t.conbin::text,':funcid ([0-9]+)','g') m
), types as (
 select m[1]::oid id from target t cross join lateral pg_catalog.regexp_matches(t.conbin::text,':(?:vartype|consttype|opresulttype|funcresulttype) ([0-9]+)','g') m
), collations as (
 select m[1]::oid id from target t cross join lateral pg_catalog.regexp_matches(t.conbin::text,':(?:varcollid|constcollid|inputcollid|opcollid|funccollid) ([0-9]+)','g') m where m[1]<>'0'
)
select jsonb_build_object(
 'settings',jsonb_build_object('searchPath',current_setting('search_path'),'strings',current_setting('standard_conforming_strings'),
 'encoding',current_setting('server_encoding'),'lcCollate',d.datcollate,'lcCtype',d.datctype,'version',current_setting('server_version_num'),
 'localeProvider',d.datlocprovider,'locale',d.datlocale,'icuRules',d.daticurules,'collationVersion',d.datcollversion),
 'constraint',jsonb_build_object('kind',t.contype,'validated',t.convalidated,'deferrable',t.condeferrable,'deferred',t.condeferred,
 'local',t.conislocal,'noInherit',t.connoinherit,'inherited',t.coninhcount,'columns',t.conkey),
 'column',jsonb_build_object('type',pg_catalog.format_type(t.atttypid,t.atttypmod),'notNull',t.attnotnull,'typeMod',t.atttypmod,
 'collation',(select n.nspname||'.'||c.collname from pg_catalog.pg_collation c join pg_catalog.pg_namespace n on n.oid=c.collnamespace where c.oid=t.attcollation)),
 'operators',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',o.oprname,'left',pg_catalog.format_type(o.oprleft,null),'right',pg_catalog.format_type(o.oprright,null),'result',pg_catalog.format_type(o.oprresult,null)) order by n.nspname,o.oprname,o.oprleft,o.oprright),'[]'::jsonb) from ops o join pg_catalog.pg_namespace n on n.oid=o.oprnamespace),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'result',pg_catalog.pg_get_function_result(p.oid),'volatility',p.provolatile) order by n.nspname,p.proname,p.oid),'[]'::jsonb) from funcs f join pg_catalog.pg_proc p on p.oid=f.id join pg_catalog.pg_namespace n on n.oid=p.pronamespace),
 'types',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.typname) order by n.nspname,p.typname),'[]'::jsonb) from (select distinct id from types) f join pg_catalog.pg_type p on p.oid=f.id join pg_catalog.pg_namespace n on n.oid=p.typnamespace),
 'collations',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.collname,'provider',c.collprovider,'deterministic',c.collisdeterministic,'encoding',c.collencoding,'collate',c.collcollate,'ctype',c.collctype,'locale',c.colllocale,'rules',c.collicurules,'version',c.collversion) order by n.nspname,c.collname),'[]'::jsonb) from (select distinct id from collations) f join pg_catalog.pg_collation c on c.oid=f.id join pg_catalog.pg_namespace n on n.oid=c.collnamespace)
) v from target t cross join pg_catalog.pg_database d where d.datname=pg_catalog.current_database()`;

export function summarizeSlugContexts(before,after){
 const fields=['settings','constraint','column','operators','functions','types','collations'];
 const object=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&canonical(Object.keys(value).sort())===canonical([...keys].sort());
 const strings=(value,keys)=>keys.every(k=>typeof value[k]==='string');
 for(const value of [before,after]){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(k=>!Object.hasOwn(value,k)))
   throw Error('PR39 STOP: missing or malformed constraint context');
  for(const key of fields){
   const v=value[key],array=['operators','functions','types','collations'].includes(key);
   if(array?(!Array.isArray(v)||!v.length||v.some(x=>!x||typeof x!=='object'||Array.isArray(x)||!Object.keys(x).length)):(!v||typeof v!=='object'||Array.isArray(v)||!Object.keys(v).length))
    throw Error('PR39 STOP: malformed constraint context field '+key);
  }
  const s=value.settings,c=value.constraint,col=value.column;
  const settingStrings=['searchPath','strings','encoding','lcCollate','lcCtype','version','localeProvider'];
  if(!object(s,[...settingStrings,'locale','icuRules','collationVersion'])||!strings(s,settingStrings)||!/^17\d{4}$/.test(s.version)||
   !['b','c','i'].includes(s.localeProvider)||['locale','icuRules','collationVersion'].some(k=>s[k]!==null&&typeof s[k]!=='string')||
   !object(c,['kind','validated','deferrable','deferred','local','noInherit','inherited','columns'])||c.kind!=='c'||
   ['validated','deferrable','deferred','local','noInherit'].some(k=>typeof c[k]!=='boolean')||!Number.isSafeInteger(c.inherited)||c.inherited<0||
   !Array.isArray(c.columns)||!c.columns.length||c.columns.some(n=>!Number.isSafeInteger(n)||n<1)||
   !object(col,['type','notNull','typeMod','collation'])||typeof col.type!=='string'||typeof col.collation!=='string'||typeof col.notNull!=='boolean'||!Number.isSafeInteger(col.typeMod))
   throw Error('PR39 STOP: malformed resolved constraint context');
  for(const key of ['operators','functions','types','collations']){
   const keys={operators:['schema','name','left','right','result'],functions:['schema','name','arguments','result','volatility'],types:['schema','name'],
    collations:['schema','name','provider','deterministic','encoding','collate','ctype','locale','rules','version']}[key];
   const seen=new Set();
   for(const row of value[key]){
    if(!object(row,keys)||!strings(row,key==='collations'?['schema','name','provider']:keys)||!row.schema||!row.name||seen.has(canonical(row))||
     (key==='functions'&&!['i','s','v'].includes(row.volatility))||
     (key==='collations'&&(typeof row.deterministic!=='boolean'||!Number.isSafeInteger(row.encoding)||['collate','ctype','locale','rules','version'].some(k=>row[k]!==null&&typeof row[k]!=='string'))))
     throw Error('PR39 STOP: invalid resolved object identity');
    seen.add(canonical(row));
   }
  }
 }
 return fields.map(field=>({field,before:constraintFingerprint(before[field]).slice(0,12),restored:constraintFingerprint(after[field]).slice(0,12),
  classification:canonical(before[field])===canonical(after[field])?'IDENTICAL_METADATA':'DIFFERENT_METADATA'}));
}
