// Issue49 D2 RAW v2 offline-only tests. No Docker, network, socket, SQL.
import {strict as assert} from 'node:assert';
import {issue49RawV2JsonFixture as json,issue49RawV2BinaryFixture as binary,
 issue49RawV2Check as check} from './issue49-d2-raw-v2-mock.mjs';
const id='a'.repeat(64),other='b'.repeat(64);
let denied=0;
const reject=fn=>{assert.throws(fn,/ISSUE49 D2 RAW V2 STOP/);denied++;};
const run=(op,text,expected=200)=>check(json(expected,text),op,expected);
assert.deepEqual(run('listContainers','[{"Id":"'+id+'"},{"Id":"'+other+'"}]'),
 [{Id:id},{Id:other}]);
assert.deepEqual(run('listVolumes','{"Volumes":[{"Name":"vol1"}],"Warnings":[]}'),
 {Volumes:[{Name:'vol1'}],Warnings:[]});
assert.equal(run('ping','"OK"'),true);
assert.deepEqual(run('listVolumes','{"Volumes":[],"Warnings":null}'),
 {Volumes:[],Warnings:null});
assert.equal(run('inspectExec','{"Running":false,"ExitCode":0}').ExitCode,0);
// Ambiguous JSON is forbidden at every object depth, including decoded escape aliases.
for(const body of [
 '{"Volumes":[],"Warnings":["incomplete"],"Warnings":[]}',
 '{"Volumes":[{"Name":"a","Name":"b"}],"Warnings":[]}',
 '{"Volumes":[],"\\u0057arnings":["partial"],"Warnings":[]}',
 '[{"Id":"'+id+'","Id":"'+other+'"}]',
 '{"outer":{"x":1,"x":2}}',
 '{"x":1,"\\u0078":2}',
 '{"x":1,"x":2}',
 '{"x":1,"x":2,"other":3}',
 '{"Volumes":[],"Volumes":[{"Name":"missing"}],"Warnings":[]}'
])reject(()=>run('listVolumes',body));
for(const body of ['','[] garbage','{"x":','{bad}','[1,]','{"a":1,}','{"a":01}',
 '{"a":-}','{"a":1e}','{"a":"\\uZZZZ"}','{"a":"\\x"}','[true false]',
 '"unterminated','{"a":"\t"}','{"Volumes":[],"Warnings":[],"x":NaN}'])
 reject(()=>run('listVolumes',body));
for(const body of [
 '[null]', '[{"Id":null}]','[{"Id":"invalid"}]',
 '[{"Id":"'+id+'"},{"Id":"'+id+'"}]',
 '{"containers":[]}'
]) reject(()=>run('listContainers',body));
for(const body of [
 '{"Volumes":[null],"Warnings":[]}',
 '{"Volumes":[{"Name":null}],"Warnings":[]}',
 '{"Volumes":[{"Name":""}],"Warnings":[]}',
 '{"Volumes":[{"Name":"v"},{"Name":"v"}],"Warnings":[]}',
 '{"Volumes":[],"Warnings":["plugin offline"]}',
 '{"Volumes":[],"Warnings":"bad"}',
 '{"Volumes":[]}',
 '{"Volumes":[],"Warnings":[],"Warnings":["error"]}'
]) reject(()=>run('listVolumes',body));
// Never inspect client-controlled object fields or their prototype: tokens are opaque WeakMap keys.
let triggered=0;
const active=new Proxy({status:200,bodyBytes:new Uint8Array([91,93])},{
 get(){triggered++;return null;},
 getPrototypeOf(){triggered++;return Object.prototype;},
 getOwnPropertyDescriptor(){triggered++;return undefined;},
 ownKeys(){triggered++;return [];}
});
reject(()=>check(active,'listContainers',200));
assert.equal(triggered,0);
const forged=Object.create(null);
reject(()=>check(forged,'listContainers',200));
reject(()=>check({status:200,bodyBytes:[]},'listContainers',200));
reject(()=>json(200,new Uint8Array([91,93])));
reject(()=>json(200,new String('[]')));
reject(()=>binary(200,'zz'));
reject(()=>binary(200,'f'));
reject(()=>binary(200,[]));
reject(()=>check(binary(200,'5b5d'),'startExec',200));
reject(()=>check(json(200,'[]'),'unknown',200));
reject(()=>check(json(204,'[]'),'listContainers',200));
reject(()=>run('ping','"FAIL"'));
reject(()=>run('inspectExec','{"Running":true,"ExitCode":0}'));
const two=json(200,'[{"Id":"'+id+'"},{"Id":"'+other+'"}]');
const proxy=new Proxy(two,{get(){triggered++;return undefined;}});
reject(()=>check(proxy,'listContainers',200));
assert.equal(triggered,0);
const accidentalGetter={toJSON(){throw new Error('active object executed');}};
reject(()=>json(200,accidentalGetter));
const payload=json(200,'[]');
assert.deepEqual(check(payload,'listContainers',200),[]);
console.log('PASS ISSUE49 D2 RAW V2: opaque internal owned bytes and strict duplicate JSON keys');
console.log('PASS ISSUE49 D2 RAW V2 NEGATIVES ('+denied+' adversarial cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2 RAW V2: PROTOTYPE_ONLY / NO_GO_HOSTED_MIGRATION');
