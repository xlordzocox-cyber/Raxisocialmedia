import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AgentTaskBoard } from '../src/office/ui/AgentTaskBoard';
import { officeAgentView } from '../src/office/ui/agentViewSelectors';
import { taskBoardView, taskClassification } from '../src/office/ui/taskBoardSelectors';
import { mockAgents, mockCampaign } from '../src/adapters/mock/mockScenario';
import { normalizeLiveTasks } from '../src/adapters/munder/canonicalFeed';
import { HQStore } from '../src/store/hqStore';
import { OBSERVED_PROJECT } from '../src/observation/executionObservation';
import type { HQState } from '../src/domain/hq';

Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.assign(globalThis,{window:{setInterval,clearInterval}});
function snapshot():HQState {
  return {agents:{a:{...mockAgents[0],id:'a',currentTaskId:'t',campaignId:'c'}},
    tasks:{t:{id:'t',title:'Task T',status:'QUEUED',ownerAgentId:'a',campaignId:'c'}},campaigns:{c:{...mockCampaign,id:'c'}},
    events:[],handoffs:[],memorySignals:[],readOnly:true,mockMode:true,mode:'MOCK',selectedAgentId:'a',
    sourceHealth:{source:'mock',mode:'MOCK',connection:'CONNECTED',agentsLoaded:1,tasksLoaded:1,eventsLoaded:0}};
}
function tree(state:HQState,scope='owner-a'){return <StrictMode><AgentTaskBoard state={state} view={officeAgentView(state)} scope={scope}/></StrictMode>;}
function freeze(value:any):any { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }

