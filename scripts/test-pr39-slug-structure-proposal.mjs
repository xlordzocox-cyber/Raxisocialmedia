// Executable OFFLINE SPECIFICATION, not a PostgreSQL parser/extractor or policy.
// Synthetic operands only. Nothing here is imported by the native runner/gate.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {canonical,loadPreparationManifest,verifySqlSources} from '../apps/raxi-hq/scripts/staging-manifest.mjs';
import {assertPr39CatalogEquality} from './pr39-catalog-diagnostic.mjs';
import {reviewedSlugDefinitions} from './pr39-constraint-analysis.mjs';
if(process.argv.length!==2)throw Error('PR39 STOP: offline specification takes no flags');
const stop=()=>{throw Error('PR39 STOP: unsupported or changed synthetic structure');};
const clone=v=>structuredClone(v);
const same=(a,b)=>canonical(a)===canonical(b); // full records, never hash prefixes
const keys=(v,list)=>v&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),[...list].sort());
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const implementation=name=>({identity:'pg_catalog.'+name,language:'internal',volatility:'i',strict:true,returnsSet:false,body:'SYNTHETIC_NOT_NATIVE'});
const variable=()=>({tag:'Var',relation:'public.raxi_workspaces',attribute:3,column:'slug',type:'pg_catalog.text',typmod:-1,
 collation:'pg_catalog.default',relationIndex:1,level:0,syntacticRelation:1,syntacticAttribute:3,nullingRelations:[],location:-1});
const constant=(type,bytes,byValue,length,collation)=>({tag:'Const',type,typmod:-1,collation,length,byValue,isNull:false,
 value:{format:'SYNTHETIC_BYTES_NOT_PG_DATUM',bytes},location:-1});
const length=()=>({tag:'FuncExpr',identity:'pg_catalog.length(pg_catalog.text)',resultType:'pg_catalog.int4',returnsSet:false,
 variadic:false,coercion:'EXPLICIT_CALL',collation:null,inputCollation:'pg_catalog.default',implementation:implementation('length'),args:[variable()],location:-1});
const operator=(identity,fn,args,inputCollation=null)=>({tag:'OpExpr',identity,implementation:implementation(fn),resultType:'pg_catalog.bool',
 returnsSet:false,collation:null,inputCollation,args,location:-1});
// 2 and 64 are source-contract bounds. Pattern bytes below are deliberately
// synthetic, NOT the real regex constant or evidence of its native encoding.
const atoms=freeze([
 operator('pg_catalog.>=(pg_catalog.int4,pg_catalog.int4)','int4ge',[length(),constant('pg_catalog.int4',[0,0,0,2],true,4,null)]),
 operator('pg_catalog.<=(pg_catalog.int4,pg_catalog.int4)','int4le',[length(),constant('pg_catalog.int4',[0,0,0,64],true,4,null)]),
 operator('pg_catalog.~(pg_catalog.text,pg_catalog.text)','textregexeq',[variable(),constant('pg_catalog.text',[83,89,78],false,-1,'pg_catalog.default')],'pg_catalog.default')
]);
const and=(args)=>({tag:'BoolExpr',kind:'AND',args,location:-1});
const nested=()=>and([and(clone(atoms.slice(0,2))),clone(atoms[2])]);
const flat=()=>and(clone(atoms));
const envelope=tree=>({provenance:'SYNTHETIC_OFFLINE_FIXTURE',version:'PG17_MODEL_V1',object:'public.raxi_workspaces.raxi_workspaces_slug_check',
 flags:{validated:true,deferrable:false,deferred:false,noInherit:false,local:true,inherited:0},tree});
