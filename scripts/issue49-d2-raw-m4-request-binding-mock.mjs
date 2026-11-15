// Issue49 D2 M4 — mock-only request/reply provenance and exec-ID route binding.
// No transport / Docker / socket / HTTP / SQL. Nothing here authenticates real I/O.
import {buildIssue49D2Request} from './issue49-d2-engine-api-mock.mjs';
import {issue49RawM2Check as check} from './issue49-d2-raw-m2-binary-mock.mjs';
import {issue49RawM3CreateSession as createSession,
 issue49RawM3AcceptStart as startSession,
 issue49RawM3InspectExit as inspectSession}
 from './issue49-d2-raw-m3-exec-correlation-mock.mjs';
const STOP=why=>{throw Error('ISSUE49 D2 M4 STOP: '+why);};
const ID=/^[a-f0-9]{64}$/;
const trials=new WeakMap(), requests=new WeakMap(), receipts=new WeakMap();
const get=(map,token,what)=>{
 if((token===null||typeof token!=='object')||!map.has(token))STOP('untrusted '+what);
 return map.get(token);
};
const token=()=>Object.freeze(Object.create(null));
const phaseOp=phase=>({new:'createExec',created:'startExec',started:'inspectExec'})[phase];
const copyDescriptor=d=>Object.freeze({method:d.method,path:d.path,expect:d.expect,
 body:d.body===null?null:JSON.parse(JSON.stringify(d.body))});
export function issue49M4Begin(containerId){
 if(typeof containerId!=='string'||!ID.test(containerId))STOP('invalid container identity');
 const trial=token();
 trials.set(trial,{containerId,execId:null,session:null,phase:'new',pending:null});
 return trial;
}
// Generates only requests using the pinned M0 descriptors, never caller paths.
export function issue49M4NextRequest(trial){
 const st=get(trials,trial,'trial');
 if(st.pending||!phaseOp(st.phase)){
  st.phase='failed'; STOP('invalid request phase or duplicated request');
 }
 const op=phaseOp(st.phase),id=op==='createExec'?st.containerId:st.execId;
 const input=op==='createExec'?{operation:op,id,commandKey:'READY_TCP'}:{operation:op,id};
 const d=buildIssue49D2Request(input);
 const request=token();
 requests.set(request,{trial,op,id,descriptor:copyDescriptor(d),used:false});
 st.pending=request;
 return request;
}
export function issue49M4DescribeRequest(request){
 const r=get(requests,request,'request');
 return copyDescriptor(r.descriptor);
}
// FAKE SOURCE ONLY. Caller can fabricate fixtures; this is NOT an I/O attestation.
export function issue49M4FakeReceipt(request,fixture){
 const r=get(requests,request,'request');
 if(r.used)STOP('request already consumed');
 // Validate by private M2 fixture provenance and pinned status/operation.
 check(fixture,r.op,r.descriptor.expect);
 const receipt=token();
 receipts.set(receipt,{request,fixture,used:false});
 return receipt;
}
// Permanently poisons trial on any rejected consume; no retry/replay.
export function issue49M4Consume(trial,request,receipt){
 const st=get(trials,trial,'trial');
 if(st.phase==='finished'||st.phase==='failed')STOP('terminal trial');
 const phase=st.phase;
 st.phase='failed';
 const r=get(requests,request,'request');
 const reply=get(receipts,receipt,'receipt');
 if(st.pending!==request||r.trial!==trial||r.used||reply.request!==request||reply.used||
    phaseOp(phase)!==r.op)STOP('swapped or replayed request/reply');
 // Mark one-use before any nested parse.
 r.used=true;reply.used=true;st.pending=null;
 if(r.op==='createExec'){
  const parsed=check(reply.fixture,'createExec',201);
  if(typeof parsed.Id!=='string'||!ID.test(parsed.Id))STOP('invalid created ID');
  st.session=createSession(reply.fixture);
  st.execId=parsed.Id;
  st.phase='created';
  return Object.freeze({phase:'created',source:'FAKE_ONLY',executionConfirmed:false});
 }
 if(st.execId!==r.id||!ID.test(r.id))STOP('exec identity drift');
 const pinned=buildIssue49D2Request({operation:r.op,id:r.id});
 if(pinned.method!==r.descriptor.method||pinned.path!==r.descriptor.path||
    pinned.expect!==r.descriptor.expect||JSON.stringify(pinned.body)!==
    JSON.stringify(r.descriptor.body))STOP('request descriptor drift');
 if(r.op==='startExec'){
  startSession(st.session,reply.fixture);
  st.phase='started';
  return Object.freeze({phase:'started',source:'FAKE_ONLY',executionConfirmed:false});
 }
 const result=inspectSession(st.session,reply.fixture);
 if(result.execId!==st.execId||result.executionConfirmed!==false)
  STOP('invalid completion identity');
 st.phase='finished';
 return result;
}
export const ISSUE49_M4_STATUS='FAKE_ONLY_NOT_INTEGRATED_NO_GO_HOSTED_MIGRATION';
