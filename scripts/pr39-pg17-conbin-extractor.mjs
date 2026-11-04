// PR39 CANDIDATE: read-only, offline PostgreSQL nodeToString decoder.
// Not PostgreSQL's stringToNode. Never authorizes schema equality or native PASS.
// Do not import from recovery runner/catalog equality gate.
import {createHash} from 'node:crypto';

export const PR39_CONBIN_EXTRACTOR_REVISION='PG17_CLOSED_GRAMMAR_CANDIDATE_V2';
// Offline only: 64-bit Datum layout is assumed, not independently verified.
const PG17_ASSUMED_DATUM_BYTES=8;
// Query definition only. Never executed/imported by the PR39 recovery runner.
// In future, execute only in explicitly authorized, isolated synthetic PG17.
export const PR39_LOCAL_CAPTURE_SELECT = `select
 current_setting('server_version_num')::integer as server_version_num,
 pg_catalog.current_database() as database_name,
 c.oid::text as constraint_oid, c.conbin::text as raw_conbin,
 c.contype as constraint_kind, c.convalidated as validated,
 c.connoinherit as no_inherit, c.conislocal as is_local, c.coninhcount as inherit_count,
 a.attnum as slug_attribute_num, a.atttypid::text as slug_type_oid,
 a.atttypmod as slug_type_modifier, a.attcollation::text as slug_collation_oid
from pg_catalog.pg_constraint c
join pg_catalog.pg_class t on t.oid=c.conrelid
join pg_catalog.pg_namespace n on n.oid=t.relnamespace
join pg_catalog.pg_attribute a on a.attrelid=t.oid and a.attname='slug' and not a.attisdropped
where n.nspname='public' and t.relname='raxi_workspaces'
 and c.conname='raxi_workspaces_slug_check' and c.contype='c'`;
const STOP='PR39 STOP: unsupported PostgreSQL 17 serialized expression';
const fail=()=>{throw Error(STOP);};
const FIELDS=Object.freeze({
 BOOLEXPR:['boolop','args','location'],
 OPEXPR:['opno','opfuncid','opresulttype','opretset','opcollid','inputcollid','args','location'],
 FUNCEXPR:['funcid','funcresulttype','funcretset','funcvariadic','funcformat','funccollid','inputcollid','args','location'],
 VAR:['varno','varattno','vartype','vartypmod','varcollid','varnullingrels','varlevelsup','varnosyn','varattnosyn','location'],
 CONST:['consttype','consttypmod','constcollid','constlen','constbyval','constisnull','location','constvalue']
});
const INT=/^(?:0|-?[1-9][0-9]*)$/;
const UNSIGNED=/^(?:0|[1-9][0-9]*)$/;
const scalar=(v)=>typeof v==='string'&&v.length>0;
const checkInt=(s,min=-2147483648,max=2147483647)=>scalar(s)&&INT.test(s)&&Number.isSafeInteger(Number(s))&&Number(s)>=min&&Number(s)<=max;
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');

function tokenize(source){
 if(typeof source!=='string'||!source.length||source.length>65536||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source))fail();
 const tokens=[];let i=0;
 while(i<source.length){
  if(/\s/.test(source[i])){i++;continue;}
  if('(){}[]'.includes(source[i])){tokens.push(source[i++]);continue;}
  if(source.startsWith('<>',i)){tokens.push('<>');i+=2;continue;}
  if(source[i]==='"'){
   let j=i+1,escaped=false,closed=false;
   for(;j<source.length;j++){
    const c=source[j];
    if(!escaped&&c==='"'){closed=true;j++;break;}
    if(!escaped&&c==='\\'){escaped=true;continue;}
    escaped=false;
   }
   if(!closed)fail();tokens.push(source.slice(i,j));i=j;continue;
  }
  let j=i;
  while(j<source.length&&!/\s/.test(source[j])&&!'(){}[]'.includes(source[j])){
   if(source[j]==='\\'&&j+1<source.length)j+=2;else j++;
  }
  if(j===i)fail();tokens.push(source.slice(i,j));i=j;
  if(tokens.length>4096)fail();
 }
 if(tokens.length<5)fail();return tokens;
}

