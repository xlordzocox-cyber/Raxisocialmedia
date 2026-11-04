// Synthetic offline-only identity evidence; no Docker/network/SQL.
import {strict as assert} from 'node:assert';
import {inspectPg17SlugCandidate} from './pr39-pg17-conbin-extractor.mjs';
import {PR39_OID_BINDING_REVISION,checkPr39OfflineOidBindings} from './pr39-pg17-oid-binding-resolver.mjs';
assert.equal(process.argv.length,2,'No flags accepted');
const node=(tag,fields)=>`{${tag} ${Object.entries(fields).map(([k,v])=>`:${k} ${v}`).join(' ')}}`;
const varSlug=()=>node('VAR',{varno:'1',varattno:'3',vartype:'25',vartypmod:'-1',varcollid:'100',varnullingrels:'(b)',varlevelsup:'0',varnosyn:'1',varattnosyn:'3',location:'-1'});
const cInt=n=>node('CONST',{consttype:'23',consttypmod:'-1',constcollid:'0',constlen:'4',constbyval:'true',constisnull:'false',location:'-1',constvalue:`4 [ ${n} 0 0 0 0 0 0 0 ]`});
const cText=()=>node('CONST',{consttype:'25',consttypmod:'-1',constcollid:'100',constlen:'-1',constbyval:'false',constisnull:'false',location:'-1',constvalue:'3 [ 83 89 78 ]'});
const length=()=>node('FUNCEXPR',{funcid:'1317',funcresulttype:'23',funcretset:'false',funcvariadic:'false',funcformat:'0',funccollid:'0',inputcollid:'100',args:`(${varSlug()})`,location:'-1'});
const op=(id,ls,rc,coll='0')=>node('OPEXPR',{opno:String(id),opfuncid:'65',opresulttype:'16',opretset:'false',opcollid:'0',inputcollid:coll,args:`(${ls} ${rc})`,location:'-1'});
const low=()=>op(525,length(),cInt(2)),upper=()=>op(523,length(),cInt(64)),regex=()=>op(641,varSlug(),cText(),'100');
const and=x=>node('BOOLEXPR',{boolop:'and',args:`(${x.join(' ')})`,location:'-1'});
const candidate=inspectPg17SlugCandidate(and([and([low(),upper()]),regex()]),and([low(),upper(),regex()]));
const H='a'.repeat(64), B='b'.repeat(64), C='c'.repeat(64), D='d'.repeat(64);
const build=()=>({serverVersionNum:170008,imageDigest:'sha256:'+H,imagePlatform:'linux/amd64',pgConfigSha256:B,
 postgresBinarySha256:C,datumBytes:8,databaseEncoding:'UTF8',databaseCollationSha256:D});