for(const token of ['QUEUED','RUNNING','BLOCKED','COMPLETED','FAILED','CANCELED'])test(`exact supported task token has visual classification: ${token}`,()=>assert.notEqual(taskClassification(token),'Sin clasificación'));
for(const token of ['mock-ready','MOCK_READY','READY','WORKING','queued','RUNNING ','constructor','__proto__'])test(`unrecognized task token remains unclassified: ${token}`,()=>{
  const s=snapshot();s.tasks.t.status=token;const row=taskBoardView(s).rows[0];assert.equal(row.classification,'Sin clasificación');assert.equal(row.task.status,token);
});
test('only existing snapshot tasks are projected, immutable metadata matches P1',()=>{
  const s=freeze(snapshot());const before=structuredClone(s);const result=taskBoardView(s);
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].relationship,'Relación consistente · metadatos');
  assert.equal(officeAgentView(s).taskState,'MATCHED');assert.deepEqual(s,before);
});
test('empty and disconnected LIVE snapshots produce no rows even if stale tasks remain',()=>{
  const s=snapshot();s.tasks={};assert.equal(taskBoardView(s).rows.length,0);
  s.tasks=snapshot().tasks;s.mode='LIVE_READ_ONLY';
  for(const connection of ['DISCONNECTED','DEGRADED'] as const){s.sourceHealth.connection=connection;assert.equal(taskBoardView(s).rows.length,0);assert.equal(taskBoardView(s).unavailable,true);assert.deepEqual(taskBoardView(s).referenceWarnings,[]);}
});
test('duplicate IDs or record/key mismatch cannot choose a winning task',()=>{
  for(const duplicate of [true,false]) {
    const s=snapshot();if(duplicate)s.tasks.alias={...s.tasks.t};else s.tasks.t.id='other';
    const result=taskBoardView(s);assert.equal(result.invalidIdentity,true);assert.deepEqual(result.rows,[]);assert.deepEqual(result.ownerIds,[]);
  }
});
test('existing admission rejects duplicate tasks and forbidden IDs; inherited records are not tasks',()=>{
  const task=snapshot().tasks.t;assert.throws(()=>normalizeLiveTasks([task,task]));
  assert.throws(()=>normalizeLiveTasks([{...task,id:'__proto__'}]));
  const s=snapshot();s.tasks=Object.create({inherited:{...task,id:'inherited'}});assert.equal(taskBoardView(s).rows.length,0);
});
test('own constructor IDs work without inherited owner, campaign or dependency lookup',()=>{
  const s=snapshot();s.tasks=Object.fromEntries([['constructor',{...s.tasks.t,id:'constructor',ownerAgentId:'toString',campaignId:'valueOf',dependsOn:['hasOwnProperty']}]]);
  const row=taskBoardView(s).rows[0];assert.equal(row.owner,undefined);assert.match(row.relationship,/no presente/);
  assert.ok(row.warnings.includes('Dependencia no disponible: hasOwnProperty'));assert.ok(row.warnings.includes('Campaña declarada sin detalle en esta oficina'));
});
test('absent declared owner remains absent instead of selecting another agent',()=>{
  const s=snapshot();s.agents.a.currentTaskId=undefined;s.tasks.t.ownerAgentId='missing';
  const row=taskBoardView(s).rows[0];assert.equal(row.owner,undefined);assert.match(row.relationship,/no presente/);assert.equal(row.task.ownerAgentId,'missing');
});
test('foreign current-task claims remain contradictory, never reassign the declared owner',()=>{
  const s=snapshot();s.agents.b={...s.agents.a,id:'b'};const row=taskBoardView(s).rows[0];
  assert.equal(row.relationship,'Información contradictoria');assert.equal(row.task.ownerAgentId,'a');assert.deepEqual(row.currentTaskReferences,['a','b']);
});
test('task ownership is descriptive when currentTaskId points elsewhere, not evidence of active assignment',()=>{
  const s=snapshot();s.agents.a.currentTaskId='other';assert.match(taskBoardView(s).rows[0].relationship,/no confirmada/);
});
for(const change of ['owner-absent','campaign-missing','campaign-conflict','catalog-conflict'] as const)test(`relationship flags available inconsistencies: ${change}`,()=>{
  const s=snapshot();
  if(change==='owner-absent')s.tasks.t.ownerAgentId=undefined;
  if(change==='campaign-missing')s.tasks.t.campaignId=undefined;
  if(change==='campaign-conflict')s.agents.a.campaignId='other';
  if(change==='catalog-conflict')s.campaigns.c.id='other';
  assert.equal(taskBoardView(s).rows[0].relationship,change==='campaign-conflict'||change==='catalog-conflict'?'Información contradictoria':'Información incompleta');
});
test('missing and duplicate dependencies stay visible and do not change their order/multiplicity',()=>{
  const s=snapshot();s.tasks.t.dependsOn=['missing','missing'];const row=taskBoardView(s).rows[0];
  assert.deepEqual(row.task.dependsOn,['missing','missing']);assert.ok(row.warnings.includes('Dependencias repetidas'));assert.ok(row.warnings.includes('Dependencia no disponible: missing'));
});
test('self and multi-node/cross-edge cycles are marked precisely, not inferred as task states',()=>{
  const s=snapshot();s.tasks.t.dependsOn=['b','c'];
  for(const [id,deps] of [['b',['t']],['c',['b']],['d',['t']],['self',['self']]] as Array<[string,string[]]>)s.tasks[id]={...s.tasks.t,id,dependsOn:deps};
  const before=structuredClone(s);const rows=taskBoardView(s).rows;
  for(const id of ['t','b','c','self'])assert.ok(rows.find(row=>row.task.id===id)!.warnings.includes('Dependencia circular en el snapshot'));
  assert.ok(!rows.find(row=>row.task.id==='d')!.warnings.includes('Dependencia circular en el snapshot'));assert.deepEqual(s,before);
});
test('unknown dependency/owner references cannot create a task from an event',()=>{
  const s=snapshot();s.tasks={};s.events=[{id:'event',timestamp:'2026-10-30T00:00:00Z',type:'TASK_ASSIGNED',label:'external',taskId:'ghost',actorId:'a',source:'mock',verified:false}];
  assert.equal(taskBoardView(s).rows.length,0);
  assert.deepEqual(taskBoardView(s).referenceWarnings,['a referencia una tarea no disponible: t']);
});
test('approvalRequired is displayed only as declared metadata; board has no action buttons',async()=>{
  const s=snapshot();s.tasks.t.approvalRequired=true;let view!:ReactTestRenderer;
  await act(async()=>{view=create(tree(s));});
  assert.match(JSON.stringify(view.toJSON()),/no acredita una aprobación pendiente real/);assert.equal(view.root.findAllByType('button').length,0);
  await act(async()=>view.unmount());
});
test('mounted filters are repeatable presentation only, reset on scope/source/mode and stale references',async()=>{
  const s=snapshot();s.tasks.u={...s.tasks.t,id:'u',title:'Task U',ownerAgentId:'missing',campaignId:'other'};
  const before=structuredClone(s);const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('forbidden');};let view!:ReactTestRenderer;
  try {
    await act(async()=>{view=create(tree(freeze(s)));});
    const filter=async(index:number,value:string)=>act(async()=>view.root.findAllByType('select')[index].props.onChange({target:{value}}));
    await filter(0,'a');await filter(0,'a');assert.equal(view.root.findAllByType('article').length,1);
    await filter(1,'other');assert.equal(view.root.findAllByType('article').length,0);assert.match(JSON.stringify(view.toJSON()),/No hay tareas para estos filtros/);
    await act(async()=>view.update(tree(s,'other-user')));assert.equal(view.root.findAllByType('article').length,2);assert.equal(view.root.findAllByType('select')[0].props.value,'');
    await filter(0,'missing');const removed={...s,tasks:{t:s.tasks.t}};
    await act(async()=>view.update(tree(removed,'other-user')));assert.equal(view.root.findAllByType('select')[0].props.value,'');
    await act(async()=>view.update(tree(s,'other-user')));assert.equal(view.root.findAllByType('article').length,2,'old filter does not reactivate');
    await filter(0,'a');const historical={...s,tasks:{},mode:'HISTORICAL_REPLAY' as const};
    await act(async()=>view.update(tree(historical,'other-user')));assert.equal(view.root.findAllByType('article').length,0);
    await act(async()=>view.update(tree({...s,sourceHealth:{...s.sourceHealth,source:'munder'}},'other-user')));assert.equal(view.root.findAllByType('article').length,2);
    assert.deepEqual(s,before);assert.equal(calls,0);
    const labels=view.root.findAllByType('label');assert.equal(labels.length,2);assert.ok(labels.every(label=>label.findAllByType('select').length===1));
    await act(async()=>view.unmount());
  } finally {globalThis.fetch=oldFetch;}
});
test('admitted historical replay contains no Raxi tasks and disconnect never replaces them with MOCK',async()=>{
  const store=new HQStore();store.setObservationScope({viewerId:'test-viewer',project:OBSERVED_PROJECT});
  await store.loadHistoricalCapture();assert.equal(store.getSnapshot().mode,'HISTORICAL_REPLAY');assert.equal(taskBoardView(store.getSnapshot()).rows.length,0);
  await store.switchMode('LIVE_READ_ONLY');assert.equal(taskBoardView(store.getSnapshot()).rows.length,0);assert.equal(store.getSnapshot().mockMode,false);store.stop();
});
