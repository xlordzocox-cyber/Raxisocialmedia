// M3 simulated identity/exit correlation tests; NO Docker/network/SQL.
import {strict as assert} from 'node:assert';
import {issue49RawM2BinaryFixture as binary,issue49RawM2JsonFixture as json}
  from './issue49-d2-raw-m2-binary-mock.mjs';
import {issue49RawM3CreateSession as create,issue49RawM3AcceptStart as start,
  issue49RawM3InspectExit as inspect,ISSUE49_RAW_M3_STATUS}
  from './issue49-d2-raw-m3-exec-correlation-mock.mjs';
const A='a'.repeat(64),B='b'.repeat(64);
const enc=xs=>xs.map(v=>v.toString(16).padStart(2,'0')).join('');
const frame=(kind,data)=>[kind,0,0,0,0,0,0,data.length,...data];
const created=id=>json(201,JSON.stringify({Id:id}));
const stream=bytes=>binary(200,enc(bytes));
const ended=(id,running=false,exit=0)=>json(200,JSON.stringify({ID:id,Running:running,ExitCode:exit}));
const goodStream=()=>stream([...frame(1,[0,255]),...frame(2,[65])]);
const session=()=>create(created(A));
let negatives=0;
const deny=fn=>{assert.throws(fn,/ISSUE49 D2 (?:M3|RAW V2) STOP/);negatives++;};
const s=session();
assert.equal(start(s,goodStream()).executionConfirmed,false);
const result=inspect(s,ended(A));
assert.equal(result.execId,A);
assert.equal(result.streamValidated,true);
assert.equal(result.simulatedExitValidated,true);
assert.equal(result.executionConfirmed,false);
assert.equal(result.source,'FAKE_ONLY');
assert.equal(result.frames,2);
assert.deepEqual(Array.from(result.stdout),[0,255]);
assert.deepEqual(Array.from(result.stderr),[65]);
result.stdout[0]=123;
const empty=session();start(empty,stream([]));
assert.equal(inspect(empty,ended(A)).frames,0);
deny(()=>create(created(B.toUpperCase())));
deny(()=>create(json(201,'{}')));
deny(()=>create(json(201,JSON.stringify({Id:A.slice(1)}))));
deny(()=>create(json(200,JSON.stringify({Id:A}))));
deny(()=>create({}));
deny(()=>start({},goodStream()));
deny(()=>inspect({},ended(A)));
deny(()=>start(null,goodStream()));
const before=session();deny(()=>inspect(before,ended(A)));
deny(()=>start(before,goodStream())); // premature inspect poisons session forever
const repeated=session();start(repeated,goodStream());deny(()=>start(repeated,goodStream()));
deny(()=>inspect(repeated,ended(A))); // repeated start poisons pending inspection
const replay=session();start(replay,goodStream());inspect(replay,ended(A));deny(()=>inspect(replay,ended(A)));
deny(()=>start(replay,goodStream())); // replay cannot revive completed session
const mismatch=session();start(mismatch,goodStream());deny(()=>inspect(mismatch,ended(B)));
deny(()=>inspect(mismatch,ended(A)));
const missing=session();start(missing,goodStream());
deny(()=>inspect(missing,json(200,'{"Running":false,"ExitCode":0}')));
const wrongCase=session();start(wrongCase,goodStream());
deny(()=>inspect(wrongCase,json(200,JSON.stringify({Id:A,Running:false,ExitCode:0}))));
const running=session();start(running,goodStream());deny(()=>inspect(running,ended(A,true,0)));
const exitNonzero=session();start(exitNonzero,goodStream());deny(()=>inspect(exitNonzero,ended(A,false,1)));
const exitNull=session();start(exitNull,goodStream());
deny(()=>inspect(exitNull,json(200,JSON.stringify({ID:A,Running:false,ExitCode:null}))));
const unstarted=session();deny(()=>inspect(unstarted,ended(B)));
deny(()=>inspect(unstarted,ended(A))); // premature inspection cannot retry
const malformed=session();deny(()=>start(malformed,stream([1,0,0])));
deny(()=>start(malformed,goodStream()));
const failStatus=session();deny(()=>start(failStatus,binary(500,enc(frame(1,[1])))));
const wrongInspectStatus=session();start(wrongInspectStatus,goodStream());
deny(()=>inspect(wrongInspectStatus,json(201,JSON.stringify({ID:A,Running:false,ExitCode:0}))));
const other=create(created(B));start(other,goodStream());deny(()=>inspect(other,ended(A)));
let calls=0;const poison=new Proxy({},{get(){calls++;throw Error('getter');}});
deny(()=>create(poison));assert.equal(calls,0);
const fake=session();deny(()=>start(fake,poison));assert.equal(calls,0);
const noPostStartInspect=session();deny(()=>inspect(noPostStartInspect,poison));assert.equal(calls,0);
assert.equal(ISSUE49_RAW_M3_STATUS,'FAKE_ONLY_NOT_INTEGRATED_NO_GO_HOSTED_MIGRATION');
console.log('PASS ISSUE49 D2 M3: immutable exec ID and final exit, still NOT real execution');
console.log('PASS ISSUE49 D2 M3 NEGATIVES ('+negatives+' simulated cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2 M3: FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION');
