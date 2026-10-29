// PR39: describe *what* differs, never convert a catalog mismatch into PASS.
// Plain PostgreSQL metadata only. Outputs names, fields, and short SHA fingerprints,
// never SQL source bodies, Auth rows, connection credentials, or synthetic data.
import {createHash} from 'node:crypto';
import {canonical} from '../apps/raxi-hq/scripts/staging-manifest.mjs';
import {classifySlugRepresentation} from './pr39-constraint-analysis.mjs';

const stable=value=>value===undefined?'__MISSING__':canonical(value);
const finger=value=>createHash('sha256').update(stable(value),'utf8').digest('hex').slice(0,12);
const identity=(label,row)=>label==='functions'?row.name:row.name;
const FIELD_LIMIT=80;
// Compare constraints by their actual PostgreSQL names, not only a table-level hash.
function constraintsDiff(table,before,after,reviewed){
 if(!Array.isArray(before)||!Array.isArray(after))
  return [table+': constraints metadata missing or malformed'];
 const map=(items,label)=>{
  const result=new Map();
  for(const row of items){
   if(!row||typeof row.name!=='string'||!row.name||
      typeof row.definition!=='string'||result.has(row.name))
    throw Error('PR39 STOP: invalid/duplicate '+label+' constraint identity');
   result.set(row.name,row);
  }
  return result;
 };
 const source=map(before,'source'),restored=map(after,'restored'),issues=[];
 for(const name of [...new Set([...source.keys(),...restored.keys()])].sort()){
  const a=source.get(name),b=restored.get(name);
  if(!a){issues.push(table+'/constraint/'+name+': unexpected in restore [sha '+finger(b)+']');continue;}
  if(!b){issues.push(table+'/constraint/'+name+': missing in restore [sha '+finger(a)+']');continue;}
  if(stable(a)!==stable(b)){
   if(a.definition!==b.definition){
    issues.push(table+'/constraint/'+name+': definition differs [before '+finger(a.definition)+
      ', restored '+finger(b.definition)+']');
    const classification=classifySlugRepresentation(table,name,a.definition,b.definition,reviewed);
    if(classification!=='UNCLASSIFIED')issues[issues.length-1]+='; '+classification+'; SEMANTIC_EQUIVALENCE_NOT_VERIFIED; strict mismatch retained';
   }
   else issues.push(table+'/constraint/'+name+': non-definition metadata differs [before '+
      finger(a)+', restored '+finger(b)+']');
  }
 }
 if(!issues.length)
  issues.push(table+': constraint lists differ only by ordering or representation [source='+
    source.size+', restored='+restored.size+']');
 return issues;
}
function validateCatalog(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.postgresMajor!==17||!value.schema||typeof value.schema!=='object'||Array.isArray(value.schema)||!Object.keys(value.schema).length)
  throw Error('PR39 STOP: invalid catalog envelope');
 const require=(ok)=>{if(!ok)throw Error('PR39 STOP: malformed catalog metadata');};
 const record=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&canonical(Object.keys(v).sort())===canonical([...keys].sort());
 const text=v=>typeof v==='string'&&v.length>0;
 const nullableText=v=>v===null||typeof v==='string';
 const list=(v,check)=>{require(v===null||Array.isArray(v));if(v!==null)for(const item of v)require(check(item));};
 const acl=(v,column=false)=>record(v,column?['column','role','privilege','grantable']:['role','privilege','grantable'])&&
  text(v.role)&&text(v.privilege)&&typeof v.grantable==='boolean'&&(!column||text(v.column));
 require(record(value,['schema','postgresMajor','tables','functions','roles','otherPublicRelations']));
 require(record(value.schema,['postgresMajor','tables','functions','roles','otherPublicRelations'])&&value.schema.postgresMajor===17);
 for(const k of ['tables','functions','roles','otherPublicRelations'])require(Array.isArray(value.schema[k]));
 for(const r of [...value.schema.tables,...value.schema.functions])require(r&&text(r.name)&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256));
 for(const section of ['tables','functions','roles','otherPublicRelations']){
  if(!Array.isArray(value[section]))throw Error('PR39 STOP: invalid catalog section '+section);
  const names=new Set();
  for(const row of value[section]){
   if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.name!=='string'||!row.name||names.has(row.name))
    throw Error('PR39 STOP: invalid or duplicate catalog identity');
   names.add(row.name);
   const keys={functions:['name','definition','definer','config','grants'],roles:['name','superuser','bypass_rls'],otherPublicRelations:['name'],
    tables:['name','kind','rls','force_rls','view_definition','columns','constraints','indexes','triggers','policies','grants','column_grants']}[section];
   require(record(row,keys));
   if(section==='functions'&&(typeof row.definition!=='string'||!row.definition))throw Error('PR39 STOP: invalid function metadata');
   if(section==='functions'){
    require(typeof row.definer==='boolean');list(row.grants,acl);
    if(Object.hasOwn(row,'definer')&&typeof row.definer!=='boolean')throw Error('PR39 STOP: invalid function security flag');
    if(Object.hasOwn(row,'config')&&row.config!==null&&(!Array.isArray(row.config)||row.config.some(x=>typeof x!=='string')))
     throw Error('PR39 STOP: invalid function settings');
   }
   if(section==='roles'&&['superuser','bypass_rls'].some(k=>Object.hasOwn(row,k)&&typeof row[k]!=='boolean'))
    throw Error('PR39 STOP: invalid role security flag');
   if(section==='tables'){
    require(['r','p','v','m','f'].includes(row.kind)&&typeof row.force_rls==='boolean'&&nullableText(row.view_definition));
    require(Array.isArray(row.columns)&&row.columns.length>0);
    list(row.columns,c=>record(c,['name','type','required','identity','generated','default'])&&text(c.name)&&text(c.type)&&typeof c.required==='boolean'&&
     typeof c.identity==='string'&&typeof c.generated==='string'&&nullableText(c.default));
    list(row.indexes,text);list(row.triggers,text);list(row.grants,acl);list(row.column_grants,v=>acl(v,true));
    list(row.policies,p=>record(p,['name','roles','cmd','permissive','qual','check'])&&text(p.name)&&Array.isArray(p.roles)&&p.roles.length>0&&p.roles.every(text)&&
     ['ALL','SELECT','INSERT','UPDATE','DELETE'].includes(p.cmd)&&['PERMISSIVE','RESTRICTIVE'].includes(p.permissive)&&nullableText(p.qual)&&nullableText(p.check));
    if(typeof row.rls!=='boolean'||!Array.isArray(row.constraints))throw Error('PR39 STOP: invalid table metadata');
    const constraints=new Set();
    for(const c of row.constraints){
     require(record(c,['name','definition']));
     if(!c||typeof c!=='object'||Array.isArray(c)||typeof c.name!=='string'||!c.name||typeof c.definition!=='string'||!c.definition||constraints.has(c.name))
      throw Error('PR39 STOP: invalid or duplicate constraint metadata');
     constraints.add(c.name);
    }
    for(const field of ['policies','grants','indexes','triggers','columns','column_grants']){
     if(Object.hasOwn(row,field)&&row[field]!==null&&!Array.isArray(row[field]))throw Error('PR39 STOP: malformed table catalog array');
     for(const item of row[field]??[]){
      if(['indexes','triggers'].includes(field)){
       if(typeof item!=='string'||!item)throw Error('PR39 STOP: invalid table catalog definition');
      }else{
       if(!item||typeof item!=='object'||Array.isArray(item)||!Object.keys(item).length)throw Error('PR39 STOP: invalid table catalog item');
       if(['columns','policies'].includes(field)&&(typeof item.name!=='string'||!item.name))throw Error('PR39 STOP: invalid table catalog identity');
       if(['grants','column_grants'].includes(field)&&(typeof item.role!=='string'||!item.role||typeof item.privilege!=='string'||!item.privilege||
         (Object.hasOwn(item,'grantable')&&typeof item.grantable!=='boolean')||(field==='column_grants'&&(typeof item.column!=='string'||!item.column))))
        throw Error('PR39 STOP: invalid table ACL item');
      }
     }
    }
   }
  }
 }
}
export function describePr39CatalogMismatch(source,destination,reviewed){
 const issues=[];
 validateCatalog(source);validateCatalog(destination);
 for(const section of ['tables','functions','roles','otherPublicRelations']){
  const left=source[section],right=destination[section];
  if(!Array.isArray(left)||!Array.isArray(right))
   throw Error('PR39 diagnostic missing '+section);
  const a=new Map(),b=new Map();
  for(const row of left){
   const key=identity(section,row);
   if(typeof key!=='string'||a.has(key))throw Error('PR39 diagnostic source key collision');
   a.set(key,row);
  }
  for(const row of right){
   const key=identity(section,row);
   if(typeof key!=='string'||b.has(key))throw Error('PR39 diagnostic restore key collision');
   b.set(key,row);
  }
  for(const key of [...new Set([...a.keys(),...b.keys()])].sort()){
   if(!a.has(key)){issues.push(section+': unexpected restored '+key);continue;}
   if(!b.has(key)){issues.push(section+': missing restored '+key);continue;}
   const l=a.get(key),r=b.get(key);
   for(const field of [...new Set([...Object.keys(l),...Object.keys(r)])].sort()){
    if(stable(l[field])===stable(r[field]))continue;
    const changed=field==='definition'?'function definition':
      field==='policies'?'RLS policy definitions':
      field==='grants'?'ACL grant list':field;
    if(section==='tables'&&field==='constraints'){
     const breakdown=constraintsDiff(section+'/'+key,l[field],r[field],reviewed);
     issues.push(...breakdown);
    }else{
     issues.push(section+'/'+key+': '+changed+
       ' [before '+finger(l[field])+', restored '+finger(r[field])+']');
    }
   }
  }
 }
 if(stable(source.postgresMajor)!==stable(destination.postgresMajor))
  issues.push('PostgreSQL major version differs');
 if(!issues.length&&stable(source.schema)!==stable(destination.schema))
  issues.push('canonical inspector mismatch without raw row difference');
 return Object.freeze({count:issues.length,issues:issues.slice(0,FIELD_LIMIT),
   truncated:issues.length>FIELD_LIMIT});
}
// Shared by the runner and offline regressions. No diagnostic or short hash can
// waive differences in raw metadata or canonical inspector hashes.
export function assertPr39CatalogEquality(source,destination){
 const diff=describePr39CatalogMismatch(source,destination);
 if(diff.count||stable(source.schema)!==stable(destination.schema))throw Error('PR39 STOP: strict catalog mismatch');
}
