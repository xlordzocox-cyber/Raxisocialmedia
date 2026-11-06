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
console.log('PASS ISSUE49 D2 MOCK NEGATIVES ('+negatives+' adversarial cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2: FAKE_ONLY / NO_GO_HOSTED_MIGRATION');
