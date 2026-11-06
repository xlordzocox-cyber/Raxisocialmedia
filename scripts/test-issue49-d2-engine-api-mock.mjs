// Issue49 D2 fake-only test. Never connects to a daemon or socket.
import {strict as assert} from 'node:assert';
import {buildIssue49D2Request,parseIssue49D2Multiplexed,
 createIssue49D2MockTransport,ISSUE49_D2_IMAGE_ID} from './issue49-d2-engine-api-mock.mjs';
assert.equal(process.argv.length,2,'no test execution flags');
const id='a'.repeat(64),sid='b'.repeat(24),imageId=ISSUE49_D2_IMAGE_ID;
let negatives=0;
const deny=(f)=>{assert.throws(f,/ISSUE49 D2 MOCK STOP/);negatives++;};
const denyAsync=async(f)=>{await assert.rejects(f,/ISSUE49 D2 MOCK STOP/);negatives++;};
const spec=buildIssue49D2Request({operation:'createContainer',sessionId:sid,role:'T0_SOURCE',imageId});
assert.equal(spec.expect,201);
assert.equal(spec.body.Image,imageId);
assert.equal(spec.body.HostConfig.NetworkMode,'none');
assert.equal(Object.isFrozen(spec.body.HostConfig),true);
assert.equal(Object.isFrozen(spec.body.HostConfig.Binds),true);
assert.equal(spec.body.HostConfig.Privileged,false);
assert.deepEqual(spec.body.HostConfig.Binds,[]);
assert.equal(buildIssue49D2Request({operation:'listContainers'}).method,'GET');
assert.equal(buildIssue49D2Request({operation:'deleteContainer',id}).expect,204);
const mk=(channel,content)=>{
 const b=Buffer.from(content),r=Buffer.alloc(b.length+8);
 r[0]=channel;r.writeUInt32BE(b.length,4);b.copy(r,8);return r;
};
const result=parseIssue49D2Multiplexed(Buffer.concat([mk(1,Buffer.from([0,1,255])),mk(2,'warning')]));
assert.deepEqual(Buffer.from(result.stdout),Buffer.from([0,1,255]));
assert.equal(Buffer.from(result.stderr).toString(),'warning');
console.log('PASS ISSUE49 D2 MOCK: restricted request descriptors and binary stream');
for(const bad of [
 {operation:'arbitrary'},
 {operation:'ping',unused:true},
 {operation:'imageInspect',imageId:'postgres:17'},
 {operation:'deleteContainer',id:'name'},
 {operation:'createContainer',role:'UNKNOWN',sessionId:sid,imageId},
 {operation:'createContainer',role:'T0_SOURCE',sessionId:'wrong',imageId},
 {operation:'createExec',id,commandKey:'UNKNOWN'},
 {operation:'startExec',id,additional:true},
 {operation:'info',host:'remote'}
])deny(()=>buildIssue49D2Request(bad));
for(const bad of [
 Buffer.from([1,0]),Buffer.from([3,0,0,0,0,0,0,0]),
 Buffer.from([1,1,0,0,0,0,0,0]),
 Buffer.from([1,0,0,0,0,0,0,2,1]),
 mk(2,Buffer.alloc(65537)),Buffer.alloc(8*1024*1024+1)
])deny(()=>parseIssue49D2Multiplexed(bad));
deny(()=>createIssue49D2MockTransport({gate:'UNAPPROVED',exchange:async()=>({})}));
const fake=(response)=>createIssue49D2MockTransport({
 gate:'ISSUE49_D2_FAKE_ONLY',exchange:async()=>response});
assert.equal((await fake({status:200,data:'OK'}).call({operation:'ping'})),true);
for(const [req,response] of [
 [{operation:'ping'},{status:500,data:'OK'}],
 [{operation:'ping'},{status:200,data:'NO'}],
 [{operation:'info'},{status:200,data:{ID:'a',OSType:'linux'}}],
 [{operation:'deleteContainer',id},{status:500,data:null}],
 [{operation:'listContainers'},{status:200,data:{items:[]}}],
 [{operation:'inspectExec',id},{status:200,data:{Running:true,ExitCode:0}}],
 [{operation:'inspectExec',id},{status:200,data:{Running:false,ExitCode:1}}],
 [{operation:'startExec',id},{status:200,data:Buffer.from([1,0])}]
])await denyAsync(()=>fake(response).call(req));
await denyAsync(()=>fake({status:200,data:{
 Volumes:[],Warnings:['volume inventory partial']
}}).call({operation:'listVolumes'}));
const mutable={operation:'imageInspect',imageId};
let release;
const barrier=new Promise(resolve=>{release=resolve;});
const pending=createIssue49D2MockTransport({
 gate:'ISSUE49_D2_FAKE_ONLY',
 exchange:async()=>{await barrier;return {status:200,data:{}};}
}).call(mutable);
mutable.operation='not-allowlisted';
release();
await denyAsync(()=>pending);
// Codex P2 regressions: never accept partial or invalid inventories.
for(const volumes of [
 [null,42,{}],
 [{Name:null}],
 [{Name:''}],
 [{Name:'known'},{Name:'known'}],
 new Array(1),
 [,{Name:'known'}]
]) await denyAsync(()=>fake({status:200,data:{Volumes:volumes,Warnings:[]}})
  .call({operation:'listVolumes'}));
for(const containers of [
 new Array(1),
 [,{Id:id}],
 [null],
 [{Id:id},{Id:id}],
 [{Id:'wrong'}]
]) await denyAsync(()=>fake({status:200,data:containers})
  .call({operation:'listContainers'}));
