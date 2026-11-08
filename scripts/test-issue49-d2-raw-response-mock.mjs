// Pure offline D2 prototype tests; NO Docker/socket/SQL.
import {strict as assert} from 'node:assert';
import {parseIssue49D2RawResponse as parse} from './issue49-d2-raw-response-mock.mjs';
const encoder=new TextEncoder();
const json=x=>encoder.encode(JSON.stringify(x));
const res=bodyBytes=>({status:200,bodyBytes});
const run=(operation,bodyBytes)=>parse({operation,expectedStatus:200,response:res(bodyBytes)});
let negative=0;
const deny=fn=>{assert.throws(fn,/ISSUE49 D2 RAW STOP/);negative++;};
const id='a'.repeat(64),id2='b'.repeat(64);
assert.deepEqual(run('listContainers',json([{Id:id},{Id:id2}])),[{Id:id},{Id:id2}]);
assert.deepEqual(run('listVolumes',json({Volumes:[{Name:'v1'}],Warnings:[]})),
 {Volumes:[{Name:'v1'}],Warnings:[]});
assert.equal(run('ping',json('OK')),true);
assert.deepEqual(Array.from(run('startExec',Uint8Array.from([1,2,3]))),[1,2,3]);
for(const payload of [
 [{Id:id},{Id:id}], [null], [{Id:'invalid'}],
 {items:[{Id:id}]}, [null,{Id:id}], [{Id:null}]
])deny(()=>run('listContainers',json(payload)));
for(const payload of [
 {Volumes:[{Name:'v'},{Name:'v'}],Warnings:[]},
 {Volumes:[{Name:null}],Warnings:[]},
 {Volumes:[null],Warnings:[]},
 {Volumes:[{Name:'v'}],Warnings:['partial']},
 {Volumes:[],Warnings:'bad'},
 {Volumes:[]}
])deny(()=>run('listVolumes',json(payload)));
deny(()=>run('listContainers',Uint8Array.from([0xff])));
deny(()=>run('listContainers',encoder.encode('not-json')));
deny(()=>run('ping',json('NO')));
deny(()=>run('unknown',json({})));
deny(()=>parse({operation:'ping',expectedStatus:200,response:{status:200,data:'OK'}}));
deny(()=>parse({operation:'ping',expectedStatus:200,response:{status:500,bodyBytes:json('OK')}}));
let getterCalls=0;
const active={status:200};
Object.defineProperty(active,'bodyBytes',{enumerable:true,get(){getterCalls++;return json('OK');}});
deny(()=>parse({operation:'ping',expectedStatus:200,response:active}));
assert.equal(getterCalls,0);
const original=[{Id:id},{Id:id2}];
original.toJSON=function(){return [{Id:id}];};
assert.deepEqual(run('listContainers',json(original)),[{Id:id}]);
// A string of bytes is authoritative; hidden original JS identities are not reconstructible.
console.log('PASS ISSUE49 D2 RAW MOCK: serialized JSON / binary bytes isolated');
console.log('PASS ISSUE49 D2 RAW NEGATIVES ('+negative+' simulated adverse cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2 RAW: PROTOTYPE_ONLY / NO_GO_HOSTED_MIGRATION');
