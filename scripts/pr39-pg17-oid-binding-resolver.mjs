// PR39: offline verifier for synthetic OID binding captures, by occurrence.
// No postgres, Docker, SQL execution, equivalence or catalog PASS authority.
import {createHash} from 'node:crypto';

export const PR39_OID_BINDING_REVISION='PR39_PG17_POSITIONAL_OID_BINDINGS_V1';
export const PR39_CAPTURE_REQUIREMENTS=Object.freeze({
 major:17,expectedDatumBytes:8,provenance:'SYNTHETIC_OFFLINE',
 status:'NOT_NATIVE_VERIFIED'
});
const STOP='PR39 STOP: untrusted or incomplete positional OID binding evidence';
const fail=()=>{throw Error(STOP);};
const OID=/^(?:0|[1-9][0-9]{0,9})$/;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
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
    !ID.test(value.schema)||!ID.test(value.name))fail();
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
 }
}
function expectedReferences(side,kind){
 const paths=kind==='source'?['0.0','0.1','1']:['0','1','2'];
 if(!object(side)||!Array.isArray(side.positions)||side.positions.length!==3)fail();
 const references=[];
 for(let i=0;i<3;i++){
  const atom=side.positions[i];
  if(!object(atom)||atom.path!==paths[i]||!Array.isArray(atom.references)||
      !object(atom.constant)||!object(atom.varBinding)||!SHA.test(atom.rawDigest)||
      !SHA.test(atom.constant.completeRawValueSha256))fail();
  if(!['true','false'].includes(atom.constant.byValue)||!['true','false'].includes(atom.constant.isNull)||
      !Number.isSafeInteger(Number(atom.constant.length))||!validOid(atom.constant.typeOid))fail();
  for(const r of atom.references){
   if(!exact(r,['path','field','kind','oid'])||!string(r.path)||
       !r.path.startsWith(atom.path+'.')&&r.path!==atom.path||
       !ID.test(r.field)||!Object.hasOwn(IDENTITY_KEYS,r.kind)||!validOid(r.oid))fail();
   references.push(r);
  }
 }
 return references;
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
   constant:{length:constant.length,byValue:constant.byValue,isNull:constant.isNull,
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
