// Issue49 M1: offline-only parity candidate, no Docker/socket/SQL/network.
import {strict as assert} from 'node:assert';
import {issue49RawM1JsonFixture as json,issue49RawM1TextFixture as text,
 issue49RawM1BinaryFixture as binary,issue49RawM1Check as check,
 ISSUE49_RAW_M1_IMAGE_ID as PIN}
 from './issue49-d2-raw-m1-parity-mock.mjs';
let negatives=0;
const deny=fn=>{assert.throws(fn,/ISSUE49 D2 RAW V2 STOP/);negatives++;};
const id='a'.repeat(64),other='b'.repeat(64);
const run=(op,status,body)=>check(json(status,body),op,status);
assert.equal(check(text(200,'OK'),'ping',200),true);
assert.equal(run('version',200,'{"ApiVersion":"1.51","Version":"28.3.0"}').ApiVersion,'1.51');
assert.equal(run('imageInspect',200,JSON.stringify({
 Id:PIN,Os:'linux',Architecture:'amd64',Config:{Env:['PG_VERSION=17.11']}
})).Id,PIN);
assert.equal(run('inspectContainer',200,'{"Id":"'+id+'"}').Id,id);
assert.equal(run('createContainer',201,'{"Id":"'+id+'"}').Id,id);
assert.equal(run('createExec',201,'{"Id":"'+id+'"}').Id,id);
assert.deepEqual(run('listContainers',200,'[{"Id":"'+id+'"},{"Id":"'+other+'"}]'),
 [{Id:id},{Id:other}]);
assert.deepEqual(run('listVolumes',200,'{"Volumes":[{"Name":"v"}],"Warnings":[]}'),
 {Volumes:[{Name:'v'}],Warnings:[]});
assert.equal(check(binary(204,''),'startContainer',204),true);
assert.equal(check(binary(204,''),'deleteContainer',204),true);
assert.equal(run('inspectExec',200,'{"Running":false,"ExitCode":0}').ExitCode,0);
assert.equal(run('info',200,'{"ID":"abcd","OSType":"linux"}').OSType,'linux');
for(const bad of ['', 'NO', '"OK"', 'OK\n', 'ok', 'OK ', ' OK'])
 deny(()=>check(text(200,bad),'ping',200));
for(const bad of ['{}','{"ApiVersion":"1.51"}','{"ApiVersion":"2.1","Version":"v"}',
 '{"ApiVersion":null,"Version":"v"}','{"ApiVersion":"1.51","Version":""}',
 '{"ApiVersion":"1.51","ApiVersion":"1.52","Version":"v"}'])
 deny(()=>run('version',200,bad));
const goodImage=()=>({Id:PIN,Os:'linux',Architecture:'amd64',
 Config:{Env:['PG_VERSION=17.11']}});
for(const [field,value] of [['Id','wrong'],['Os','windows'],['Architecture','arm64'],
 ['Config',{Env:[]}],['Config',{Env:['PG_VERSION=17.11','PG_VERSION=17.11']}],
 ['Config',{Env:['PG_VERSION=18.0']}]]) {
 const image=goodImage();image[field]=value;
 deny(()=>run('imageInspect',200,JSON.stringify(image)));
}
for(const bad of ['{}','{"Id":"wrong"}','{"Id":null}',
 '{"Id":"'+id+'","Id":"'+other+'"}']) {
 for(const op of ['inspectContainer','createContainer','createExec'])
  deny(()=>run(op,op.startsWith('create')?201:200,bad));
}
deny(()=>run('listVolumes',200,'{"Volumes":[],"Warnings":["partial"]}'));
deny(()=>run('listContainers',200,'[{"Id":"'+id+'"},{"Id":"'+id+'"}]'));
deny(()=>check(binary(200,'0100000000000000'),'startExec',200));
deny(()=>check(json(204,'{}'),'startContainer',204));
deny(()=>check(json(200,'{"Running":true,"ExitCode":0}'),'inspectExec',200));
deny(()=>check(json(200,'{}'),'unknown',200));
deny(()=>check(text(500,'OK'),'ping',200));
// No active JS object input is used for a response; forged opaque tokens fail.
let traps=0;
const proxy=new Proxy({status:200,body:'OK'},{get(){traps++;return 'OK';}});
deny(()=>check(proxy,'ping',200));assert.equal(traps,0);
console.log('PASS ISSUE49 D2 M1: response parity candidate, plain-text ping and JSON schema');
console.log('PASS ISSUE49 D2 M1 NEGATIVES ('+negatives+' simulated cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2 M1: FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION');