// Fields are consumed in exact PG17 order; unknown/missing/extra attributes stop.
export function decodePg17Conbin(source){
 const tokens=tokenize(source);let at=0,count=0;
 const next=()=>tokens[at++];
 const expect=x=>{if(next()!==x)fail();};
 const atom=()=>{const x=next();if(!scalar(x)||'{}()[]'.includes(x)||x.startsWith(':'))fail();return x;};
 function tree(depth){
  if(depth>12||++count>64)fail();
  expect('{');const tag=next();if(!Object.hasOwn(FIELDS,tag))fail();
  const fields=Object.create(null);
  for(const key of FIELDS[tag]){
   expect(':'+key);
   if(key==='args'){
    expect('(');const args=[];
    while(tokens[at]!==')'){
     if(at>=tokens.length||args.length>=8)fail();
     args.push(tree(depth+1));
    }
    expect(')');fields[key]=args;
   }else if(key==='varnullingrels'){
    // Restrict this first revision to an empty bitmap set. No outer-join Vars.
    expect('(');expect('b');expect(')');fields[key]=[];
   }else if(key==='constvalue'){
    if(tokens[at]==='<>'){fields[key]={nullMarker:next()};continue;}
    const declared=atom();if(!checkInt(declared,0,8192))fail();
    expect('[');const bytes=[];
    while(tokens[at]!==']'){
     if(at>=tokens.length||bytes.length>8192)fail();
     const x=atom();if(!checkInt(x,-128,255))fail();bytes.push(Number(x));
    }
    // outDatum writes the logical prefix, but sizeof(Datum) physical bytes
    // for by-value data. V2 supports only the unverified 64-bit assumption.
    const logicalLength=Number(declared);
    if(fields.constbyval==='true'&&(![1,2,4,8].includes(Number(fields.constlen))||
       logicalLength!==Number(fields.constlen)))fail();
    const physicalLength=fields.constbyval==='true'?PG17_ASSUMED_DATUM_BYTES:logicalLength;
    expect(']');if(bytes.length!==physicalLength)fail();fields[key]={length:logicalLength,bytes};
   }else fields[key]=atom();
  }
  expect('}');
  // Reject unrecognized and unsupported semantic states rather than guessing.
  if(!checkInt(fields.location,-1,2147483647)||fields.location!=='-1')fail();
  if(tag==='BOOLEXPR'&&(fields.boolop!=='and'||fields.args.length<2||fields.args.length>3))fail();
  if(tag==='OPEXPR'){
   if(fields.args.length!==2||!checkInt(fields.opno,1)||!checkInt(fields.opfuncid,0)||
      !checkInt(fields.opresulttype,1)||!checkInt(fields.opcollid,0)||!checkInt(fields.inputcollid,0)||fields.opretset!=='false')fail();
  }
  if(tag==='FUNCEXPR'){
   if(fields.args.length!==1||!checkInt(fields.funcid,1)||!checkInt(fields.funcresulttype,1)||
      fields.funcformat!=='0'|| // COERCE_EXPLICIT_CALL only: casts/unknown forms stop.
      !checkInt(fields.funccollid,0)||!checkInt(fields.inputcollid,0)||
      fields.funcretset!=='false'||fields.funcvariadic!=='false')fail();
  }
  if(tag==='VAR'){
   if(!checkInt(fields.varno,1)||!checkInt(fields.varattno,1)||!checkInt(fields.vartype,1)||
      !checkInt(fields.vartypmod)||!checkInt(fields.varcollid,0)||fields.varlevelsup!=='0'||
      fields.varnosyn!==fields.varno||fields.varattnosyn!==fields.varattno)fail();
  }
  if(tag==='CONST'){
   if(!checkInt(fields.consttype,1)||!checkInt(fields.consttypmod)||!checkInt(fields.constcollid,0)||
      !checkInt(fields.constlen)||!['true','false'].includes(fields.constbyval)||
      !['true','false'].includes(fields.constisnull)||
      (fields.constisnull==='true')!==(Object.hasOwn(fields.constvalue,'nullMarker')))fail();
  }
  return {tag,fields};
 }
 const root=tree(0);
 if(at!==tokens.length)fail();
 return root;
}

