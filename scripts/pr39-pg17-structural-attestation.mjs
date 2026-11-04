// PR39: OFFLINE, evidence-pinned, constraint-specific structural observation.
// NEVER import into a restore runner or a canonical catalog equality gate.
// No Docker, SQL, network, provider access, or waiver authority.
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,openSync,readSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPg17SlugCandidate} from './pr39-pg17-conbin-extractor.mjs';

export const PR39_ATTESTATION_REVISION='PR39_PG17_SLUG_REGROUPING_EVIDENCE_V1';
export const PR39_PINNED_EVIDENCE_SHA256='d968dfee0b0e3b09ff70ede2776b8c97a309392487db1586904a53034cefd179';
const PIN=Object.freeze({
 build:'fce88ebd2be240d8660dbc76c1c2749a73fc5e7c16ccf97011b1ab1869ec1000',
 sourceConbin:'9530f7733ec37c10d6d797ae1e3089615da4ca3d7f2ebfae129e1291e806b459',
 restoredConbin:'7206d6ec10bbcf64169762141521d45dfe0cfd6af57e9a712911f442881c0810',
 sourceBindings:'bc85021a7e4b19920050acdf9ab82678299c8e6ad5f5eabf12b02591ad5797d1',
 restoredBindings:'8f3a2ad3dca9b4a2dec7ef20d850cf02fb135359637f3b063d3d818715c1fef8'
});
const SHA=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('PR39 ATTESTATION STOP: incomplete or modified pinned synthetic native evidence');};
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function checkedJson(root){
 let count=0;const seen=new Set();
 function visit(x,depth){
  if(++count>15000||depth>32)fail();
  if(x===null||typeof x==='boolean')return;
  if(typeof x==='number'){if(!Number.isSafeInteger(x)||Object.is(x,-0))fail();return;}
  if(typeof x==='string'){if(x.length>70000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x))fail();return;}
  if(typeof x!=='object'||seen.has(x)||Object.getPrototypeOf(x)!==(Array.isArray(x)?Array.prototype:Object.prototype))fail();
  const props=Reflect.ownKeys(x);const keys=Object.keys(x);
  if((Array.isArray(x)&&keys.length!==x.length)||props.some(k=>typeof k!=='string'||(k!=='length'||!Array.isArray(x))&&(!Object.getOwnPropertyDescriptor(x,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'))))fail();
  seen.add(x);for(const v of Object.values(x))visit(v,depth+1);seen.delete(x);
 }
 visit(root,0);
}
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':plain(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>sha(stable(x));
const SIDE_FIELDS=['server_version_num','database_name','constraint_oid','raw_conbin','constraint_kind','validated','no_inherit','is_local','inherit_count','slug_attribute_num','slug_type_oid','slug_type_modifier','slug_collation_oid','raw_conbin_sha256','positionalBindings'];
const BUILD_FIELDS=['imageId','arch','datumAssumptionBytes','longBits','pgConfigVersion','pgConfigSha256','postgresBinarySha256'];
const ROOT_FIELDS=['scope','decision','semanticEquivalence','nativeValidated','allowCatalogPass','sourceBuild','restoredBuild','source','restored','positionalStatus'];
const IDENTITY_FIELDS={
 type:['oid','kind','name','align','byval','length','schema','storage','collation'],
 operator:['oid','left','name','right','result','schema','implementation'],
 function:['oid','name','result','schema','parallel','arguments','volatility','implementationSha256'],
 collation:['oid','name','schema','version','encoding','provider','deterministic']
};
const EXPECTED_OPS=Object.freeze([
 {op:'525',impl:'150',name:'>=',left:'23',right:'23',kind:'FUNCEXPR',constant:'23'},
 {op:'523',impl:'149',name:'<=',left:'23',right:'23',kind:'FUNCEXPR',constant:'23'},
 {op:'641',impl:'1254',name:'~',left:'25',right:'25',kind:'VAR',constant:'25'}
]);
const expectedPaths={source:['0.0','0.1','1'],restored:['0','1','2']};
function checkBuild(e){
 for(const b of [e.sourceBuild,e.restoredBuild]){
  if(!exact(b,BUILD_FIELDS)||b.arch!=='x86_64'||b.longBits!==64||b.datumAssumptionBytes!==8||
     b.pgConfigVersion!=='PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)'||
     !/^sha256:[a-f0-9]{64}$/.test(b.imageId)||
     !SHA.test(b.pgConfigSha256)||!SHA.test(b.postgresBinarySha256)||
     digest(b)!==PIN.build)fail();
 }
 if(stable(e.sourceBuild)!==stable(e.restoredBuild))fail();
}
function checkSide(side,which,parsed){
 if(!exact(side,SIDE_FIELDS)||side.server_version_num!==170011||side.database_name!=='postgres'||
    side.constraint_kind!=='c'||side.validated!==true||side.no_inherit!==false||
    side.is_local!==true||side.inherit_count!==0||side.slug_attribute_num!==3||
    side.slug_type_oid!=='25'||side.slug_type_modifier!==-1||side.slug_collation_oid!=='100'||
    side.constraint_oid!==(which==='source'?'16429':'16714')||
    typeof side.raw_conbin!=='string'||side.raw_conbin.length>65536||
    !SHA.test(side.raw_conbin_sha256)||
    sha(side.raw_conbin)!==side.raw_conbin_sha256||
    side.raw_conbin_sha256!==PIN[which==='source'?'sourceConbin':'restoredConbin']||
    !Array.isArray(side.positionalBindings)||side.positionalBindings.length!==35||
    digest(side.positionalBindings)!==PIN[which==='source'?'sourceBindings':'restoredBindings'])fail();
 const expected=parsed.positions.flatMap(p=>p.references);
 if(parsed.positions.length!==3||parsed.positions.some((p,i)=>p.path!==expectedPaths[which][i]||p.references.length!==(i<2?13:9))||expected.length!==35)fail();
 const known=new Map();
 for(let i=0;i<35;i++){
  const ref=expected[i],row=side.positionalBindings[i];
  if(!exact(row,['ordinal','path','field','kind','oid','identity'])||
     row.ordinal!==i||row.path!==ref.path||row.field!==ref.field||row.kind!==ref.kind||row.oid!==ref.oid||
     !Object.hasOwn(IDENTITY_FIELDS,row.kind))fail();
  const identity=row.identity;
  if(row.oid==='0'){
   if(row.kind!=='collation'||!exact(identity,['zeroOid'])||identity.zeroOid!==true)fail();
  }else{
   if(!exact(identity,IDENTITY_FIELDS[row.kind])||identity.oid!==row.oid||identity.schema!=='pg_catalog')fail();
   const key=row.kind+'\0'+row.oid;
   if(known.has(key)&&stable(known.get(key))!==stable(identity))fail();
   known.set(key,identity);
  }
 }
 const lookup=(i,field)=>{
  const base=parsed.positions[i].path;
  const r=side.positionalBindings.find(x=>x.path===base&&x.field===field);
  if(!r)fail();return r;
 };
 for(let i=0;i<3;i++){
  const item=EXPECTED_OPS[i],pos=parsed.positions[i];
  const op=lookup(i,'opno'),fn=lookup(i,'opfuncid');
  if(op.oid!==item.op||fn.oid!==item.impl||op.identity.name!==item.name||
     op.identity.left!==item.left||op.identity.right!==item.right||op.identity.result!=='16'||
     op.identity.implementation!==fn.identity.name||fn.identity.result!=='16'||
     fn.identity.arguments!==[item.left,item.right].join(' ')||
     pos.varBinding.varno!=='1'||pos.varBinding.varattno!=='3'||
     pos.varBinding.varnosyn!=='1'||pos.varBinding.varattnosyn!=='3'||
     pos.varBinding.vartypeOid!=='25'||pos.varBinding.varcollidOid!=='100'||
     pos.varBinding.vartypmod!=='-1'||pos.varBinding.varlevelsup!=='0'||
     pos.varBinding.nullingRelations.length!==0||
     pos.constant.typeOid!==item.constant||pos.constant.typmod!=='-1'||
     pos.constant.collationOid!==(i===2?'100':'0')||pos.constant.isNull!=='false'||
     pos.constant.byValue!==(i===2?'false':'true')||
     pos.constant.length!==(i===2?'-1':'4'))fail();
 }
 // Positional aliases for this exact fixture, not arbitrary PG17 objects.
 for(const [oid,name] of [['16','bool'],['23','int4'],['25','text']]){
  const type=known.get('type\0'+oid);if(!type||type.name!==name)fail();
 }
 const length=known.get('function\0'+'1317');
 if(!length||length.name!=='length'||length.arguments!=='25'||length.result!=='23')fail();
 return {rows:side.positionalBindings,positions:parsed.positions};
}
export function inspectPr39PinnedRegrouping(report){
 checkedJson(report);
 if(!exact(report,ROOT_FIELDS)||report.scope!=='LOCAL_SYNTHETIC_ONLY'||
    report.decision!=='BLOCKED'||report.semanticEquivalence!=='NOT_VERIFIED'||
    report.nativeValidated!==false||report.allowCatalogPass!==false||
    report.positionalStatus!=='CAPTURED_FOR_REVIEW_NOT_EQUIVALENCE')fail();
 checkBuild(report);
 const candidate=inspectPg17SlugCandidate(report.source?.raw_conbin,report.restored?.raw_conbin);
 if(candidate.decision!=='BLOCKED'||candidate.nativeValidated!==false||
    candidate.allowCatalogPass!==false||candidate.semanticEquivalence!=='NOT_VERIFIED'||
    candidate.shape!=='AND(AND(L,U),R)->AND(L,U,R)'||candidate.assumedDatumBytes!==8)fail();
 const source=checkSide(report.source,'source',candidate.source);
 const restored=checkSide(report.restored,'restored',candidate.restored);
 for(let i=0;i<3;i++){
  if(source.positions[i].rawDigest!==restored.positions[i].rawDigest||
     source.positions[i].constant.completeRawValueSha256!==restored.positions[i].constant.completeRawValueSha256)fail();
 }
 for(let i=0;i<35;i++){
  const a=source.rows[i],b=restored.rows[i];
  if(a.ordinal!==b.ordinal||a.kind!==b.kind||a.field!==b.field||a.oid!==b.oid||
     stable(a.identity)!==stable(b.identity))fail();
  const j=i<13?0:i<26?1:2;
  const aPrefix=expectedPaths.source[j],bPrefix=expectedPaths.restored[j];
  if(!(a.path===aPrefix||a.path.startsWith(aPrefix+'.'))||
     !(b.path===bPrefix||b.path.startsWith(bPrefix+'.'))||
     a.path.slice(aPrefix.length)!==b.path.slice(bPrefix.length))fail();
 }
 return Object.freeze({revision:PR39_ATTESTATION_REVISION,
  structuralObservation:'PINNED_3_OPERANDS_IDENTICAL_WITH_AND_REGROUPING',
  comparedOccurrences:35,identicalOperandSubtrees:3,
  sourceConbinSha256:PIN.sourceConbin,restoredConbinSha256:PIN.restoredConbin,
  decision:'BLOCKED',semanticEquivalence:'NOT_VERIFIED',nativeValidated:false,
  architectureValidated:false,allowCatalogPass:false,
  provenance:'USER_SUPPLIED_SYNTHETIC_CAPTURE_NOT_ATTESTED_BY_POSTGRES_SERVER',
  warning:'No waiver, no restore approval, no hosted migration or native semantic verification.'});
}
export function inspectPr39PinnedEvidenceBytes(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>150000||
    createHash('sha256').update(bytes).digest('hex')!==PR39_PINNED_EVIDENCE_SHA256)fail();
 let object;try{object=JSON.parse(bytes.toString('utf8'))}catch{fail()}
 return inspectPr39PinnedRegrouping(object);
}
// Read no more than MAX_BYTES + 1 from an ordinary file. A path check alone
// is insufficient (it may change before open), so check the opened descriptor
// too. Never use readFileSync on an untrusted CLI/environment path.
const MAX_BYTES=150000;
export function readPr39BoundedEvidenceFile(path){
 if(typeof path!=='string'||!path.length)fail();
 const full=resolve(path);
 const before=lstatSync(full);
 if(!before.isFile()||before.size<1||before.size>MAX_BYTES)fail();
 // O_NONBLOCK avoids FIFO open hangs if a path was swapped on POSIX;
 // O_NOFOLLOW prevents symlink redirects after lstat when supported.
 const flags=constants.O_RDONLY|(process.platform==='win32'?0:
  ((constants.O_NONBLOCK??0)|(constants.O_NOFOLLOW??0)));
 const fd=openSync(full,flags);
 try{
  const opened=fstatSync(fd);
  if(!opened.isFile()||opened.size<1||opened.size>MAX_BYTES)fail();
  const bytes=Buffer.alloc(MAX_BYTES+1);let offset=0;
  while(offset<bytes.length){
   const n=readSync(fd,bytes,offset,bytes.length-offset,null);
   if(n===0)break;
   offset+=n;
  }
  if(offset<1||offset>MAX_BYTES)fail();
  return bytes.subarray(0,offset);
 }finally{closeSync(fd)}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--evidence')fail();
  const result=inspectPr39PinnedEvidenceBytes(readPr39BoundedEvidenceFile(process.argv[3]));
  console.log('PR39 STRUCTURAL OBSERVATION: '+result.structuralObservation);
  console.log('PR39 OID OCCURRENCES: '+result.comparedOccurrences+'; matched atom subtrees: '+result.identicalOperandSubtrees);
  console.log('PR39 DECISION: BLOCKED / NOT_VERIFIED; allowCatalogPass=false; NO_GO_HOSTED_MIGRATION');
 }catch(error){console.error(String(error));process.exitCode=1;}
}