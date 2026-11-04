// PR39: offline verifier for synthetic OID binding captures, by occurrence.
// No postgres, Docker, SQL execution, equivalence or catalog PASS authority.
import {createHash} from 'node:crypto';

export const PR39_OID_BINDING_REVISION='PR39_PG17_POSITIONAL_OID_BINDINGS_V3';
export const PR39_CAPTURE_REQUIREMENTS=Object.freeze({
 major:17,expectedDatumBytes:8,provenance:'SYNTHETIC_OFFLINE',
 status:'NOT_NATIVE_VERIFIED'
});
const STOP='PR39 STOP: untrusted or incomplete positional OID binding evidence';
const fail=()=>{throw Error(STOP);};
const OID=/^(?:0|[1-9][0-9]{0,9})$/;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
// PostgreSQL 17 SQL lexer allows operator punctuation, not ordinary identifiers.
// This remains a closed CHECK-specific verifier; operator names are validated
// lexically here and checked against the exact expected position later.
const PG_OPERATOR=/^[+*\\/<>\-=~!@#%^&|`?]{1,63}$/;
const validOperatorName=name=>typeof name==='string'&&PG_OPERATOR.test(name)&&
 !name.includes('--')&&!name.includes('/*')&&
 (name.length===1||!/[+-]$/.test(name)||/[~!@#%^&|`?]/.test(name));
const string=x=>typeof x==='string'&&x.length>0&&x.length<1024&&![...x].some(c=>c.charCodeAt(0)<32);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(o,keys)=>object(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const validOid=x=>typeof x==='string'&&OID.test(x)&&Number(x)<=4294967295;
const digits=x=>Number.isSafeInteger(x)&&x>=0;
const hash=x=>createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');
const IDENTITY_KEYS=Object.freeze({
 type:['schema','name','kind','category','length','byValue','alignment','storage','defined','elementType','defaultCollation'],
 operator:['schema','name','kind','leftType','rightType','resultType','procedure','canMerge','canHash'],
 function:['schema','name','arguments','resultType','language','volatility','parallel','strict','leakproof','securityDefiner','implementationSha256'],
 collation:['schema','name','provider','deterministic','encoding','collate','ctype','locale','rules','version']
});
const ZERO=Object.freeze({zeroOid:true});
function validateIdentity(kind,oid,value){
 if(oid==='0'){
  if(!['collation','function'].includes(kind)||!exact(value,['zeroOid'])||value.zeroOid!==true)fail();
  return;
 }
 if(!Object.hasOwn(IDENTITY_KEYS,kind)||!exact(value,IDENTITY_KEYS[kind])||
    !ID.test(value.schema)||!(kind==='operator'?validOperatorName(value.name):ID.test(value.name)))fail();
 if(kind==='type'){
  if(!['b','c','d','e','p','r','m'].includes(value.kind)||!ID.test(value.category)||
      !Number.isInteger(value.length)||value.length< -1||value.length>1024*1024||
      typeof value.byValue!=='boolean'||!['c','s','i','d'].includes(value.alignment)||
      !['p','e','m','x'].includes(value.storage)||typeof value.defined!=='boolean'||
      !string(value.elementType)||!string(value.defaultCollation))fail();
 } else if(kind==='operator'){
  if(!['b','l'].includes(value.kind)||
     !['leftType','rightType','resultType','procedure'].every(k=>string(value[k]))||
     typeof value.canMerge!=='boolean'||typeof value.canHash!=='boolean')fail();
 } else if(kind==='function'){
  if(!['arguments','resultType','language'].every(k=>string(value[k]))||
     !['i','s','v'].includes(value.volatility)||!['s','r','u'].includes(value.parallel)||
     !['strict','leakproof','securityDefiner'].every(k=>typeof value[k]==='boolean')||
     !SHA.test(value.implementationSha256))fail();
 } else if(kind==='collation'){
  if(!['d','b','c','i'].includes(value.provider)||typeof value.deterministic!=='boolean'||
     !Number.isInteger(value.encoding)||value.encoding< -1||value.encoding>10000||
     !['collate','ctype','locale','rules','version'].every(k=>value[k]===null||string(value[k])))fail();
 }
}
const BUILD_KEYS=['serverVersionNum','imageDigest','imagePlatform','pgConfigSha256','postgresBinarySha256',
 'datumBytes','databaseEncoding','databaseCollationSha256'];
function validateBuild(b){
 if(!exact(b,BUILD_KEYS)||!Number.isSafeInteger(b.serverVersionNum)||
    Math.floor(b.serverVersionNum/10000)!==17||
    typeof b.imageDigest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(b.imageDigest)||
    !['linux/amd64','linux/arm64'].includes(b.imagePlatform)||
    !SHA.test(b.pgConfigSha256)||!SHA.test(b.postgresBinarySha256)||
    b.datumBytes!==8||!ID.test(b.databaseEncoding)||!SHA.test(b.databaseCollationSha256))fail();
}
function validateCatalog(c, expectedRefs, expectedSide){
 if(!exact(c,['provenance','side','build','rows'])||c.provenance!=='SYNTHETIC_OFFLINE'||
    c.side!==expectedSide||!Array.isArray(c.rows)||c.rows.length!==expectedRefs.length||
    c.rows.length>256)fail();
 validateBuild(c.build);
 const occurrences=new Set();
 const identitiesByLocalOid=new Map();
 for(let i=0;i<c.rows.length;i++){
  const row=c.rows[i],ref=expectedRefs[i];
  if(!exact(row,['ordinal','path','field','kind','oid','identity'])||row.ordinal!==i||
     !string(row.path)||!ID.test(row.field)||!Object.hasOwn(IDENTITY_KEYS,row.kind)||
     !validOid(row.oid)||row.path!==ref.path||row.field!==ref.field||
     row.kind!==ref.kind||row.oid!==ref.oid)fail();
  const key=row.path+'\0'+row.field;
  if(occurrences.has(key))fail();
  occurrences.add(key);
  validateIdentity(row.kind,row.oid,row.identity);
  // A local catalog cannot assign two identities to one (class, OID).
  // Keep every occurrence; this is a consistency check, not a deduplication.
  const localKey=row.kind+'\0'+row.oid;
  const signature=JSON.stringify(row.identity);
  if(identitiesByLocalOid.has(localKey)&&identitiesByLocalOid.get(localKey)!==signature)fail();
  identitiesByLocalOid.set(localKey,signature);
 }
}
// V2 admits exactly the ordered fields emitted by inspectAtom in the V2
// closed-grammar extractor. Neither the candidate nor a catalog can invent
// required slots by altering both sides in tandem.
const OPERATOR_SLOTS=Object.freeze([
 ['','opno','operator'],['','opfuncid','function'],['','opresulttype','type'],
 ['','opcollid','collation'],['','inputcollid','collation']
]);
const FUNCTION_SLOTS=Object.freeze([
 ['.0','funcid','function'],['.0','funcresulttype','type'],
 ['.0','funccollid','collation'],['.0','inputcollid','collation']
]);
const VARIABLE_SLOTS=Object.freeze([['.0.0','vartype','type'],['.0.0','varcollid','collation']]);
const DIRECT_VARIABLE_SLOTS=Object.freeze([['.0','vartype','type'],['.0','varcollid','collation']]);
const CONSTANT_SLOTS=Object.freeze([['.1','consttype','type'],['.1','constcollid','collation']]);
const POSITIVE_DECIMAL=/^(?:0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL=/^(?:0|-?[1-9][0-9]*)$/;
// Optional OID slots are explicitly named. Class alone does not make OID 0 valid.
const ZERO_REFERENCE_FIELDS=new Set(['opfuncid','opcollid','inputcollid','funccollid','varcollid','constcollid']);
const digitsText=x=>typeof x==='string'&&SIGNED_DECIMAL.test(x)&&Number.isSafeInteger(Number(x));
function expectedReferences(side,kind){
 const paths=kind==='source'?['0.0','0.1','1']:['0','1','2'];
 if(!exact(side,['digest','positions'])||!SHA.test(side.digest)||
    !Array.isArray(side.positions)||side.positions.length!==3)fail();
 const references=[];
 for(let i=0;i<3;i++){
  const atom=side.positions[i],path=paths[i],hasFunction=i<2;
  if(!exact(atom,['path','rawDigest','references','varBinding','constant'])||
     atom.path!==path||!SHA.test(atom.rawDigest)||
     !Array.isArray(atom.references)||
     !exact(atom.varBinding,['path','varno','varattno','varnosyn','varattnosyn',
       'varlevelsup','vartypeOid','vartypmod','varcollidOid','nullingRelations'])||
     !exact(atom.constant,['path','typeOid','typmod','collationOid','length',
       'byValue','isNull','completeRawValueSha256']))fail();
  const variable=atom.varBinding,constant=atom.constant;
  const varPath=path+(hasFunction?'.0.0':'.0');
  if(variable.path!==varPath||constant.path!==path+'.1'||
     ![variable.varno,variable.varattno,variable.varnosyn,variable.varattnosyn]
       .every(x=>typeof x==='string'&&POSITIVE_DECIMAL.test(x)&&Number(x)>0)||
     variable.varlevelsup!=='0'||variable.varnosyn!==variable.varno||
     variable.varattnosyn!==variable.varattno||!digitsText(variable.vartypmod)||
     !Array.isArray(variable.nullingRelations)||variable.nullingRelations.length!==0||
     !validOid(variable.vartypeOid)||variable.vartypeOid==='0'||
     !validOid(variable.varcollidOid)||
     !digitsText(constant.typmod)||!digitsText(String(constant.length))||
     !['true','false'].includes(constant.byValue)||
     !['true','false'].includes(constant.isNull)||
     !validOid(constant.typeOid)||constant.typeOid==='0'||
     !validOid(constant.collationOid)||!SHA.test(constant.completeRawValueSha256))fail();
  const slots=[...OPERATOR_SLOTS,
    ...(hasFunction?FUNCTION_SLOTS:[]),
    ...(hasFunction?[]:DIRECT_VARIABLE_SLOTS),
    ...CONSTANT_SLOTS,
    ...(hasFunction?VARIABLE_SLOTS:[])];
  if(atom.references.length!==slots.length)fail();
  const byField=new Map();
  for(let k=0;k<slots.length;k++){
   const ref=atom.references[k],[suffix,field,refKind]=slots[k];
   if(!exact(ref,['path','field','kind','oid'])||
      ref.path!==path+suffix||ref.field!==field||ref.kind!==refKind||
      !validOid(ref.oid)||(ref.oid==='0'&&!ZERO_REFERENCE_FIELDS.has(ref.field)))fail();
   byField.set(ref.path+'\0'+ref.field,ref.oid);
   references.push(ref);
  }
  if(byField.get(variable.path+'\0vartype')!==variable.vartypeOid||
     byField.get(variable.path+'\0varcollid')!==variable.varcollidOid||
     byField.get(constant.path+'\0consttype')!==constant.typeOid||
     byField.get(constant.path+'\0constcollid')!==constant.collationOid)fail();
 }
 return references;
}
// Synthetic catalog consistency: verify the declared objects actually link
// to the same typed operator/function/argument/result signatures per atom.
// A matching name on both sides is not proof of a valid local catalog.
function validateTypedCatalogLinks(side,catalog){
 const records=new Map(catalog.rows.map(r=>[r.path+'\0'+r.field,r]));
 const get=(path,field,kind)=>{
  const row=records.get(path+'\0'+field);
  if(!row||row.kind!==kind)fail();
  return row;
 };
 const qualifiedType=(row)=>{
  if(row.oid==='0'||row.kind!=='type')fail();
  return row.identity.schema+'.'+row.identity.name;
 };
 const procSignature=(row)=>{
  if(row.oid==='0'||row.kind!=='function')fail();
  return row.identity.schema+'.'+row.identity.name+'('+row.identity.arguments+')';
 };
 for(let i=0;i<side.positions.length;i++){
  const atom=side.positions[i],path=atom.path;
  const op=get(path,'opno','operator');
  // Exactly the three operators of the observed slug CHECK, not arbitrary
  // lexically valid operators (and never a SQL-string rewrite).
  if(op.identity.name!==['>=','<=','~'][i])fail();
  const implementer=get(path,'opfuncid','function');
  const result=qualifiedType(get(path,'opresulttype','type'));
  const rhs=qualifiedType(get(path+'.1','consttype','type'));
  let lhs;
  if(i<2){
   const fn=get(path+'.0','funcid','function');
   const fnResult=qualifiedType(get(path+'.0','funcresulttype','type'));
   const arg=qualifiedType(get(path+'.0.0','vartype','type'));
   if(fn.oid==='0'||fn.identity.arguments!==arg||fn.identity.resultType!==fnResult)fail();
   lhs=fnResult;
  }else lhs=qualifiedType(get(path+'.0','vartype','type'));
  if(implementer.oid==='0'||op.identity.leftType!==lhs||
     op.identity.rightType!==rhs||op.identity.resultType!==result||
     op.identity.procedure!==procSignature(implementer)||
     implementer.identity.arguments!==lhs+','+rhs||
     implementer.identity.resultType!==result)fail();
  const typeRow=get(path+'.1','consttype','type');
  const constant=atom.constant;
  if((constant.byValue==='true')!==typeRow.identity.byValue)fail();
  if(typeRow.identity.byValue&&Number(constant.length)!==typeRow.identity.length)fail();
 }
}
function relativePaths(side,catalog){
 const result=[];
 for(let i=0;i<3;i++){
  const atom=side.positions[i];
  const rows=catalog.rows.filter(r=>r.path===atom.path||r.path.startsWith(atom.path+'.'));
  const varRef=atom.varBinding;
  const constant=atom.constant;
  result.push({
   varno:varRef.varno, varattno:varRef.varattno,
   varnosyn:varRef.varnosyn,varattnosyn:varRef.varattnosyn,
   varlevelsup:varRef.varlevelsup, vartypmod:varRef.vartypmod,
   nullingRelations:varRef.nullingRelations,
   constant:{length:constant.length,typmod:constant.typmod,
    byValue:constant.byValue,isNull:constant.isNull,
    rawSha256:constant.completeRawValueSha256},
   bindings:rows.map(r=>({relativePath:r.path.slice(atom.path.length),field:r.field,
    kind:r.kind,identity:r.identity}))
  });
 }
 return result;
}
export function checkPr39OfflineOidBindings(candidate,sourceCatalog,restoredCatalog){
 if(!object(candidate)||candidate.revision!=='PG17_CLOSED_GRAMMAR_CANDIDATE_V2'||
    candidate.decision!=='BLOCKED'||candidate.nativeValidated!==false||
    candidate.architectureValidated!==false||candidate.allowCatalogPass!==false||
    candidate.semanticEquivalence!=='NOT_VERIFIED'||candidate.assumedDatumBytes!==8||
    !object(candidate.source)||!object(candidate.restored))fail();
 const left=expectedReferences(candidate.source,'source'),right=expectedReferences(candidate.restored,'restored');
 validateCatalog(sourceCatalog,left,'source');
 validateCatalog(restoredCatalog,right,'restored');
 validateTypedCatalogLinks(candidate.source,sourceCatalog);
 validateTypedCatalogLinks(candidate.restored,restoredCatalog);
 if(JSON.stringify(sourceCatalog.build)!==JSON.stringify(restoredCatalog.build))fail();
 const source=relativePaths(candidate.source,sourceCatalog);
 const restored=relativePaths(candidate.restored,restoredCatalog);
 // Per-atom ordinal/relative path and typed identity must match, including duplicates.
 // Source and restore OID *numbers* are intentionally not compared.
 if(JSON.stringify(source)!==JSON.stringify(restored))fail();
 return Object.freeze({revision:PR39_OID_BINDING_REVISION,decision:'BLOCKED',
  provenance:'SYNTHETIC_OFFLINE_ONLY',nativeValidated:false,
  architectureValidated:false,semanticEquivalence:'NOT_VERIFIED',
  allowCatalogPass:false,assumedDatumBytes:8,
  comparedOccurrences:left.length,structuralBindingDigest:hash(source),
  reason:'Synthetic per-occurrence matches cannot prove native PG17 identity or implementation equivalence.'});
}