function orderedAtoms(root){
 if(root?.tag!=='BOOLEXPR'||root.fields.boolop!=='and')fail();
 const args=root.fields.args;
 if(args.length===2&&args[0]?.tag==='BOOLEXPR'&&args[0].fields.boolop==='and'&&args[0].fields.args.length===2)
  return {form:'NESTED',atoms:[...args[0].fields.args,args[1]],paths:['0.0','0.1','1']};
 if(args.length===3&&args.every(x=>x.tag==='OPEXPR'))
  return {form:'FLAT',atoms:args,paths:['0','1','2']};
 fail();
}
function inspectAtom(atom,path){
 if(atom.tag!=='OPEXPR'||atom.fields.args.length!==2)fail();
 const [left,right]=atom.fields.args;
 if(!['FUNCEXPR','VAR'].includes(left.tag)||right.tag!=='CONST')fail();
 if(left.tag==='FUNCEXPR'&&(left.fields.args.length!==1||left.fields.args[0].tag!=='VAR'))fail();
 const variable=left.tag==='VAR'?left:left.fields.args[0];
 const records=[{path,tag:atom.tag,fields:atom.fields},
  {path:path+'.0',tag:left.tag,fields:left.fields},
  {path:path+'.1',tag:right.tag,fields:right.fields}];
 if(left.tag==='FUNCEXPR') records.push({path:path+'.0.0',tag:variable.tag,fields:variable.fields});
 const refs=[];
 for(const r of records){
  for(const [field,kind] of Object.entries({opno:'operator',opfuncid:'function',funcid:'function',
    vartype:'type',varcollid:'collation',consttype:'type',constcollid:'collation',
    opresulttype:'type',funcresulttype:'type',opcollid:'collation',funccollid:'collation',inputcollid:'collation'})){
   const id=r.fields[field];if(id!==undefined)refs.push({path:r.path,field,kind,oid:id});
  }
 }
 // Position is part of each record's identity: never DISTINCT, sort or fold.
 return {
  path,rawDigest:sha(atom),references:refs,
  varBinding:{path:left.tag==='VAR'?path+'.0':path+'.0.0',
   varno:variable.fields.varno,varattno:variable.fields.varattno,
   varnosyn:variable.fields.varnosyn,varattnosyn:variable.fields.varattnosyn,
   varlevelsup:variable.fields.varlevelsup,
   vartypeOid:variable.fields.vartype,vartypmod:variable.fields.vartypmod,
   varcollidOid:variable.fields.varcollid,nullingRelations:variable.fields.varnullingrels},
  constant:{path:path+'.1',typeOid:right.fields.consttype,typmod:right.fields.consttypmod,
   collationOid:right.fields.constcollid,length:right.fields.constlen,
   byValue:right.fields.constbyval,isNull:right.fields.constisnull,
   completeRawValueSha256:sha(right.fields.constvalue)}
 };
}

export function inspectPg17SlugCandidate(source,restored){
 const a=orderedAtoms(decodePg17Conbin(source));
 const b=orderedAtoms(decodePg17Conbin(restored));
 if(a.form!=='NESTED'||b.form!=='FLAT')fail();
 // Structure may be recognized, but no native resolver has been accepted.
 const sourceAtoms=a.atoms.map((atom,i)=>inspectAtom(atom,a.paths[i]));
 const restoredAtoms=b.atoms.map((atom,i)=>inspectAtom(atom,b.paths[i]));
 if(a.atoms[0].fields.args[0].tag!=='FUNCEXPR'||a.atoms[1].fields.args[0].tag!=='FUNCEXPR'||
    a.atoms[2].fields.args[0].tag!=='VAR')fail();
 if(b.atoms[0].fields.args[0].tag!=='FUNCEXPR'||b.atoms[1].fields.args[0].tag!=='FUNCEXPR'||
    b.atoms[2].fields.args[0].tag!=='VAR')fail();
 return Object.freeze({revision:PR39_CONBIN_EXTRACTOR_REVISION,assumedDatumBytes:PG17_ASSUMED_DATUM_BYTES,
  architectureValidated:false,decision:'BLOCKED',
  nativeValidated:false,semanticEquivalence:'NOT_VERIFIED',allowCatalogPass:false,
  provenance:'OFFLINE_UNTRUSTED_NODE_TEXT',
  shape:'AND(AND(L,U),R)->AND(L,U,R)',
  source:{digest:sha(a.atoms.map(x=>x)),positions:sourceAtoms},
  restored:{digest:sha(b.atoms.map(x=>x)),positions:restoredAtoms},
  reason:'A pg_node_tree text decoder is not a trusted PG17 build-pinned extractor or a positional OID resolver.'});
}