const volumeSparse=[{Name:'good'},{Name:'second'}];
delete volumeSparse[0];
await denyAsync(()=>fake({status:200,data:{Volumes:volumeSparse,Warnings:[]}})
  .call({operation:'listVolumes'}));
const containerSparse=[{Id:id},{Id:'c'.repeat(64)}];
delete containerSparse[1];
await denyAsync(()=>fake({status:200,data:containerSparse})
  .call({operation:'listContainers'}));
assert.deepEqual(await fake({status:200,data:{Volumes:[{Name:'valid'}],Warnings:[]}})
 .call({operation:'listVolumes'}),{Volumes:[{Name:'valid'}],Warnings:[]});
assert.deepEqual(await fake({status:200,data:[{Id:id}]})
 .call({operation:'listContainers'}),[{Id:id}]);
// Adversarial serialization: toJSON must not replace or mutate validated identities.
await denyAsync(()=>fake({status:200,data:[{Id:id,toJSON(){return null;}}]})
 .call({operation:'listContainers'}));
await denyAsync(()=>fake({status:200,data:{Volumes:[
 {Name:'valid',toJSON(){return {Name:null};}}
],Warnings:[]}}).call({operation:'listVolumes'}));
await denyAsync(()=>fake({status:200,data:[{
 Id:id,toJSON(){return {Id:'c'.repeat(64)};}
}]}).call({operation:'listContainers'}));
await denyAsync(()=>fake({status:200,data:{Volumes:[
 {Name:'valid',toJSON(){return {Name:'changed'};}}
],Warnings:[]}}).call({operation:'listVolumes'}));
// Codex: getters must never change the operation, endpoint, or validated ID.
let getterReads=0;
const getterId={operation:'startContainer'};
Object.defineProperty(getterId,'id',{enumerable:true,get(){getterReads++;
 return getterReads===1?id:id+'/exec?ignored=';}});
deny(()=>buildIssue49D2Request(getterId));
const getterOperation={};
let opReads=0;
Object.defineProperty(getterOperation,'operation',{enumerable:true,get(){
 return ++opReads===1?'unknown':'imageInspect';}});
await denyAsync(()=>fake({status:200,data:{}}).call(getterOperation));
const sameId='a'.repeat(64),otherId='b'.repeat(64);
await denyAsync(()=>fake({status:200,data:[{
 Id:sameId,toJSON(){this.Id=otherId;return {Id:otherId};}
}]}).call({operation:'listContainers'}));
await denyAsync(()=>fake({status:200,data:{Volumes:[{
 Name:'before',toJSON(){this.Name='after';return {Name:'after'};}
}],Warnings:[]}}).call({operation:'listVolumes'}));
// Truncation during serialization must never pass as an exhaustive inventory.
await denyAsync(()=>fake({status:200,data:{
 Volumes:[{Name:'kept'},{Name:'dropped'}],Warnings:[],
 toJSON(){return {Volumes:[{Name:'kept'}],Warnings:[]};}
}}).call({operation:'listVolumes'}));
const shortContainers=[{Id:id},{Id:'c'.repeat(64)}];
Object.setPrototypeOf(shortContainers,Object.assign(Object.create(Array.prototype),{
 toJSON(){return [{Id:id}];}
}));
await denyAsync(()=>fake({status:200,data:shortContainers})
 .call({operation:'listContainers'}));
// Codex P2: accessors in inventory parent/array may change count and identity.
let volumeReads=0;
const flippingVolumes={Warnings:[]};
Object.defineProperty(flippingVolumes,'Volumes',{enumerable:true,get(){
 return ++volumeReads<=6?[{Name:'kept'},{Name:'dropped'}]:[{Name:'kept'}];
}});
await denyAsync(()=>fake({status:200,data:flippingVolumes})
 .call({operation:'listVolumes'}));
const getterWarnings={Volumes:[{Name:'kept'}]};
Object.defineProperty(getterWarnings,'Warnings',{enumerable:true,get(){
 return [];
}});
await denyAsync(()=>fake({status:200,data:getterWarnings})
 .call({operation:'listVolumes'}));
const indexedContainers=[{Id:id}];
Object.defineProperty(indexedContainers,0,{enumerable:true,configurable:true,
 get(){return {Id:id};}});
await denyAsync(()=>fake({status:200,data:indexedContainers})
 .call({operation:'listContainers'}));
const indexedVolumes=[{Name:'kept'}];
Object.defineProperty(indexedVolumes,0,{enumerable:true,configurable:true,
 get(){return {Name:'kept'};}});
await denyAsync(()=>fake({status:200,data:{Volumes:indexedVolumes,Warnings:[]}})
 .call({operation:'listVolumes'}));
// Codex: inherited getters must not run during identity validation.
const inheritedVolumes=[{Name:'first'},{Name:'second'}];
const inheritedVolume=Object.create(Object.create(null,{
 Name:{get(){inheritedVolumes.length=1;return 'first';},configurable:true}
}));
inheritedVolumes[0]=inheritedVolume;
await denyAsync(()=>fake({status:200,data:{Volumes:inheritedVolumes,Warnings:[]}})
 .call({operation:'listVolumes'}));
const inheritedContainers=[{Id:id},{Id:'c'.repeat(64)}];
const inheritedContainer=Object.create(Object.create(null,{
 Id:{get(){inheritedContainers.length=1;return id;},configurable:true}
}));
inheritedContainers[0]=inheritedContainer;
await denyAsync(()=>fake({status:200,data:inheritedContainers})
 .call({operation:'listContainers'}));
console.log('PASS ISSUE49 D2 MOCK NEGATIVES ('+negatives+' adversarial cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2: FAKE_ONLY / NO_GO_HOSTED_MIGRATION');
