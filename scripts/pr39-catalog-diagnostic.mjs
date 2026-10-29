// PR39: describe *what* differs, never convert a catalog mismatch into PASS.
// Plain PostgreSQL metadata only. Outputs names, fields, and short SHA fingerprints,
// never SQL source bodies, Auth rows, connection credentials, or synthetic data.
import {createHash} from 'node:crypto';
import {canonical} from '../apps/raxi-hq/scripts/staging-manifest.mjs';

const stable=value=>value===undefined?'__MISSING__':canonical(value);
const finger=value=>createHash('sha256').update(stable(value),'utf8').digest('hex').slice(0,12);
const identity=(label,row)=>label==='functions'?row.name:row.name;
const FIELD_LIMIT=80;
// Compare constraints by their actual PostgreSQL names, not only a table-level hash.
function constraintsDiff(table,before,after){
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
 issues.push(table+': constraint inventory source='+source.size+' restored='+restored.size);
 for(const name of [...new Set([...source.keys(),...restored.keys()])].sort()){
  const a=source.get(name),b=restored.get(name);
  if(!a){issues.push(table+'/constraint/'+name+': unexpected in restore [sha '+finger(b)+']');continue;}
  if(!b){issues.push(table+'/constraint/'+name+': missing in restore [sha '+finger(a)+']');continue;}
  if(stable(a)!==stable(b))
   issues.push(table+'/constraint/'+name+': definition differs [before '+finger(a.definition)+
     ', restored '+finger(b.definition)+']');
 }
 return issues;
}
export function describePr39CatalogMismatch(source,destination){
 const issues=[];
 if(!source||!destination)throw Error('PR39 diagnostic requires both catalog snapshots');
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
     const breakdown=constraintsDiff(section+'/'+key,l[field],r[field]);
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
