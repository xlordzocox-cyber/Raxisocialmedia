// Strictly synthetic fixture rebuilt from documented PG17 catalog-shaped data.
// The user's raw native JSON file is NOT in this repository or these fixtures.
import {strict as assert} from 'node:assert';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectPg17SlugCandidate} from './pr39-pg17-conbin-extractor.mjs';
import {inspectPr39PinnedRegrouping,inspectPr39PinnedEvidenceBytes,readPr39BoundedEvidenceFile,
 PR39_ATTESTATION_REVISION,PR39_PINNED_EVIDENCE_SHA256} from './pr39-pg17-structural-attestation.mjs';
assert.equal(process.argv.length,2,'No flags; optional PR39_NATIVE_EVIDENCE_FILE environment variable only');
const sha=s=>createHash('sha256').update(s).digest('hex');
const node=(tag,fields)=>`{${tag} ${Object.entries(fields).map(([k,v])=>`:${k} ${v}`).join(' ')}}`;
const variable=()=>node('VAR',{varno:'1',varattno:'3',vartype:'25',vartypmod:'-1',varcollid:'100',varnullingrels:'(b)',varlevelsup:'0',varnosyn:'1',varattnosyn:'3',location:'-1'});
const int=n=>node('CONST',{consttype:'23',consttypmod:'-1',constcollid:'0',constlen:'4',constbyval:'true',constisnull:'false',location:'-1',constvalue:`4 [ ${n} 0 0 0 0 0 0 0 ]`});
const regex=()=>node('CONST',{consttype:'25',consttypmod:'-1',constcollid:'100',constlen:'-1',constbyval:'false',constisnull:'false',location:'-1',constvalue:'16 [ 64 0 0 0 94 91 97 45 122 48 45 57 45 93 43 36 ]'});
const length=()=>node('FUNCEXPR',{funcid:'1317',funcresulttype:'23',funcretset:'false',funcvariadic:'false',funcformat:'0',funccollid:'0',inputcollid:'100',args:`(${variable()})`,location:'-1'});
const op=(id,impl,l,r,input='0')=>node('OPEXPR',{opno:String(id),opfuncid:String(impl),opresulttype:'16',opretset:'false',opcollid:'0',inputcollid:input,args:`(${l} ${r})`,location:'-1'});
const and=items=>node('BOOLEXPR',{boolop:'and',args:`(${items.join(' ')})`,location:'-1'});
const l=op(525,150,length(),int(2)),u=op(523,149,length(),int(64)),r=op(641,1254,variable(),regex(),'100');
const src=and([and([l,u]),r]),dst=and([l,u,r]);
const parsed=inspectPg17SlugCandidate(src,dst);
const build=()=>({imageId:'sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe',arch:'x86_64',datumAssumptionBytes:8,longBits:64,pgConfigVersion:'PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)',pgConfigSha256:'2ecf31cb26f4108bb4afb7bafcf5010060ddfb750e275a22c8fb95b162ea0ebe',postgresBinarySha256:'5fa5f4cb92953e720a6814653888183abd7988d31a505125dec3a12bd51f29be'});
const impl={
 '150':['int4ge','16','23 23','e0133fc11d6baa6c54ac97c73147ebe9af606a4c96e0126dc7bda46e4982f04c'],
 '149':['int4le','16','23 23','2e6d8ace01e1352f6d109dd1c5b9f2bba04d536eab93f685570be23807026041'],
 '1317':['length','23','25','7fa8c48959d8fea01a53e2cefb705455632f8708ff621f3f87ae9c285dd1b846'],
 '1254':['textregexeq','16','25 25','08fdca37682c2aace904d5712453abbc336d3899b260998c93cce650a5140dc9']
};
const type={
 '16':['bool','c',true,1,'p'],
 '23':['int4','i',true,4,'p'],
 '25':['text','i',false,-1,'x']
};
const operators={
 '525':['>=','23','23','int4ge'],
 '523':['<=','23','23','int4le'],
 '641':['~','25','25','textregexeq']
};
function identity(ref){
 if(ref.oid==='0')return {zeroOid:true};
 if(ref.kind==='type'){
  const v=type[ref.oid];assert.ok(v);return {oid:ref.oid,kind:'b',name:v[0],align:v[1],byval:v[2],length:v[3],schema:'pg_catalog',storage:v[4],collation:ref.oid==='25'?'100':'0'};
 }
 if(ref.kind==='operator'){
  const v=operators[ref.oid];assert.ok(v);return {oid:ref.oid,left:v[1],name:v[0],right:v[2],result:'16',schema:'pg_catalog',implementation:v[3]};
 }
 if(ref.kind==='function'){
  const v=impl[ref.oid];assert.ok(v);return {oid:ref.oid,name:v[0],result:v[1],schema:'pg_catalog',parallel:'s',arguments:v[2],volatility:'i',implementationSha256:v[3]};
 }
 if(ref.kind==='collation'&&ref.oid==='100')return {oid:'100',name:'default',schema:'pg_catalog',version:null,encoding:-1,provider:'d',deterministic:true};
 throw Error('bad fixture kind');
}
const side=(which,raw,oid)=>({server_version_num:170011,database_name:'postgres',constraint_oid:oid,raw_conbin:raw,constraint_kind:'c',validated:true,no_inherit:false,is_local:true,inherit_count:0,slug_attribute_num:3,slug_type_oid:'25',slug_type_modifier:-1,slug_collation_oid:'100',raw_conbin_sha256:sha(raw),positionalBindings:parsed[which].positions.flatMap(p=>p.references).map((ref,ordinal)=>({ordinal,...ref,identity:identity(ref)}))});
const fixture={scope:'LOCAL_SYNTHETIC_ONLY',decision:'BLOCKED',semanticEquivalence:'NOT_VERIFIED',nativeValidated:false,allowCatalogPass:false,sourceBuild:build(),restoredBuild:build(),source:side('source',src,'16429'),restored:side('restored',dst,'16714'),positionalStatus:'CAPTURED_FOR_REVIEW_NOT_EQUIVALENCE'};
const result=inspectPr39PinnedRegrouping(fixture);
assert.equal(result.revision,PR39_ATTESTATION_REVISION);
assert.equal(result.structuralObservation,'PINNED_3_OPERANDS_IDENTICAL_WITH_AND_REGROUPING');
assert.equal(result.comparedOccurrences,35);
assert.equal(result.identicalOperandSubtrees,3);
assert.equal(result.decision,'BLOCKED');
assert.equal(result.semanticEquivalence,'NOT_VERIFIED');
assert.equal(result.nativeValidated,false);
assert.equal(result.architectureValidated,false);
assert.equal(result.allowCatalogPass,false);
const clone=structuredClone;
let denied=0;
const rejected=(name,fn)=>{const copy=clone(fixture);fn(copy);assert.throws(()=>inspectPr39PinnedRegrouping(copy),/PR39 ATTESTATION STOP|PR39 STOP/,name);denied++;};
const mutations=[
 ['forged native',e=>e.nativeValidated=true],['forged approval',e=>e.allowCatalogPass=true],
 ['forged equivalent',e=>e.semanticEquivalence='VERIFIED'],['forged decision',e=>e.decision='PASS'],
 ['forged capture provenance',e=>e.scope='HOSTED'],['forged capture status',e=>e.positionalStatus='VERIFIED'],
 ['remove source',e=>delete e.source],['extra root key',e=>e.passed=true],
 ['schema source other',e=>e.source.database_name='production'],
 ['alter constraint identifier',e=>e.source.constraint_oid='16430'],
 ['alter slug attnum',e=>e.source.slug_attribute_num=9],
 ['alter slug type',e=>e.restored.slug_type_oid='23'],
 ['alter constraint validation',e=>e.restored.validated=false],
 ['alter server version',e=>e.source.server_version_num=170010],
 ['different binary',e=>e.sourceBuild.postgresBinarySha256='f'.repeat(64)],
 ['same fake binary both',e=>{e.sourceBuild.postgresBinarySha256='f'.repeat(64);e.restoredBuild.postgresBinarySha256='f'.repeat(64)}],
 ['different image both',e=>{e.sourceBuild.imageId='sha256:'+'f'.repeat(64);e.restoredBuild.imageId='sha256:'+'f'.repeat(64)}],
 ['alter pg_config both',e=>{e.sourceBuild.pgConfigSha256='f'.repeat(64);e.restoredBuild.pgConfigSha256='f'.repeat(64)}],
 ['datum forged both',e=>{e.sourceBuild.datumAssumptionBytes=4;e.restoredBuild.datumAssumptionBytes=4}],
 ['alter nested BOOL',e=>e.source.raw_conbin=e.source.raw_conbin.replace(':boolop and',':boolop or')],
 ['alter flat BOOL',e=>e.restored.raw_conbin=e.restored.raw_conbin.replace(':boolop and',':boolop or')],
 ['modify bound 2',e=>e.source.raw_conbin=e.source.raw_conbin.replace('4 [ 2 0','4 [ 3 0')],
 ['modify bound 64',e=>e.restored.raw_conbin=e.restored.raw_conbin.replace('4 [ 64 0','4 [ 63 0')],
 ['modify regex',e=>e.source.raw_conbin=e.source.raw_conbin.replace('94 91 97','94 91 98')],
 ['alter both raw and self hashes',e=>{for(const side of [e.source,e.restored]){side.raw_conbin=side.raw_conbin.replace('4 [ 2 0','4 [ 3 0');side.raw_conbin_sha256=sha(side.raw_conbin)}}],
 ['alter type identity one',e=>e.source.positionalBindings.find(x=>x.field==='vartype').identity.name='int4'],
 ['alter type identity both',e=>{for(const side of [e.source,e.restored])side.positionalBindings.find(x=>x.field==='vartype').identity.name='int4'}],
 ['change operator OID both',e=>{for(const side of [e.source,e.restored])side.positionalBindings.find(x=>x.field==='opno').oid='999'}],
 ['change op implementation both',e=>{for(const side of [e.source,e.restored])side.positionalBindings.find(x=>x.field==='opno').identity.implementation='missing'}],
 ['alter function implementation sha both',e=>{for(const side of [e.source,e.restored])side.positionalBindings.find(x=>x.field==='funcid').identity.implementationSha256='f'.repeat(64)}],
 ['alter collation identity both',e=>{for(const side of [e.source,e.restored])side.positionalBindings.find(x=>x.oid==='100').identity.provider='i'}],
 ['alter single OID identity',e=>e.restored.positionalBindings.find(x=>x.kind==='operator').identity.name='<'],
 ['swap ordinal',e=>{const rows=e.source.positionalBindings;[rows[0],rows[1]]=[rows[1],rows[0]]}],
 ['duplicate OID row',e=>{e.restored.positionalBindings[1]=clone(e.restored.positionalBindings[0])}],
 ['miss one positional row',e=>e.source.positionalBindings.pop()],
 ['add one positional row',e=>e.restored.positionalBindings.push(clone(e.restored.positionalBindings[34]))],
 ['all rows gone',e=>{e.source.positionalBindings=[];e.restored.positionalBindings=[]}],
 ['false 3-valued semantics data',e=>e.semanticEquivalence='ASSUMED'],
 ['const typmod metadata',e=>e.restored.slug_type_modifier=999],
 ['unknown image architecture',e=>{e.sourceBuild.arch='aarch64';e.restoredBuild.arch='aarch64'}],
 ['build extra property',e=>e.sourceBuild.secrets='oops'],
 ['null row',e=>e.source.positionalBindings[4]=null],
 ['wrong positional path',e=>e.source.positionalBindings[0].path='0'],
 ['reversed synthetic forms',e=>{[e.source.raw_conbin,e.restored.raw_conbin]=[e.restored.raw_conbin,e.source.raw_conbin]}]
];
for(const [name,mutate] of mutations)rejected(name,mutate);
assert.throws(()=>inspectPr39PinnedEvidenceBytes(Buffer.from('{}')),/PR39 ATTESTATION STOP/);
assert.throws(()=>inspectPr39PinnedEvidenceBytes(randomBytes(200)),/PR39 ATTESTATION STOP/);
assert.throws(()=>inspectPr39PinnedEvidenceBytes(Buffer.alloc(150001)),/PR39 ATTESTATION STOP/);
// CLI must reject file-system inputs *before* unbounded allocation. Native
// evidence is never copied into GitHub, fixtures or temporary test files.
const cli=fileURLToPath(new URL('./pr39-pg17-structural-attestation.mjs',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'pr39-evidence-path-'));
let invalidPathCases=0;
function rejectCliPath(label,path){
 const out=spawnSync(process.execPath,[cli,'--evidence',path],{
  encoding:'utf8',timeout:5000,maxBuffer:262144
 });
 assert.equal(out.error,undefined,label+': cannot hang or allocate unbounded memory');
 assert.equal(out.status,1,label+': CLI must reject');
 assert.match(out.stderr,/PR39 ATTESTATION STOP/,label);
 invalidPathCases++;
}
try{
 const over=join(temp,'too-big.json');
 writeFileSync(over,Buffer.alloc(150001));
 rejectCliPath('oversized regular file',over);
 rejectCliPath('directory not regular file',temp);
 const small=join(temp,'small.json');
 writeFileSync(small,'{}');
 rejectCliPath('small JSON with wrong byte-pin',small);
 if(process.platform!=='win32'){
  const link=join(temp,'symlink.json');
  symlinkSync(small,link);
  rejectCliPath('symlink not regular file',link);
  if(process.platform==='linux')rejectCliPath('character device must be rejected','/dev/zero');
 }
}finally{rmSync(temp,{recursive:true,force:true})}
console.log('PASS: bounded CLI path guard ('+invalidPathCases+' negatives; no oversized read or device hang)');
if(process.env.PR39_NATIVE_EVIDENCE_FILE){
 const bytes=readPr39BoundedEvidenceFile(process.env.PR39_NATIVE_EVIDENCE_FILE);
 assert.equal(sha(bytes),PR39_PINNED_EVIDENCE_SHA256);
 const actual=inspectPr39PinnedEvidenceBytes(bytes);
 assert.equal(actual.decision,'BLOCKED');
 assert.equal(actual.comparedOccurrences,35);
 console.log('PASS: original user-supplied native JSON passed byte-pin and structural check; still BLOCKED');
}
console.log(`PASS: PR39_PINNED_STRUCTURAL_ATTESTATION_OFFLINE (${denied} rejected synthetic adversarial cases, 3 invalid-file negatives; no Docker, SQL or catalog PASS).`);