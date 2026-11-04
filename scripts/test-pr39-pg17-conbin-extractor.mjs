// OFFLINE ONLY — synthetic nodeToString samples; no Docker, SQL or native claims.
import {strict as assert} from 'node:assert';
import {PR39_CONBIN_EXTRACTOR_REVISION,PR39_LOCAL_CAPTURE_SELECT,
 decodePg17Conbin,inspectPg17SlugCandidate} from './pr39-pg17-conbin-extractor.mjs';
assert.equal(process.argv.length,2,'No CLI flags');

function node(tag,fields){return `{${tag} ${Object.entries(fields).map(([k,v])=>`:${k} ${v}`).join(' ')}}`;}
const varSlug=()=>node('VAR',{varno:'1',varattno:'3',vartype:'25',vartypmod:'-1',varcollid:'100',
 varnullingrels:'(b)',varlevelsup:'0',varnosyn:'1',varattnosyn:'3',location:'-1'});
const constInt=n=>node('CONST',{consttype:'23',consttypmod:'-1',constcollid:'0',constlen:'4',constbyval:'true',
 constisnull:'false',location:'-1',constvalue:`4 [ ${n} 0 0 0 ]`});
const constRegex=()=>node('CONST',{consttype:'25',consttypmod:'-1',constcollid:'100',constlen:'-1',constbyval:'false',
 constisnull:'false',location:'-1',constvalue:'3 [ 83 89 78 ]'}); // synthetic bytes, NOT Raxi regex
const length=()=>node('FUNCEXPR',{funcid:'1317',funcresulttype:'23',funcretset:'false',funcvariadic:'false',
 funcformat:'0',funccollid:'0',inputcollid:'100',args:`(${varSlug()})`,location:'-1'});
const op=(id,args,coll='0')=>node('OPEXPR',{opno:String(id),opfuncid:'65',opresulttype:'16',opretset:'false',
 opcollid:'0',inputcollid:coll,args:`(${args.join(' ')})`,location:'-1'});
const lower=()=>op(525,[length(),constInt(2)]);
const upper=()=>op(523,[length(),constInt(64)]);
const regex=()=>op(641,[varSlug(),constRegex()],'100');
const and=args=>node('BOOLEXPR',{boolop:'and',args:`(${args.join(' ')})`,location:'-1'});
const nested=()=>and([and([lower(),upper()]),regex()]);
const flat=()=>and([lower(),upper(),regex()]);
const positive=inspectPg17SlugCandidate(nested(),flat());
assert.equal(positive.revision,PR39_CONBIN_EXTRACTOR_REVISION);
assert.equal(positive.decision,'BLOCKED');
assert.equal(positive.nativeValidated,false);
assert.equal(positive.allowCatalogPass,false);
assert.equal(positive.semanticEquivalence,'NOT_VERIFIED');
assert.deepEqual(positive.source.positions.map(x=>x.path),['0.0','0.1','1']);
assert.deepEqual(positive.restored.positions.map(x=>x.path),['0','1','2']);
for(const side of [positive.source,positive.restored]){
 assert.equal(side.positions.length,3);
 assert.equal(side.positions[0].references.some(x=>x.path.endsWith('.0.0')&&x.field==='vartype'),true);
 assert.equal(side.positions[2].references.some(x=>x.path.endsWith('.0')&&x.field==='vartype'),true);
 assert.equal(side.positions[2].references.some(x=>x.path.endsWith('.1')&&x.field==='consttype'),true);
 assert.equal(side.positions.every(x=>/^[a-f0-9]{64}$/.test(x.rawDigest)),true);
 assert.equal(side.positions.every(x=>x.references.every(y=>typeof y.path==='string'&&typeof y.oid==='string')),true);
 assert.equal(side.positions.every(x=>x.varBinding.varattno==='3'&&x.varBinding.varnosyn==='1'),true);
 assert.equal(side.positions.every(x=>x.constant.path===x.path+'.1'&&/^[a-f0-9]{64}$/.test(x.constant.completeRawValueSha256)),true);
}
assert.equal(PR39_LOCAL_CAPTURE_SELECT.toLowerCase().startsWith('select\n'),true);
assert.equal(PR39_LOCAL_CAPTURE_SELECT.includes(';'),false);
assert.equal(PR39_LOCAL_CAPTURE_SELECT.includes('raxi_workspaces_slug_check'),true);
assert.equal(PR39_LOCAL_CAPTURE_SELECT.includes('conbin::text'),true);
console.log('PASS: source/restored three operand positional records and raw field OID references captured; nativeValidated=false');