function identity(r){
 if(r.oid==='0')return {zeroOid:true};
 const name=r.kind+'_'+r.field;
 if(r.kind==='type')return {schema:'pg_catalog',name,kind:'b',category:'N',length:4,byValue:true,alignment:'i',storage:'p',defined:true,elementType:'none',defaultCollation:'none'};
 if(r.kind==='operator')return {schema:'pg_catalog',name,kind:'b',leftType:'pg_catalog.int4',rightType:'pg_catalog.int4',resultType:'pg_catalog.bool',procedure:'pg_catalog.opfunc(int4,int4)',canMerge:false,canHash:false};
 if(r.kind==='function')return {schema:'pg_catalog',name,arguments:'pg_catalog.text',resultType:'pg_catalog.int4',language:'internal',volatility:'i',parallel:'s',strict:true,leakproof:false,securityDefiner:false,implementationSha256:H};
 if(r.kind==='collation')return {schema:'pg_catalog',name,provider:'c',deterministic:true,encoding:-1,collate:'C',ctype:'C',locale:null,rules:null,version:null};
 throw Error('bad fixture');
}
const catalog=(side,tag)=>({provenance:'SYNTHETIC_OFFLINE',side:tag,build:build(),rows:side.positions.flatMap(p=>p.references).map((r,i)=>({ordinal:i,...r,identity:identity(r)}))});
const source=catalog(candidate.source,'source'),restored=catalog(candidate.restored,'restored');
function inspect(a=candidate,s=source,r=restored){return checkPr39OfflineOidBindings(a,s,r)}
const result=inspect();
assert.equal(result.revision,PR39_OID_BINDING_REVISION);
assert.equal(result.decision,'BLOCKED');
assert.equal(result.nativeValidated,false);
assert.equal(result.architectureValidated,false);
assert.equal(result.semanticEquivalence,'NOT_VERIFIED');
assert.equal(result.allowCatalogPass,false);
assert.ok(result.comparedOccurrences>30);
assert.match(result.structuralBindingDigest,/^[a-f0-9]{64}$/);
console.log('PASS: aligned ordered synthetic OID identities still BLOCKED, no native equivalence');
const clone=structuredClone;
let denied=0;
function reject(label,mutate){
 const a=clone(candidate),s=clone(source),r=clone(restored);
 mutate(a,s,r);
 assert.throws(()=>inspect(a,s,r),/PR39 STOP/,label);
 denied++;
}
const f=(field,value)=>(a,s,r)=>{r.rows.find(x=>x.field===field&&x.oid!=='0').identity[value[0]]=value[1]};
const cases=[
 ['forged PASS',(a)=>{a.decision='PASS'}],
 ['native approval forged',(a)=>{a.nativeValidated=true}],
 ['fake architecture verified',(a)=>{a.architectureValidated=true}],
 ['catalog pass forged',(a)=>{a.allowCatalogPass=true}],
 ['fake semantic equivalence',(a)=>{a.semanticEquivalence='VERIFIED'}],
 ['wrong parser revision',(a)=>{a.revision='V1'}],
 ['wrong Datum width',(a)=>{a.assumedDatumBytes=4}],
 ['missing atom',(a)=>{a.restored.positions.pop()}],
 ['reordered atoms',(a)=>{a.restored.positions.reverse()}],
 ['changed varattno',(a)=>{a.restored.positions[2].varBinding.varattno='9'}],
 ['changed const bytes hash',(a)=>{a.restored.positions[0].constant.completeRawValueSha256=H}],
 ['changed constant byval',(a)=>{a.restored.positions[0].constant.byValue='false'}],
 ['changed variable nulling',(a)=>{a.restored.positions[1].varBinding.nullingRelations=[1]}],
 ['wrong source capture label',(a,s)=>{s.side='restored'}],
 ['native provenance forged',(a,s)=>{s.provenance='NATIVE'}],
 ['missing binding',(a,s,r)=>{r.rows.pop()}],
 ['extra binding',(a,s,r)=>{r.rows.push(clone(r.rows.at(-1)))}],
 ['swapped binding rows',(a,s,r)=>{[r.rows[0],r.rows[1]]=[r.rows[1],r.rows[0]]}],
 ['repeated ordinal',(a,s,r)=>{r.rows[1].ordinal=0}],
 ['wrong path',(a,s,r)=>{r.rows[0].path='bad'}],
 ['wrong field',(a,s,r)=>{r.rows[0].field='newfunc'}],
 ['wrong kind',(a,s,r)=>{r.rows[0].kind='type'}],
 ['wrong OID',(a,s,r)=>{r.rows[0].oid='34564'}],
 ['negative OID',(a,s,r)=>{r.rows[0].oid='-1'}],
 ['zero operator',(a,s,r)=>{r.rows.find(x=>x.kind==='operator').oid='0'}],
 ['ambiguous type identity',(a,s,r)=>{r.rows.find(x=>x.kind==='type').identity.name='different'}],
 ['type default collation',(a,s,r)=>{r.rows.find(x=>x.kind==='type').identity.defaultCollation='other'}],
 ['operator behavior',(a,s,r)=>{r.rows.find(x=>x.kind==='operator').identity.procedure='different.function(int4,int4)'}],
 ['function body fingerprint',(a,s,r)=>{r.rows.find(x=>x.kind==='function'&&x.oid!=='0').identity.implementationSha256=B}],
 ['collation provider',(a,s,r)=>{r.rows.find(x=>x.kind==='collation'&&x.oid!=='0').identity.provider='i'}],
 ['collation deterministic',(a,s,r)=>{r.rows.find(x=>x.kind==='collation'&&x.oid!=='0').identity.deterministic=false}],
 ['collation version',(a,s,r)=>{r.rows.find(x=>x.kind==='collation'&&x.oid!=='0').identity.version='2'}],
 ['missing identity attribute',(a,s,r)=>{delete r.rows.find(x=>x.kind==='operator').identity.canHash}],
 ['extra identity attribute',(a,s,r)=>{r.rows.find(x=>x.kind==='type').identity.trusted=true}],
 ['OID alias not identity',(a,s,r)=>{r.rows.find(x=>x.kind==='operator').identity.name='shadow_operator'}],
 ['same OID different function',(a,s,r)=>{r.rows.find(x=>x.kind==='function'&&x.oid!=='0').identity.name='shadow_func'}],
 ['zero OID falsified',(a,s,r)=>{r.rows.find(x=>x.oid==='0').identity={zeroOid:false}}],
 ['missing image digest',(a,s,r)=>{delete r.build.imageDigest}],
 ['different image digest',(a,s,r)=>{r.build.imageDigest='sha256:'+D}],
 ['different PG patch',(a,s,r)=>{r.build.serverVersionNum=170009}],
 ['different arch',(a,s,r)=>{r.build.imagePlatform='linux/arm64'}],
 ['unrecognized arch',(a,s,r)=>{r.build.imagePlatform='linux/ppc64le'}],
 ['datum width inconsistent',(a,s,r)=>{r.build.datumBytes=4}],
 ['different binary fingerprint',(a,s,r)=>{r.build.postgresBinarySha256=D}],
 ['different pg config',(a,s,r)=>{r.build.pgConfigSha256=H}],
 ['different locale fingerprint',(a,s,r)=>{r.build.databaseCollationSha256=H}],
 ['changed database encoding',(a,s,r)=>{r.build.databaseEncoding='LATIN1'}],
 ['extra catalog field',(a,s,r)=>{r.verified=true}],
 ['null prototype poison',(a,s,r)=>{r.rows[0].identity=Object.create(null)}],
 ['malformed OID width',(a,s,r)=>{r.rows[0].oid='4294967296'}],
 ];
for(const [label,mutate] of cases)reject(label,mutate);
// Same numeric OID is irrelevant without identity; a synthetic equal identity
// may use a different local OID only when candidate and catalog agree exactly.
const sourceOid=source.rows.find(x=>x.field==='vartype').oid;
const restoredOid=restored.rows.find(x=>x.field==='vartype').oid;
assert.equal(sourceOid,restoredOid);
const changed=clone(candidate);
const indices=changed.restored.positions.flatMap((atom)=>atom.references.filter(r=>r.field==='vartype'));
indices.forEach(ref=>{ref.oid='4321'});
const mismatchedCatalog=catalog(changed.restored,'restored');
assert.equal(inspect(changed,source,mismatchedCatalog).decision,'BLOCKED');
assert.equal(inspect(changed,source,mismatchedCatalog).nativeValidated,false);
console.log(`PASS: PR39_PG17_OID_BINDINGS_OFFLINE (${denied} rejected adversarial cases; raw OID mismatch with equal synthetic identity still BLOCKED; NO Docker/SQL).`);
