// Issue #49 M0: FAKE-ONLY migration readiness audit. NO sockets/Docker/SQL/network.
import {strict as assert} from 'node:assert';
import {buildIssue49D2Request as oldRequest,ISSUE49_D2_IMAGE_ID as PIN}
 from './issue49-d2-engine-api-mock.mjs';
import {issue49RawV2JsonFixture as rawJson,issue49RawV2BinaryFixture as rawBinary,
 issue49RawV2Check as rawCheck}
 from './issue49-d2-raw-v2-mock.mjs';
const id='a'.repeat(64),sessionId='a'.repeat(24),execId='b'.repeat(64);
const scenarios=[
 ['ping',{operation:'ping'},'GET','/_ping',200,'RAW_PING_FORMAT_INCOMPATIBLE'],
 ['version',{operation:'version'},'GET','/version',200,'RAW_UNSUPPORTED'],
 ['info',{operation:'info'},'GET','/info',200,'RAW_PARTIAL'],
 ['imageInspect',{operation:'imageInspect',imageId:PIN},'GET','/images/',200,'RAW_UNSUPPORTED'],
 ['listVolumes',{operation:'listVolumes'},'GET','/volumes',200,'RAW_PARTIAL'],
 ['listContainers',{operation:'listContainers'},'GET','/containers/json?',200,'RAW_PARTIAL'],
 ['inspectContainer',{operation:'inspectContainer',id},'GET','/containers/',200,'RAW_UNSUPPORTED'],
 ['createContainer',{operation:'createContainer',sessionId,role:'T0_SOURCE',imageId:PIN},'POST','/containers/create?',201,'RAW_UNSUPPORTED'],
 ['startContainer',{operation:'startContainer',id},'POST','/start',204,'RAW_PARTIAL'],
 ['deleteContainer',{operation:'deleteContainer',id},'DELETE','?force=1&v=1',204,'RAW_PARTIAL'],
 ['createExec',{operation:'createExec',id,commandKey:'READY_TCP'},'POST','/exec',201,'RAW_UNSUPPORTED'],
 ['inspectExec',{operation:'inspectExec',id:execId},'GET','/exec/',200,'RAW_PARTIAL'],
 ['startExec',{operation:'startExec',id:execId},'POST','/start',200,'RAW_BLOCKED']
];
const unique=new Set(scenarios.map(x=>x[0]));
assert.equal(scenarios.length,13);assert.equal(unique.size,13);
let audited=0;
for(const [operation,input,method,fragment,status,classification] of scenarios){
 const r=oldRequest(input); // Constructed only, never sent anywhere.
 assert.equal(r.method,method,operation);assert.equal(r.expect,status,operation);
 assert.ok(r.path.startsWith('/v1.51/')&&r.path.includes(fragment),operation);
 assert.equal(input.operation,operation);
 assert.ok(classification.startsWith('RAW_'));audited++;
}
const json=(status,text)=>rawJson(status,text);
assert.deepEqual(rawCheck(json(200,'[]'),'listContainers',200),[]);
assert.deepEqual(rawCheck(json(200,'{"Volumes":[],"Warnings":[]}'),'listVolumes',200),
 {Volumes:[],Warnings:[]});
assert.equal(rawCheck(json(200,'{"ID":"abcd","OSType":"linux"}'),'info',200).ID,'abcd');
assert.equal(rawCheck(json(200,'{"Running":false,"ExitCode":0}'),'inspectExec',200).ExitCode,0);
assert.equal(rawCheck(json(200,'"OK"'),'ping',200),true);
assert.throws(()=>rawCheck(json(200,'OK'),'ping',200),/ISSUE49 D2 RAW V2 STOP/);
assert.throws(()=>rawCheck(rawBinary(200,'5b5d'),'startExec',200),/ISSUE49 D2 RAW V2 STOP/);
for(const operation of ['version','imageInspect','inspectContainer','createContainer','createExec']){
 assert.throws(()=>rawCheck(json(200,'{}'),operation,200),/ISSUE49 D2 RAW V2 STOP/);
}
const counts=scenarios.reduce((out,s)=>{out[s[5]]=(out[s[5]]||0)+1;return out;},{});
assert.deepEqual(counts,{RAW_PING_FORMAT_INCOMPATIBLE:1,RAW_UNSUPPORTED:5,RAW_PARTIAL:6,RAW_BLOCKED:1});
console.log('PASS ISSUE49 D2 M0: 13/13 legacy request descriptors audited offline');
console.log('PASS ISSUE49 D2 M0: RAW v2 gaps identified, ping incompatibility reproduced');
console.log('ISSUE49 D2 M0: NOT_READY_FOR_MIGRATION / FAKE_ONLY / NO_GO_HOSTED_MIGRATION');
