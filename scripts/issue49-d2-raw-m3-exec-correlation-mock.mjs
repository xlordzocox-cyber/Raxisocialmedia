// Issue #49 D2 M3: immutable exec-id correlation, FAKE_ONLY and NO_TRANSPORT.
// M2 owns trusted fixture bytes. No pipes, sockets, Docker or SQL.
import {issue49RawM2Check as check} from './issue49-d2-raw-m2-binary-mock.mjs';
const sessions=new WeakMap();
const STOP=reason=>{throw Error('ISSUE49 D2 M3 STOP: '+reason);};
const ID=/^[a-f0-9]{64}$/;
const validId=id=>typeof id==='string'&&ID.test(id);
const get=session=>{
  if(!sessions.has(session)) STOP('untrusted session');
  return sessions.get(session);
};
const output=state=>Object.freeze({
  execId:state.id,streamValidated:true,simulatedExitValidated:true,
  executionConfirmed:false,source:'FAKE_ONLY',
  stdout:new Uint8Array(state.stdout),stderr:new Uint8Array(state.stderr),
  frames:state.frames
});
// Session ID comes only from a validated, local createExec fixture.
export function issue49RawM3CreateSession(createExecToken){
  const created=check(createExecToken,'createExec',201);
  if(!validId(created.Id)) STOP('invalid created exec identity');
  const session=Object.freeze(Object.create(null));
  sessions.set(session,{id:created.Id,phase:'created',stdout:null,stderr:null,frames:0});
  return session;
}
// Every state transition is one-shot; any failure permanently invalidates it.
export function issue49RawM3AcceptStart(session,startExecToken){
  const state=get(session);
  if(state.phase!=='created') { state.phase='failed'; STOP('start out of order or replayed'); }
  state.phase='failed';
  const stream=check(startExecToken,'startExec',200);
  if(stream.streamValidated!==true||stream.executionConfirmed!==false)
    STOP('untrusted multiplex result');
  state.stdout=new Uint8Array(stream.stdout);
  state.stderr=new Uint8Array(stream.stderr);
  state.frames=stream.frames;
  state.phase='started';
  return Object.freeze({streamValidated:true,executionConfirmed:false,source:'FAKE_ONLY'});
}
export function issue49RawM3InspectExit(session,inspectExecToken){
  const state=get(session);
  if(state.phase!=='started') { state.phase='failed'; STOP('inspect out of order or replayed'); }
  state.phase='failed';
  const inspected=check(inspectExecToken,'inspectExec',200);
  // M2 requires Running:false and ExitCode:0; M3 requires exact ID.
  if(!validId(inspected.ID)||inspected.ID!==state.id)
    STOP('inspect exec ID mismatch or absent');
  if(inspected.Running!==false||inspected.ExitCode!==0)
    STOP('execution not cleanly terminated');
  state.phase='finished';
  // Valid mock inspection is not evidence of actual process execution.
  return output(state);
}
export const ISSUE49_RAW_M3_STATUS='FAKE_ONLY_NOT_INTEGRATED_NO_GO_HOSTED_MIGRATION';