const nodeKeys={
 BoolExpr:['tag','kind','args','location'],
 OpExpr:['tag','identity','implementation','resultType','returnsSet','collation','inputCollation','args','location'],
 FuncExpr:['tag','identity','resultType','returnsSet','variadic','coercion','collation','inputCollation','implementation','args','location'],
 Var:['tag','relation','attribute','column','type','typmod','collation','relationIndex','level','syntacticRelation','syntacticAttribute','nullingRelations','location'],
 Const:['tag','type','typmod','collation','length','byValue','isNull','value','location']
};
// Refuse values that JSON/canonicalization could silently erase or coerce.
function validateJsonData(value){
 let items=0;const active=new Set();
 const visit=(v,depth)=>{
  if(++items>1000||depth>32)stop();
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='string'){if(v.length>8192)stop();return;}
  if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))stop();return;}
  if(!v||typeof v!=='object'||active.has(v)||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))stop();
  const own=Reflect.ownKeys(v);
  if(Array.isArray(v)&&Object.keys(v).length!==v.length)stop();
  for(const key of own){
   if(Array.isArray(v)&&key==='length')continue;
   const descriptor=Object.getOwnPropertyDescriptor(v,key);
   if(typeof key!=='string'||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))stop();
  }
  if(own.length!==(Array.isArray(v)?v.length+1:Object.keys(v).length))stop();
  active.add(v);Object.values(v).forEach(child=>visit(child,depth+1));active.delete(v);
 };
 visit(value,0);
}
function validateTree(tree){
 let count=0;const active=new Set();
 const walk=(node,depth)=>{
  if(depth>8||++count>32||active.has(node)||!node||!Object.hasOwn(nodeKeys,node.tag)||!keys(node,nodeKeys[node.tag]))stop();
  active.add(node);
  if(!Number.isSafeInteger(node.location))stop();
  if(node.tag==='BoolExpr'&&(node.kind!=='AND'||!Array.isArray(node.args)))stop();
  if(['OpExpr','FuncExpr'].includes(node.tag)){
   if(!keys(node.implementation,['identity','language','volatility','strict','returnsSet','body'])||
    node.implementation.volatility!=='i'||node.implementation.strict!==true||node.implementation.returnsSet!==false||node.returnsSet!==false||!Array.isArray(node.args))stop();
  }
  if(node.tag==='Const'){
   if(!keys(node.value,['format','bytes'])||node.value.format!=='SYNTHETIC_BYTES_NOT_PG_DATUM'||!Array.isArray(node.value.bytes)||
    node.value.bytes.length>1024||node.value.bytes.some(b=>!Number.isInteger(b)||b<0||b>255))stop();
  }
  if(node.args)node.args.forEach(arg=>walk(arg,depth+1));
  active.delete(node);
 };
 walk(tree,0);
}
function modelProposal(before,after){
 // No time, provider, approval, native provenance or authorization input accepted.
 const expectedKeys=['provenance','version','object','flags','tree'];
 for(const v of [before,after]){
  validateJsonData(v);
  if(!keys(v,expectedKeys)||v.provenance!=='SYNTHETIC_OFFLINE_FIXTURE'||v.version!=='PG17_MODEL_V1'||
   v.object!=='public.raxi_workspaces.raxi_workspaces_slug_check'||!same(v.flags,envelope(null).flags))stop();
  validateTree(v.tree);
 }
 const a=before.tree,b=after.tree;
 // Only ((L AND U) AND R) -> (L AND U AND R), never recursive flatten/sort.
 if(a.tag!=='BoolExpr'||b.tag!=='BoolExpr'||a.location!==-1||b.location!==-1||a.args.length!==2||b.args.length!==3)stop();
 const inner=a.args[0];
 if(inner.tag!=='BoolExpr'||inner.kind!=='AND'||inner.location!==-1||inner.args.length!==2)stop();
 const left=[inner.args[0],inner.args[1],a.args[1]];
 for(let i=0;i<3;i++)if(!same(left[i],atoms[i])||!same(b.args[i],atoms[i]))stop();
 return freeze({status:'OFFLINE_RULE_SHAPE_ONLY',decision:'BLOCKED',allowCatalogPass:false,nativeValidated:false,
  semanticEquivalence:'NOT_VERIFIED',orderedOperandCount:3,removedAndRecord:{tag:inner.tag,kind:inner.kind,location:inner.location}});
}
const modelResult=modelProposal(envelope(nested()),envelope(flat()));
assert.equal(modelResult.decision,'BLOCKED');assert.equal(modelResult.allowCatalogPass,false);assert.equal(modelResult.nativeValidated,false);
assert.equal(modelResult.semanticEquivalence,'NOT_VERIFIED');assert.equal(modelResult.orderedOperandCount,3);
console.log('PASS: synthetic rule shape recognized; catalog PASS and semantic equivalence remain BLOCKED');
let denied=0;
const negative=(label,change)=>{
 const a=envelope(nested()),b=envelope(flat());change(a,b);
 assert.throws(()=>modelProposal(a,b),undefined,label);denied++;console.log('PASS: rejected '+label);
};
for(const [label,change] of [
 ['operand order',b=>b.tree.args.reverse()],['operand multiplicity',b=>b.tree.args[1]=clone(b.tree.args[0])],
 ['missing operand',b=>b.tree.args.pop()],['extra operand',b=>b.tree.args.push(clone(b.tree.args[2]))],
 ['OR',b=>b.tree.kind='OR'],['NOT',b=>b.tree.args[0]={tag:'NotExpr',arg:b.tree.args[0]}],
 ['DistinctExpr tag',b=>b.tree.args[0].tag='DistinctExpr'],['NullIfExpr tag',b=>b.tree.args[0].tag='NullIfExpr'],
 ['extra nested AND',b=>b.tree.args[1]=and([b.tree.args[1],clone(b.tree.args[2])])],
 ['reversed operator args',b=>b.tree.args[0].args.reverse()],['changed operator',b=>b.tree.args[0].identity='pg_catalog.>(pg_catalog.int4,pg_catalog.int4)'],
 ['changed implementation',b=>b.tree.args[0].implementation.identity='public.int4ge'],
 ['changed function',b=>b.tree.args[0].args[0].identity='pg_catalog.octet_length(pg_catalog.text)'],
 ['changed bound bytes',b=>b.tree.args[0].args[1].value.bytes[3]=1],['changed pattern bytes',b=>b.tree.args[2].args[1].value.bytes[0]=84],
 ['constant type',b=>b.tree.args[0].args[1].type='pg_catalog.int8'],['constant typmod',b=>b.tree.args[0].args[1].typmod=8],
 ['constant NULL',b=>b.tree.args[0].args[1].isNull=true],['constant by-value flag',b=>b.tree.args[0].args[1].byValue=false],
 ['constant storage length',b=>b.tree.args[0].args[1].length=8],['constant encoding',b=>b.tree.args[0].args[1].value.format='RAW_NATIVE_DATUM'],
 ['function coercion flag',b=>b.tree.args[0].args[0].coercion='IMPLICIT_CAST'],
 ['added cast node',b=>b.tree.args[2].args[0]={tag:'RelabelType',arg:b.tree.args[2].args[0]}],
 ['input collation',b=>b.tree.args[2].inputCollation='pg_catalog.C'],['constant collation',b=>b.tree.args[2].args[1].collation='pg_catalog.C'],
 ['result type',b=>b.tree.args[0].resultType='pg_catalog.int4'],['result collation',b=>b.tree.args[0].collation='pg_catalog.default'],
 ['function volatility',b=>b.tree.args[0].args[0].implementation.volatility='v'],['function strictness',b=>b.tree.args[0].args[0].implementation.strict=false],
 ['set-returning function',b=>b.tree.args[0].args[0].returnsSet=true],['variadic function',b=>b.tree.args[0].args[0].variadic=true],
 ['variable relation',b=>b.tree.args[2].args[0].relation='public.other_table'],['variable attribute',b=>b.tree.args[2].args[0].attribute=4],
 ['variable scope',b=>b.tree.args[2].args[0].level=1],['variable nulling flags',b=>b.tree.args[2].args[0].nullingRelations=[1]],
 ['variable collation',b=>b.tree.args[2].args[0].collation='pg_catalog.C'],['variable type',b=>b.tree.args[2].args[0].type='pg_catalog.varchar'],
 ['source location',b=>b.tree.args[0].location=12],['unknown node field',b=>b.tree.args[0].assumeEquivalent=true],
 ['unknown metadata field',b=>b.extra='approved'],['native provenance label',b=>b.provenance='NATIVE_PG17'],
 ['wrong object',b=>b.object='public.other.constraint'],['unvalidated CHECK',b=>b.flags.validated=false],
 ['deferrable CHECK',b=>b.flags.deferrable=true],['changed inheritance',b=>b.flags.inherited=1],
 ['unknown major schema',b=>b.version='PG18_MODEL_V1'],['malformed node',b=>b.tree.args[0]=null],
 ['NaN cannot coerce to null',b=>b.tree.args[0].collation=NaN],['Infinity cannot coerce to null',b=>b.tree.args[0].collation=Infinity],
 ['undefined field',b=>b.tree.args[0].collation=undefined],['negative zero',b=>b.tree.args[2].args[0].level=-0],
 ['sparse operand list',b=>delete b.tree.args[0]],['non-JSON object',b=>b.tree.args[0].collation=new Date(0)],
 ['hidden metadata',b=>Object.defineProperty(b.tree.args[0],'hidden',{value:true})],
 ['getter metadata',b=>Object.defineProperty(b.tree.args[0],'collation',{enumerable:true,get(){return null;}})],
 ['symbol metadata',b=>b.tree.args[0][Symbol('hidden')]=true]
])negative(label,(_a,b)=>change(b));
negative('right-associated source',a=>a.tree=and([clone(atoms[0]),and(clone(atoms.slice(1)))]));
negative('flat source is outside proposed two-shape rule',a=>a.tree=flat());
negative('extra inner AND metadata',a=>a.tree.args[0].flags={assumedSafe:true});
negative('cycle',(_a,b)=>b.tree.args[0]=b.tree);
negative('both sides changed together cannot redefine expected operands',(a,b)=>{a.tree.args[1].args[1].value.bytes[0]=99;b.tree.args[2].args[1].value.bytes[0]=99;});
negative('forged approval flag',(_a,b)=>b.humanApproved=true);
// Reuse the real strict gate: recognized definitions with otherwise identical
// metadata remain FAIL, regardless of a matching synthetic structural model.
const manifest=await loadPreparationManifest();const sources=await verifySqlSources(manifest);
const definitions=reviewedSlugDefinitions(sources);
const raw={postgresMajor:17,schema:{postgresMajor:17,tables:[],functions:[],roles:[],otherPublicRelations:[]},tables:[{
 name:'raxi_workspaces',kind:'r',rls:true,force_rls:false,view_definition:null,
 columns:[{name:'slug',type:'text',required:true,identity:'',generated:'',default:null}],
 constraints:[{name:'raxi_workspaces_slug_check',definition:definitions.nested}],indexes:[],triggers:null,policies:null,grants:null,column_grants:null
}],functions:[],roles:[],otherPublicRelations:[]};
const restored=clone(raw);restored.tables[0].constraints[0].definition=definitions.flat;
assert.throws(()=>assertPr39CatalogEquality(raw,restored),/strict catalog mismatch/);
console.log('PASS: original gate still rejects the observed definition pair after a synthetic model match');
// No integration was introduced: known production/native modules do not import
// this opt-in executable specification. This is a scoped regression, not a proof
// about every possible indirect import in an arbitrary future repository.
for(const path of ['pr39-local-synthetic-recovery.mjs','pr39-catalog-diagnostic.mjs','pr39-constraint-analysis.mjs'])
 assert.ok(!readFileSync(new URL(path,import.meta.url),'utf8').includes('test-pr39-slug-structure-proposal'),'offline specification remains separate');
console.log('PASS: PR39_STRUCTURE_PROPOSAL_OFFLINE ('+denied+' denied cases; synthetic model only; no SQL/Docker/provider; native equivalence BLOCKED).');
