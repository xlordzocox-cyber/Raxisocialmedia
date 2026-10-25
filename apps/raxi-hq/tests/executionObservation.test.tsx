import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { AuthStore } from '../src/auth/authStore';
import { ProtectedRoute } from '../src/auth/AuthRoutes';
import { HQStore, hqStore } from '../src/store/hqStore';
import { codexCaptureText } from '../src/observation/codexCapture';
import { admitReviewedCapture, validateCaptureMetadata, projectReplay, OBSERVED_PROJECT, CAPTURE_SHA256, type ReviewedCapture } from '../src/observation/executionObservation';
import { AgentMotion, syncAgentMotions } from '../src/office/agents/agentMotion';
import { getStatusVisual } from '../src/office/agents/agentVisualState';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
Object.assign(globalThis, { window: { setInterval, clearInterval, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem: () => null, setItem() {} } } });
const scope = { viewerId: 'local-test-viewer', project: OBSERVED_PROJECT };
const metadata = () => JSON.parse(codexCaptureText);

test('authentic reviewed turn produces two frozen historical observations with native field references', async () => {
  const c = await admitReviewedCapture(codexCaptureText, scope);
  assert.equal(c.sha256, CAPTURE_SHA256); assert.equal(c.events.length, 2);
  assert.equal(c.runId, '01a1701c-eac4-77b3-9075-1abe7031876d');
  assert.match(c.events[0].originRef, /#startedAt$/); assert.match(c.events[1].originRef, /#completedAt$/);
  assert.ok(Object.isFrozen(c)); assert.ok(Object.isFrozen(c.events)); assert.ok(Object.isFrozen(c.events[0]));
});
test('modified evidence, whitespace replay and caller-invented digest cannot pass the reviewed pin', async () => {
  for (const text of [codexCaptureText+' ', codexCaptureText.replace('completed','failed'), '{}']) await assert.rejects(admitReviewedCapture(text, scope), /evidencia/);
});
for (const field of ['source','project','threadId','runId','executorId','mode','status','taskId','raxiAgentId']) {
  test(`metadata rejects unauthorized or invented ${field}`, () => {
    const m = metadata(); m[field] = 'invented'; assert.throws(() => validateCaptureMetadata(m));
  });
}
for (const state of ['waitingOnApproval','failed','inProgress','unknown']) test(`partial ${state} is not upgraded to a completed or current execution`, () => {
  const m=metadata(); m.status=state; assert.throws(() => validateCaptureMetadata(m));
});
test('unknown fields, duplicate timestamps, reversed ordering and invalid dates fail closed', () => {
  const extra=metadata(); extra.thoughts='not allowed'; assert.throws(() => validateCaptureMetadata(extra));
  for (const date of ['invalid', metadata().startedAt, '2020-01-01T00:00:00.000Z']) {
    const m=metadata(); m.completedAt=date; assert.throws(() => validateCaptureMetadata(m));
  }
});
test('scope rejects missing viewer and cross-project captures; forged projection cannot bypass admission', async () => {
  await assert.rejects(admitReviewedCapture(codexCaptureText,{...scope,viewerId:''}));
  await assert.rejects(admitReviewedCapture(codexCaptureText,{...scope,project:'other'}));
  assert.throws(() => projectReplay({ events: [] } as unknown as ReviewedCapture,0,scope), /admisión/);
});
test('historical avatar uses existing finite movement and returns to rest; no fake Raxi task or working animation', async () => {
  const c=await admitReviewedCapture(codexCaptureText,scope);
  const start=projectReplay(c,0,scope), end=projectReplay(c,1,scope);
  const agent=Object.values(start.agents)[0]; const motion=new AgentMotion(agent,0);
  motion.sync(agent); assert.equal(motion.walking,true); const initial={...motion.position};
  motion.update(100); assert.notDeepEqual(motion.position,initial);
  motion.update(100000); assert.equal(motion.atStation('GITHUB_HUB'),true);
  motion.sync(Object.values(end.agents)[0]); assert.equal(motion.walking,true);
  motion.update(100000); assert.equal(motion.atStation('WAR_ROOM'),true);
  const settled={...motion.position}; motion.update(100000); assert.deepEqual(motion.position,settled);
  assert.equal(agent.status,'HISTORICAL'); assert.equal(getStatusVisual(agent.status).animation,'idle');
  assert.equal(agent.role,'EXTERNAL_EXECUTOR'); assert.equal(agent.currentTaskId,undefined);
  assert.deepEqual(start.tasks,{}); assert.deepEqual(start.handoffs,[]);
  assert.equal(end.observation?.confirmed,'COMPLETED'); assert.equal(end.sourceHealth.connection,'DISCONNECTED');
  assert.equal(end.events.length,2); assert.equal(end.events[0].payload?.raxiAgentId,null);
});
test('no evidence means no avatar or movement; disconnect clears motions rather than running a demo', async () => {
  const store=new HQStore(); store.setObservationScope(scope); await store.switchMode('LIVE_READ_ONLY');
  assert.deepEqual(store.getSnapshot().agents,{});
  const motions=new Map<string,AgentMotion>();
  await store.loadHistoricalCapture(); syncAgentMotions(Object.values(store.getSnapshot().agents),motions,true); assert.equal(motions.size,1);
  await store.switchMode('LIVE_READ_ONLY'); syncAgentMotions(Object.values(store.getSnapshot().agents),motions,true);
  assert.equal(motions.size,0); assert.equal(store.getSnapshot().mockMode,false); store.stop();
});
test('manual advancement rejects repeated completion and never duplicates an event', async () => {
  const store=new HQStore(); store.setObservationScope(scope);
  assert.equal(await store.loadHistoricalCapture(),true);
  assert.equal(await store.loadHistoricalCapture(),false);
  assert.equal(store.nextHistoricalObservation(),true);
  assert.equal(store.nextHistoricalObservation(),false);
  assert.equal(store.getSnapshot().events.length,2); store.stop();
});
test('concurrent historical admissions publish one canonical start and no duplicate observations', async () => {
  const store=new HQStore(); store.setObservationScope(scope);
  assert.deepEqual(await Promise.all([store.loadHistoricalCapture(),store.loadHistoricalCapture()]),[false,true]);
  assert.equal(store.getSnapshot().events.length,1); store.stop();
});
test('an earlier live read cannot overwrite a historical source selected later', async () => {
  let resolve!: (status: { connection: 'DISCONNECTED' }) => void;
  const store=new HQStore({
    getSourceStatus:()=>new Promise(r=>{resolve=r;}),
    readAgents:async()=>[],readTasks:async()=>[],readEvents:async()=>[],
  });
  store.setObservationScope(scope); const reading=store.switchMode('LIVE_READ_ONLY');
  await store.loadHistoricalCapture();
  resolve({connection:'DISCONNECTED'}); await reading;
  assert.equal(store.getSnapshot().mode,'HISTORICAL_REPLAY'); assert.equal(store.getSnapshot().events.length,1); store.stop();
});
test('cross-project scope fails closed in the store without an avatar or fallback simulation', async () => {
  const store=new HQStore(); store.setObservationScope({...scope,project:'foreign'});
  assert.equal(await store.loadHistoricalCapture(),false);
  assert.deepEqual(store.getSnapshot().agents,{});
  assert.equal(store.getSnapshot().sourceHealth.connection,'DEGRADED');
  assert.equal(store.getSnapshot().mockMode,false); store.stop();
});
test('account change, logout and DEMO invalidate an asynchronous admission and its late response', async () => {
  for (const action of ['user','logout','demo']) {
    const store=new HQStore(); store.setObservationScope(scope);
    const pending=store.loadHistoricalCapture();
    if(action==='user') store.setObservationScope({...scope,viewerId:'other-user'});
    if(action==='logout') store.setObservationScope(undefined);
    if(action==='demo') await store.switchMode('MOCK');
    assert.equal(await pending,false); assert.equal(store.getSnapshot().observation,undefined);
    assert.ok(Object.values(store.getSnapshot().agents).every(a=>a.role!=='EXTERNAL_EXECUTOR')); store.stop();
  }
});
test('read-only observation performs zero fetch/provider calls and does not use recurring timers', async () => {
  const oldFetch=globalThis.fetch, oldTimer=window.setInterval; let calls=0,timers=0;
  globalThis.fetch=async()=>{calls++;throw Error('forbidden');};
  window.setInterval=((..._args: unknown[])=>{timers++; throw Error('timer forbidden');}) as typeof window.setInterval;
  try {
    const store=new HQStore(); store.setObservationScope(scope);
    await store.loadHistoricalCapture(); store.nextHistoricalObservation(); store.stop();
    assert.equal(calls,0); assert.equal(timers,0);
  } finally { globalThis.fetch=oldFetch; window.setInterval=oldTimer; }
});
test('mounted App keeps historical evidence explicit through REAL/DEMO, remounts, account change and signout', async () => {
  let user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'} as User;
  const auth=new AuthStore({
    getUser:async()=>({data:{user},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
    signOut:async()=>({error:null}),
  } as unknown as SupabaseClient['auth']);
  const repository=()=>({findWorkspace:async()=>null,createWorkspace:async()=>{throw Error('forbidden');},listIdeas:async()=>[],createIdea:async()=>{throw Error('forbidden');}});
  const tree=(revision=0)=><StrictMode><AuthProvider store={auth}><MemoryRouter><Routes><Route element={<ProtectedRoute/>}><Route path="/" element={<App key={revision} ideaRepository={repository} campaignRepository={undefined}/>}/></Route><Route path="/login" element={<p>Sesión cerrada</p>}/></Routes></MemoryRouter></AuthProvider></StrictMode>;
  let view!:ReactTestRenderer;
  await act(async()=>{view=create(tree());});
  const click=async(label:string)=>{await act(async()=>{const b=view.root.findAllByType('button').find(b=>b.children.join('')===label)!; assert.ok(b); assert.notEqual(b.props.disabled,true); b.props.onClick(); await new Promise(resolve=>setTimeout(resolve,20));});};
  await click('Reproducir captura histórica verificada');
  assert.equal(hqStore.getSnapshot().mode,'HISTORICAL_REPLAY');
  assert.match(JSON.stringify(view.toJSON()),/estado actual desconocido/);
  assert.equal(view.root.findAllByType('button').find(b=>b.children.join('')==='Conectar Codex en vivo · pendiente')!.props.disabled,true);
  await click('Mostrar finalización histórica'); assert.equal(hqStore.getSnapshot().observation?.confirmed,'COMPLETED');
  await click('Campus DEMO · datos ficticios'); assert.equal(hqStore.getSnapshot().mode,'MOCK');
  await click('Campus REAL'); assert.equal(hqStore.getSnapshot().observation,undefined);
  await click('Reproducir captura histórica verificada');
  await act(async()=>{view.update(tree(1));}); assert.equal(hqStore.getSnapshot().observation,undefined);
  await click('Reproducir captura histórica verificada');
  user={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'} as User;
  await act(async()=>{await auth.validate();}); assert.equal(hqStore.getSnapshot().observation,undefined);
  assert.deepEqual(hqStore.getSnapshot().agents,{});
  await click('Reproducir captura histórica verificada'); assert.equal(hqStore.getSnapshot().observation?.viewerId,user.id);
  await click('Cerrar sesión'); assert.equal(hqStore.getSnapshot().observation,undefined);
  await act(async()=>view.unmount()); hqStore.stop();
});
