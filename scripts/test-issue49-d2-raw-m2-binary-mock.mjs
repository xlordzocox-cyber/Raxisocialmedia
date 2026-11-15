// M2 fake-only multiplex tests. No Docker, SQL, sockets, files, or network.
import {strict as assert} from 'node:assert';
import {issue49RawM2BinaryFixture as binary,
 issue49RawM2Check as check,issue49RawM2JsonFixture as json}
 from './issue49-d2-raw-m2-binary-mock.mjs';
let negatives=0;
const deny=fn=>{assert.throws(fn,/ISSUE49 D2 RAW V2 STOP/);negatives++;};
const hex=xs=>xs.map(x=>x.toString(16).padStart(2,'0')).join('');
const frame=(channel,content)=>{
 const n=content.length;
 return [channel,0,0,0,(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255,...content];
};
const start=bytes=>check(binary(200,hex(bytes)),'startExec',200);
const first=frame(1,[0,1,255]),second=frame(2,[65,66]);
const out=start([...first,...second]);
assert.deepEqual(Array.from(out.stdout),[0,1,255]);
assert.deepEqual(Array.from(out.stderr),[65,66]);
assert.equal(out.frames,2);
assert.equal(out.streamValidated,true);
assert.equal(out.executionConfirmed,false);
assert.deepEqual(Array.from(start([]).stdout),[]);
assert.equal(start([]).frames,0);
assert.equal(start(frame(1,[])).frames,1);
assert.equal(start([...frame(2,[11]),...frame(1,[22]),...frame(2,[33])]).frames,3);
for(const wrong of [
 [1], [1,0,0,0], [1,0,0,0,0,0,0],
 [0,0,0,0,0,0,0,0],
 [3,0,0,0,0,0,0,0],
 [1,1,0,0,0,0,0,0],
 [1,0,1,0,0,0,0,0],
 [1,0,0,1,0,0,0,0],
 [1,0,0,0,0,0,0,2,9],
 [2,0,0,0,0,0,0,1],
 [1,0,0,0,255,255,255,255],
 [1,0,0,0,0,0,0,1],
 [...frame(1,[3]),1],
 [...frame(1,[3]),1,0,0,0,0,0,0,1]
])deny(()=>start(wrong));
const size=65537;
deny(()=>start(frame(2,Array(size).fill(0))));
deny(()=>start([...frame(2,Array(32768).fill(0)),...frame(2,Array(32769).fill(0))]));
deny(()=>start([...frame(1,[1]),...frame(2,Array(size).fill(0))]));
deny(()=>check(binary(500,hex(first)),'startExec',500));
deny(()=>check(binary(204,hex(first)),'startExec',204));
deny(()=>check(json(200,'{}'),'startExec',200)); // JSON-looking bytes lack framing
deny(()=>check(binary(200,hex(first)),'unknown',200));
deny(()=>check(binary(200,hex(first)),'inspectExec',200));
deny(()=>check(binary(200,hex(first)),'ping',200));
// independent exit inspection remains required, with no inferred success.
assert.equal(check(json(200,'{"Running":false,"ExitCode":0}'),'inspectExec',200).ExitCode,0);
deny(()=>check(json(200,'{"Running":true,"ExitCode":0}'),'inspectExec',200));
deny(()=>check(json(200,'{"Running":false,"ExitCode":1}'),'inspectExec',200));
let calls=0;
const proxy=new Proxy({status:200,data:hex(first)},{get(){calls++;return undefined;}});
deny(()=>check(proxy,'startExec',200));assert.equal(calls,0);
deny(()=>binary(200,'zz'));
deny(()=>binary(200,'0'));
deny(()=>binary(200,{}));
console.log('PASS ISSUE49 D2 M2: strict multiplex stdout/stderr; execution NOT confirmed');
console.log('PASS ISSUE49 D2 M2 NEGATIVES ('+negatives+' simulated cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2 M2: FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION');
