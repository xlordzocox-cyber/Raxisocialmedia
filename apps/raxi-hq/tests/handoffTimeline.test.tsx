import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Graphics, settings } from 'pixi.js';
import { OfficeScene } from '../src/office/OfficeScene';
import { HandoffEffect } from '../src/office/effects/HandoffEffect';
import { mockAgents } from '../src/adapters/mock/mockScenario';
import type { HQState } from '../src/domain/hq';
import type { HQEvent } from '../src/domain/events';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { handoffSnapshot,canAnimateDemoHandoff } from '../src/office/handoffPolicy';
import { HandoffTimeline } from '../src/office/ui/HandoffTimeline';
import { officeAgentView } from '../src/office/ui/agentViewSelectors';
import { HQStore } from '../src/store/hqStore';
import { OBSERVED_PROJECT } from '../src/observation/executionObservation';
import { AgentSprite } from '../src/office/agents/AgentSprite';

Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const timers=new Map<number,()=>void>();let timerId=0;
Object.assign(globalThis,{window:{setInterval:(fn:()=>void)=>{timers.set(++timerId,fn);return timerId;},clearInterval:(id:number)=>timers.delete(id)}});

function event(patch:Partial<HQEvent>={}):HQEvent{return {id:'handoff-1',timestamp:'2000-01-01T00:00:00Z',type:'HANDOFF_SENT',label:'Declared transfer',actorId:'a',targetId:'b',source:'munder',verified:true,...patch};}
function snapshot(mode:HQState['mode']='LIVE_READ_ONLY',events=[event()]):HQState{return {
  agents:{a:{...mockAgents[0],id:'a'},b:{...mockAgents[1],id:'b'}},tasks:{},campaigns:{},events,handoffs:[],memorySignals:[],readOnly:true,
  mockMode:mode==='MOCK',mode,selectedAgentId:'a',sourceHealth:{source:mode==='MOCK'?'mock':mode==='HISTORICAL_REPLAY'?'codex':'munder',mode,connection:'CONNECTED',agentsLoaded:2,tasksLoaded:0,eventsLoaded:events.length},
};}
function canvasResources() {
  const adapter=settings.ADAPTER, descriptor=Object.getOwnPropertyDescriptor(globalThis,'HTMLCanvasElement');
  class Canvas {width=16;height=16;getContext(){return {fillRect(){}};}}
  Object.defineProperty(globalThis,'HTMLCanvasElement',{value:Canvas,configurable:true});settings.ADAPTER={...adapter,createCanvas:()=>new Canvas() as unknown as HTMLCanvasElement};
  return ()=>{settings.ADAPTER=adapter;if(descriptor)Object.defineProperty(globalThis,'HTMLCanvasElement',descriptor);else Reflect.deleteProperty(globalThis,'HTMLCanvasElement');};
}
function sceneFixture(ids=['a','b']) {
  const scene:any=Object.create(OfficeScene.prototype);
  const sprites=new Map<string,any>();
  for(const id of ids) {
    const sprite:any=new Container();sprite.position.set(id==='a'?100:300,200);sprite.begins=0;sprite.cancels=0;
    sprite.updateAgent=()=>{};sprite.setSelected=()=>{};sprite.setHovered=()=>{};sprite.faceMovement=()=>{};sprite.animate=()=>{};
    sprite.beginHandoff=()=>sprite.begins++;sprite.cancelHandoff=()=>sprite.cancels++;sprites.set(id,sprite);
  }
  Object.assign(scene,{sprites,motions:new Map(),effects:[],seen:new Set(),elapsed:0,highlightUntil:0,world:new Container(),
    app:{screen:{width:800,height:600},destroy(){}},fitScale:1,zoneHighlight:new Graphics(),depthLayer:new Container(),effectLayer:new Container(),stationLights:new Map(),memoryOrigins:{clear(){},remember(){},consume(){return {x:0,y:0};}},onHover(){},onZoom(){},onSelect(){},onCriticalFocusChange(){},resizeObserver:{disconnect(){}},canvas:{removeEventListener(){}}});
  return scene;
}
test('critical: initial LIVE verified:true historical header cannot animate an independently confirmed delivery',()=>{
  const restore=canvasResources();try{const scene=sceneFixture();scene.update(snapshot());
    assert.equal(scene.effects.filter((effect:unknown)=>effect instanceof HandoffEffect).length,0);
    assert.equal(scene.sprites.get('a').begins,0);
  }finally{restore();}
});
test('LIVE verified:false also cannot start a transfer effect',()=>{
  const restore=canvasResources();try{const scene=sceneFixture();scene.update(snapshot('LIVE_READ_ONLY',[event({verified:false})]));
    assert.equal(scene.effects.filter((effect:unknown)=>effect instanceof HandoffEffect).length,0);
  }finally{restore();}
});