let rejected=0;
function bad(label,left,right,which='pair'){
 assert.throws(()=>which==='decoder'?decodePg17Conbin(left):inspectPg17SlugCandidate(left,right),/PR39 STOP/,label);
 rejected++;
}
// Structural invalidity, unsupported node type, unknown/duplicate fields, malformed bytes.
const mutations=[
 ['OR',s=>s.replace(':boolop and',':boolop or')],
 ['NOT',s=>s.replace(':boolop and',':boolop not')],
 ['missing field',s=>s.replace(':location -1}', '}')],
 ['unknown field',s=>s.replace(':location -1}',':added 1 :location -1}')],
 ['duplicate field',s=>s.replace(':location -1}',':location -1 :location -1}')],
 ['unknown node tag',s=>s.replace('OPEXPR','DISTINCTEXPR')],
 ['added cast',s=>s.replace('FUNCEXPR','RELABELTYPE')],
 ['changed bool arity',s=>s.replace(/\{BOOLEXPR :boolop and :args \(\{BOOLEXPR [\s\S]+?\}\) :location -1\}/, '{BOOLEXPR :boolop and :args () :location -1}')],
 ['trailing extra',s=>s+' {VAR :varno 1}'],
 ['unterminated node',s=>s.slice(0,-1)],
 ['broken quote',s=>s.replace(':boolop and',':boolop "unterminated')],
 ['NULL const mismatch',s=>s.replace(':constisnull false',':constisnull true')],
 ['wrong byte length',s=>s.replace('4 [ 2 0 0 0 ]','3 [ 2 0 0 0 ]')],
 ['byte out of range',s=>s.replace('4 [ 2 0 0 0 ]','4 [ 299 0 0 0 ]')],
 ['wrong consttype',s=>s.replace(':consttype 23',':consttype -2')],
 ['negative OID',s=>s.replace(':opno 525',':opno -3')],
 ['op returns set',s=>s.replace(':opretset false',':opretset true')],
 ['function returns set',s=>s.replace(':funcretset false',':funcretset true')],
 ['function variadic',s=>s.replace(':funcvariadic false',':funcvariadic true')],
 ['wrong var scope',s=>s.replace(':varlevelsup 0',':varlevelsup 1')],
 ['wrong var binding',s=>s.replace(':varattnosyn 3',':varattnosyn 4')],
 ['wrong var table',s=>s.replace(':varno 1',':varno 0')],
 ['non-empty varnullingrels',s=>s.replace(':varnullingrels (b)',':varnullingrels (b 1)')],
 ['unsafe location',s=>s.replace(':location -1',':location 20')],
 ['unexpected field order',s=>s.replace(':constisnull false :location',':location -1 :constisnull false :location')],
 ['null marker forged',s=>s.replace(':constvalue 4 [ 2 0 0 0 ]',':constvalue <>')],
 ['control bytes',s=>'\0'+s],
 ['overlong',s=>' '.repeat(65537)+s],
 ['leading garbage',s=>'broken '+s],
 ['missing args opener',s=>s.replace(':args (',':args [')],
 ['missing args closer',s=>s.replace(/\) :location -1\}/,'] :location -1}')],
 ['missing const byte close',s=>s.replace('2 0 0 0 ]','2 0 0 0 )')],
];
for(const [label,change] of mutations)bad(label,change(nested()),flat());
for(const [label,l,r] of [
 ['source already flat',flat(),flat()],
 ['restore also nested',nested(),nested()],
 ['source right-associated',and([lower(),and([upper(),regex()])]),flat()],
 ['restore right-associated',nested(),and([lower(),and([upper(),regex()])])],
 ['restore missing atom',nested(),and([lower(),upper()])],
 ['restore extra atom',nested(),and([lower(),upper(),regex(),regex()])],
 ['wrong left atom kind',and([and([regex(),upper()]),lower()]),flat()],
 ['wrong regex left kind',and([and([lower(),upper()]),lower()]),flat()],
])bad(label,l,r);
// Mutations which a syntactic decoder cannot classify as semantically equivalent:
// they MUST remain BLOCKED even if the candidate structural shape survives.
for(const [label,r] of [
 ['swapped bounds',and([upper(),lower(),regex()])],
 ['same bound twice',and([lower(),lower(),regex()])],
 ['changed bound value',and([lower(),op(523,[length(),constInt(65)]),regex()])],
 ['different function OID',and([lower().replace(':funcid 1317',':funcid 1300'),upper(),regex()])],
 ['different regex bytes',and([lower(),upper(),regex().replace('83 89 78','83 89 79')])],
 ['different operator OID',and([lower(),upper(),regex().replace(':opno 641',':opno 1000')])],
 ]){
  const result=inspectPg17SlugCandidate(nested(),r);
  assert.equal(result.decision,'BLOCKED',label);
  assert.equal(result.nativeValidated,false,label);
  assert.equal(result.semanticEquivalence,'NOT_VERIFIED',label);
  rejected++;
}
// No caller data can claim native verification or authorize catalog PASS.
const result=inspectPg17SlugCandidate(nested(),flat(),{humanApproved:true,nativeValidated:true});
assert.equal(result.allowCatalogPass,false);
assert.equal(result.nativeValidated,false);
rejected++;
console.log(`PASS: PR39_PG17_CONBIN_EXTRACTOR_OFFLINE (${rejected} negative/adversarial cases; parser candidate only; no Docker/SQL; native equivalence BLOCKED).`);
