// Issue #49 M0: FAKE-ONLY migration readiness audit. NO sockets/Docker/SQL/network.
import {strict as assert} from 'node:assert';
import {buildIssue49D2Request as oldRequest,ISSUE49_D2_IMAGE_ID as PIN}
 from './issue49-d2-engine-api-mock.mjs';
import {issue49RawV2JsonFixture as rawJson,issue49RawV2BinaryFixture as rawBinary,
 issue49RawV2Check as rawCheck}
 from './issue49-d2-raw-v2-mock.mjs';
const id='a'.repeat(64),sessionId='a'.repeat(24),execId='b'.repeat(64);
// Independent expectations: literal complete paths, HTTP statuses and request bodies.
const EXPECTED_PIN='sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
assert.equal(PIN,EXPECTED_PIN,'approved image digest must not drift');
const createBody={
 Image:EXPECTED_PIN,Labels:{'raxi.issue49.owner':'raxi.issue49.trial.'+sessionId},
 Env:['POSTGRES_HOST_AUTH_METHOD=trust'],Tty:false,AttachStdin:false,
 AttachStdout:false,AttachStderr:false,OpenStdin:false,
 HostConfig:{NetworkMode:'none',Privileged:false,PublishAllPorts:false,
  PortBindings:{},Binds:[],AutoRemove:false,RestartPolicy:{Name:'no'}}
};
const execBody={AttachStdin:false,AttachStdout:true,AttachStderr:true,
 Tty:false,Privileged:false,
 Cmd:['pg_isready','-h','127.0.0.1','-p','5432','-U','postgres']};
const scenarios=[
 ['ping',{operation:'ping'},'GET','/v1.51/_ping',null,200,'RAW_PING_FORMAT_INCOMPATIBLE'],
 ['version',{operation:'version'},'GET','/v1.51/version',null,200,'RAW_UNSUPPORTED'],
 ['info',{operation:'info'},'GET','/v1.51/info',null,200,'RAW_PARTIAL'],
 ['imageInspect',{operation:'imageInspect',imageId:PIN},'GET',
  '/v1.51/images/'+EXPECTED_PIN+'/json',null,200,'RAW_UNSUPPORTED'],
 ['listVolumes',{operation:'listVolumes'},'GET','/v1.51/volumes',null,200,'RAW_PARTIAL'],
 ['listContainers',{operation:'listContainers'},'GET',
  '/v1.51/containers/json?all=1',null,200,'RAW_PARTIAL'],
 ['inspectContainer',{operation:'inspectContainer',id},'GET',
  '/v1.51/containers/'+id+'/json',null,200,'RAW_UNSUPPORTED'],
 ['createContainer',{operation:'createContainer',sessionId,role:'T0_SOURCE',imageId:PIN},'POST',
  '/v1.51/containers/create?name=raxi-t0t1-'+sessionId+'-t0-source',
  createBody,201,'RAW_UNSUPPORTED'],
 ['startContainer',{operation:'startContainer',id},'POST',
  '/v1.51/containers/'+id+'/start',{},204,'RAW_PARTIAL'],
 ['deleteContainer',{operation:'deleteContainer',id},'DELETE',
  '/v1.51/containers/'+id+'?force=1&v=1',null,204,'RAW_PARTIAL'],
 ['createExec',{operation:'createExec',id,commandKey:'READY_TCP'},'POST',
  '/v1.51/containers/'+id+'/exec',execBody,201,'RAW_UNSUPPORTED'],
 ['inspectExec',{operation:'inspectExec',id:execId},'GET',
  '/v1.51/exec/'+execId+'/json',null,200,'RAW_PARTIAL'],
 ['startExec',{operation:'startExec',id:execId},'POST',
  '/v1.51/exec/'+execId+'/start',{Detach:false,Tty:false},200,'RAW_BLOCKED']
];
const unique=new Set(scenarios.map(x=>x[0]));
assert.equal(scenarios.length,13);assert.equal(unique.size,13);
let audited=0;
for(const [operation,input,method,path,body,status,classification] of scenarios){
 const r=oldRequest(input); // Constructed only, never sent anywhere.
 assert.equal(r.method,method,operation+' method');
 assert.equal(r.expect,status,operation+' expected status');
 assert.equal(r.path,path,operation+' FULL path');
 assert.deepEqual(r.body,body,operation+' COMPLETE body');
 assert.equal(input.operation,operation);
 assert.ok(classification.startsWith('RAW_'));audited++;
}
assert.equal(audited,13);
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
const counts=scenarios.reduce((out,s)=>{out[s[6]]=(out[s[6]]||0)+1;return out;},{});
assert.deepEqual(counts,{RAW_PING_FORMAT_INCOMPATIBLE:1,RAW_UNSUPPORTED:5,RAW_PARTIAL:6,RAW_BLOCKED:1});
console.log('PASS ISSUE49 D2 M0: 13/13 legacy request descriptors audited offline');
console.log('PASS ISSUE49 D2 M0: RAW v2 gaps identified, ping incompatibility reproduced');
console.log('ISSUE49 D2 M0: NOT_READY_FOR_MIGRATION / FAKE_ONLY / NO_GO_HOSTED_MIGRATION');