for(const source of ['mock','aria','github','supermemory'] as const)test(`MOCK verified:true remains DEMO regardless of tag ${source}`,()=>{
  const state=snapshot('MOCK',[event({source})]);const row=handoffSnapshot(state).rows[0];
  assert.match(row.evidence,/DEMO\/MOCK/);assert.equal(canAnimateDemoHandoff(row,{x:1,y:2},{x:3,y:4},false),true);
});
for(const verified of [true,false])test(`LIVE verified:${verified} is declared, not independently evidenced, including new events`,()=>{
  const state=snapshot('LIVE_READ_ONLY',[event({verified})]);const row=handoffSnapshot(state).rows[0];
  assert.match(row.evidence,/sin evidencia independiente/);assert.equal(row.demoEligible,false);
  assert.equal(canAnimateDemoHandoff(row,{x:1,y:2},{x:3,y:4},false),false);
});
for(const field of ['actorId','targetId'] as const)for(const id of [undefined,'missing','constructor','__proto__'])test(`unresolved ${field}=${id} is descriptive and never invents an endpoint`,()=>{
  const state=snapshot('MOCK',[event({[field]:id})]);const row=handoffSnapshot(state).rows[0];
  assert.equal(row.demoEligible,false);assert.ok(row.warnings.length);assert.equal(row[field==='actorId'?'actor':'target'],undefined);
});
test('own reserved IDs resolve only to own records, not inherited agents or tasks',()=>{
  const state=snapshot('MOCK',[event({actorId:'constructor',taskId:'valueOf'})]);
  state.agents=Object.fromEntries([['constructor',{...state.agents.a,id:'constructor'}],['b',state.agents.b]]);
  const row=handoffSnapshot(state).rows[0];assert.equal(row.actor?.id,'constructor');assert.equal(row.demoEligible,false);
  assert.ok(row.warnings.includes('Referencia de tarea no disponible o inconsistente'));
});
test('repeated IDs, even exact duplicates, cannot select a canonical version or animate',()=>{
  for(const patch of [{},{targetId:'a'},{type:'TASK_STARTED' as const}]){
    const state=snapshot('MOCK',[event(),event(patch)]);const rows=handoffSnapshot(state).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].duplicate,true);assert.equal(rows[0].demoEligible,false);
  }
});
test('missing optional IDs remain absent and do not fabricate assets or tasks',()=>{
  const row=handoffSnapshot(snapshot('MOCK')).rows[0];assert.equal(row.event.taskId,undefined);assert.equal(row.event.assetId,undefined);
  assert.ok(row.warnings.includes('ID de tarea no declarado'));assert.ok(row.warnings.includes('ID de asset no declarado'));
});
for(const bad of ['missing-task','task-id','owner','campaign','agent-campaign','owner-campaign-without-event'] as const)test(`inconsistent available metadata blocks DEMO: ${bad}`,()=>{
  const state=snapshot('MOCK',[event({taskId:'t',campaignId:'c'})]);state.tasks.t={id:'t',title:'T',status:'QUEUED',ownerAgentId:'a',campaignId:'c'};
  if(bad==='missing-task')delete state.tasks.t;if(bad==='task-id')state.tasks.t.id='other';if(bad==='owner')state.tasks.t.ownerAgentId='foreign';
  if(bad==='campaign')state.tasks.t.campaignId='other';if(bad==='agent-campaign')state.agents.a.campaignId='other';
  if(bad==='owner-campaign-without-event'){state.events[0].campaignId=undefined;state.agents.a.campaignId='other';}
  assert.equal(handoffSnapshot(state).rows[0].demoEligible,false);
});
test('sent and received statements are never paired into a completion or QA approval',()=>{
  for(const type of ['HANDOFF_SENT','HANDOFF_RECEIVED','ASSET_RECEIVED'] as const){
    const state=snapshot('LIVE_READ_ONLY',[event({type})]);const row=handoffSnapshot(state).rows[0];
    assert.match(row.meaning,type==='HANDOFF_SENT'?/no confirma recepción/:type==='HANDOFF_RECEIVED'?/no implica aprobación ni finalización/:/no acredita QA ni publicación/);
    assert.equal(row.demoEligible,false);assert.equal(handoffSnapshot(state).rows.length,1);
  }
});
test('source/mode inconsistencies, disconnected LIVE and historical injection fail closed',()=>{
  for(const mode of ['LIVE_READ_ONLY','MOCK'] as const){const s=snapshot(mode);s.sourceHealth.connection='DEGRADED';assert.equal(handoffSnapshot(s).rows.length,0);}
  const s=snapshot('MOCK');s.mockMode=false;assert.equal(handoffSnapshot(s).rows.length,0);
  const wrong=snapshot('LIVE_READ_ONLY');wrong.sourceHealth.source='mock';assert.equal(handoffSnapshot(wrong).rows.length,0);
  assert.equal(handoffSnapshot(snapshot('HISTORICAL_REPLAY')).rows.length,0);
});
test('positions must exist and be finite; reduced motion and self-reference cannot animate',()=>{
  const row=handoffSnapshot(snapshot('MOCK')).rows[0];
  assert.equal(canAnimateDemoHandoff(row,undefined,{x:1,y:1},false),false);
  assert.equal(canAnimateDemoHandoff(row,{x:Infinity,y:0},{x:1,y:1},false),false);
  assert.equal(canAnimateDemoHandoff(row,{x:0,y:0},{x:1,y:1},true),false);
  assert.equal(handoffSnapshot(snapshot('MOCK',[event({targetId:'a'})])).rows[0].demoEligible,false);
});
test('DEMO effect is finite, repeated snapshots do not replay, manual focus/selection are preserved',()=>{
  const restore=canvasResources();try{
    const scene=sceneFixture(),state=snapshot('MOCK');scene.update(state);assert.equal(scene.effects.length,1);
    scene.focusAgent('a');const focus={...scene.focusTarget};scene.update(state);assert.equal(scene.effects.length,1);assert.deepEqual(scene.focusTarget,focus);assert.equal(state.selectedAgentId,'a');
    scene.tick(2000);assert.equal(scene.effects.length,0);scene.update(state);assert.equal(scene.effects.length,0);
  }finally{restore();}
});
test('live initial history, repeated reads and later headers always produce zero transfer effects',()=>{
  const restore=canvasResources();try{
    const scene=sceneFixture();for(const events of [[event()],[event()],[event({id:'new',timestamp:'2099-01-01T00:00:00Z'})]])scene.update(snapshot('LIVE_READ_ONLY',events));
    assert.equal(scene.effects.length,0);assert.equal(scene.sprites.get('a').begins,0);
  }finally{restore();}
});
test('trust loss clears active handoffs and offsets, but not unrelated effects; restoration does not replay',()=>{
  const restore=canvasResources();try{
    const scene=sceneFixture(),state=snapshot('MOCK');scene.update(state);scene.tick(400);
    let unrelatedDestroyed=0;scene.effects.push({update:()=>false,destroy:()=>unrelatedDestroyed++});
    scene.update({...state,sourceHealth:{...state.sourceHealth,connection:'DEGRADED'}});
    assert.equal(scene.effects.filter((e:unknown)=>e instanceof HandoffEffect).length,0);assert.equal(unrelatedDestroyed,0);
    assert.equal(scene.sprites.get('a').cancels,1);assert.deepEqual({x:scene.sprites.get('a').x,y:scene.sprites.get('a').y},scene.motions.get('a').position);
    scene.update(state);assert.equal(scene.effects.filter((e:unknown)=>e instanceof HandoffEffect).length,0);
  }finally{restore();}
});
test('changed same-ID header, removed actor and reduced-motion switch cancel active effects',()=>{
  const restore=canvasResources();try{for(const action of ['changed','removed','reduced']){
    const scene=sceneFixture(),state=snapshot('MOCK');scene.update(state);assert.equal(scene.effects.length,1);
    if(action==='changed')scene.update({...state,events:[event({assetId:'different'})]});
    if(action==='removed')scene.update({...state,agents:{b:state.agents.b}});
    if(action==='reduced'){scene.reducedMotion={matches:true};scene.tick(16);}
    assert.equal(scene.effects.filter((e:unknown)=>e instanceof HandoffEffect).length,0);
  }}finally{restore();}
});
test('MOCK to LIVE to historical clears transfers and never manufactures Raxi handoffs',()=>{
  const restore=canvasResources();try{
    const scene=sceneFixture();scene.update(snapshot('MOCK'));assert.equal(scene.effects.length,1);
    scene.update(snapshot('LIVE_READ_ONLY'));assert.equal(scene.effects.length,0);
    scene.update(snapshot('HISTORICAL_REPLAY',[]));assert.equal(scene.effects.length,0);
    scene.destroy();scene.update(snapshot('MOCK'));assert.equal(scene.effects.length,0);
  }finally{restore();}
});
test('actual avatar cancellation hides the handoff bubble without changing agent metadata',()=>{
  const restore=canvasResources();try{const agent={...mockAgents[0]};const sprite:any=new AgentSprite('a',agent,0x00ffff);
    sprite.beginHandoff(0);sprite.animate('READY',100);assert.equal(sprite.bubble.visible,true);
    sprite.cancelHandoff();assert.equal(sprite.bubble.visible,false);sprite.animate('READY',101);assert.equal(sprite.bubble.visible,false);assert.deepEqual(agent,mockAgents[0]);sprite.destroy({children:true});
  }finally{restore();}
});
test('historical admission and account/logout changes expose no handoffs, with no fetch or new timers',async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('forbidden');};
  try{const store=new HQStore();store.setObservationScope({viewerId:'one',project:OBSERVED_PROJECT});
    await store.loadHistoricalCapture();assert.equal(handoffSnapshot(store.getSnapshot()).rows.length,0);
    store.setObservationScope({viewerId:'two',project:OBSERVED_PROJECT});assert.equal(handoffSnapshot(store.getSnapshot()).rows.length,0);
    store.setObservationScope(undefined);assert.equal(handoffSnapshot(store.getSnapshot()).rows.length,0);assert.equal(calls,0);assert.equal(timers.size,0);
  }finally{globalThis.fetch=old;}
});
test('account change and logout invalidate an active DEMO scene through the existing store subscription',()=>{
  const restore=canvasResources();try{for(const viewerId of ['two',undefined]){
    const scene=sceneFixture(),store=new HQStore();store.setObservationScope({viewerId:'one',project:OBSERVED_PROJECT});
    const unsubscribe=store.subscribe(()=>scene.update(store.getSnapshot()));
    scene.update(snapshot('MOCK'));assert.equal(scene.effects.length,1);
    store.setObservationScope(viewerId?{viewerId,project:OBSERVED_PROJECT}:undefined);
    assert.equal(scene.effects.length,0);assert.equal(scene.sprites.size,0);unsubscribe();store.stop();
  }}finally{restore();}
});
test('DEMO has at most two transient handoffs and never queues overlapping endpoints for later replay',()=>{
  const restore=canvasResources();try{
    const scene=sceneFixture(['a','b','c','d']),state=snapshot('MOCK');
    state.agents.c={...state.agents.a,id:'c'};state.agents.d={...state.agents.b,id:'d'};
    state.events=[event(),event({id:'cd',actorId:'c',targetId:'d'}),event({id:'ab-repeat'})];
    scene.update(state);assert.equal(scene.effects.length,2);scene.tick(2100);assert.equal(scene.effects.length,0);
    scene.update(state);assert.equal(scene.effects.length,0);
  }finally{restore();}
});
test('mounted StrictMode timeline is read-only, collapsible and clears rows across source changes',async()=>{
  const state=snapshot('MOCK'),before=structuredClone(state);const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('forbidden');};let view!:ReactTestRenderer;
  const tree=(s:HQState)=><StrictMode><HandoffTimeline state={s} view={officeAgentView(s)}/></StrictMode>;
  try{await act(async()=>{view=create(tree(state));});assert.match(JSON.stringify(view.toJSON()),/DEMO\/MOCK/);assert.equal(view.root.findAllByType('summary').length,1);assert.equal(view.root.findAllByType('button').length,0);
    await act(async()=>view.update(tree(snapshot('LIVE_READ_ONLY'))));assert.match(JSON.stringify(view.toJSON()),/no constituye evidencia independiente/);
    await act(async()=>view.update(tree({...snapshot(),sourceHealth:{...snapshot().sourceHealth,connection:'DISCONNECTED'}})));assert.equal(view.root.findAllByType('article').length,0);
    await act(async()=>view.update(tree(snapshot('HISTORICAL_REPLAY'))));assert.equal(view.root.findAllByType('article').length,0);
    await act(async()=>view.unmount());assert.deepEqual(state,before);assert.equal(calls,0);
  }finally{globalThis.fetch=old;}
});
