// Issue49 D2 M4: no Docker, socket, SQL, subprocess or network.
import {strict as assert} from 'node:assert';
import {issue49RawM2JsonFixture as json,issue49RawM2BinaryFixture as binary}
 from './issue49-d2-raw-m2-binary-mock.mjs';
import {issue49M4Begin as begin,issue49M4NextRequest as next,
 issue49M4DescribeRequest as describe,issue49M4FakeReceipt as fake,
 issue49M4Consume as consume,ISSUE49_M4_STATUS}
 from './issue49-d2-raw-m4-request-binding-mock.mjs';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const replyCreate=id=>json(201,JSON.stringify({Id:id}));
const replyExit=id=>json(200,JSON.stringify({ID:id,Running:false,ExitCode:0}));
const replyStart=()=>binary(200,'010000000000000200ff020000000000000141');
let negatives=0;
const deny=f=>{assert.throws(f,/ISSUE49 D2 (?:M4|M3|RAW V2|MOCK) STOP/);negatives++;};
const init=()=>begin(A);
const ready=(trial,id=B)=>{
 const create=next(trial),d=describe(create);
 assert.equal(d.method,'POST');
 assert.equal(d.path,'/v1.51/containers/'+A+'/exec');
 assert.equal(d.expect,201);
 assert.equal(d.body.Tty,false);
 const receipt=fake(create,replyCreate(id));
 assert.equal(consume(trial,create,receipt).phase,'created');
 return {trial,create,receipt};
};
const started=(trial,id=B)=>{
 ready(trial,id);
 const request=next(trial),d=describe(request);
 assert.equal(d.path,'/v1.51/exec/'+id+'/start');
 assert.equal(d.body.Tty,false);
 assert.equal(consume(trial,request,fake(request,replyStart())).phase,'started');
 return trial;
};
const trial=started(init());
const inspect=next(trial);
assert.equal(describe(inspect).path,'/v1.51/exec/'+B+'/json');
const result=consume(trial,inspect,fake(inspect,replyExit(B)));
assert.equal(result.execId,B);
assert.equal(result.simulatedExitValidated,true);
assert.equal(result.executionConfirmed,false);
assert.deepEqual([...result.stdout],[0,255]);
assert.deepEqual([...result.stderr],[65]);
deny(()=>begin('X'.repeat(64)));
deny(()=>begin(null));
deny(()=>next({}));
deny(()=>describe({}));
deny(()=>fake({},replyStart()));
deny(()=>consume({}, {}, {}));
deny(()=>next(trial));
deny(()=>consume(trial,inspect,fake(inspect,replyExit(B))));
const duplicate=init();const pending=next(duplicate);
deny(()=>next(duplicate));deny(()=>consume(duplicate,pending,fake(pending,replyCreate(B))));
const switched1=init(),switched2=init(),a=next(switched1),b=next(switched2);
const ar=fake(a,replyCreate(B)),br=fake(b,replyCreate(C));
deny(()=>consume(switched1,b,br));
deny(()=>consume(switched1,a,ar));
deny(()=>consume(switched2,b,ar));
deny(()=>consume(switched2,b,br));
const dup=init(),req=next(dup),receipt=fake(req,replyCreate(B));
consume(dup,req,receipt);
deny(()=>fake(req,replyCreate(B)));
deny(()=>consume(dup,req,receipt));
const invalidFixture=init(),badReq=next(invalidFixture);
deny(()=>fake(badReq,replyExit(B)));
const malformed=init(),mr=next(malformed);
deny(()=>fake(mr,json(201,'{}'))); // malformed mock receipt rejected at source
deny(()=>next(malformed)); // duplicate pending request poisons trial
const mismatch=started(init());
const ir=next(mismatch);
deny(()=>consume(mismatch,ir,fake(ir,replyExit(C))));
deny(()=>next(mismatch));
const badStart=ready(init()).trial,bs=next(badStart);
deny(()=>fake(bs,json(200,'{}')));
deny(()=>consume(badStart,bs,fake(bs,binary(200,'0100'))));
deny(()=>next(badStart));
const swappedPhase=started(init()),si=next(swappedPhase);
const another=started(init()),ai=next(another);
deny(()=>consume(swappedPhase,si,fake(ai,replyExit(B))));
deny(()=>consume(swappedPhase,si,fake(si,replyExit(B))));
deny(()=>consume(another,ai,fake(si,replyExit(B))));
const empty=started(init()),ei=next(empty);
assert.equal(consume(empty,ei,fake(ei,replyExit(B))).executionConfirmed,false);
const wrongHttp=init(),wh=next(wrongHttp);
deny(()=>fake(wh,json(200,JSON.stringify({Id:B}))));
const badToken=init(),bt=next(badToken);
let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error('unexpected proxy get');}});
deny(()=>fake(bt,proxy));assert.equal(traps,0);
deny(()=>consume(badToken,bt,proxy));assert.equal(traps,0);
const actual=describe(bt);actual.path='/wrong';actual.body.Cmd.push('bad');
assert.equal(describe(bt).path,'/v1.51/containers/'+A+'/exec');
assert.deepEqual(describe(bt).body.Cmd,['pg_isready','-h','127.0.0.1','-p','5432','-U','postgres']);
assert.equal(ISSUE49_M4_STATUS,'FAKE_ONLY_NOT_INTEGRATED_NO_GO_HOSTED_MIGRATION');
console.log('PASS ISSUE49 D2 M4: mock request/reply correlation, execution NOT confirmed');
console.log('PASS ISSUE49 D2 M4 NEGATIVES ('+negatives+' simulated cases; no Docker/socket/SQL)');
console.log('ISSUE49 D2 M4: FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION');
