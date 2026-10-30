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
import { hqStore } from '../src/store/hqStore';
import { OfficeScene } from '../src/office/OfficeScene';
import { officeAgentView } from '../src/office/ui/agentViewSelectors';
import { AgentDock } from '../src/office/ui/AgentDock';
import { AgentInspector } from '../src/office/ui/AgentInspector';
import { mockAgents } from '../src/adapters/mock/mockScenario';
import type { HQState } from '../src/domain/hq';
import { settings, Container } from 'pixi.js';
import { AgentSprite } from '../src/office/agents/AgentSprite';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const timers=new Map<number,()=>void>();let timerId=0;
Object.assign(globalThis, { window: { setInterval:(fn:()=>void)=>{timers.set(++timerId,fn);return timerId;},clearInterval:(id:number)=>timers.delete(id), addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem: () => null, setItem() {} } } });
function snapshot(): HQState {
  return {agents:{a:{...mockAgents[0],id:'a'},b:{...mockAgents[1],id:'b'}},tasks:{},campaigns:{},events:[],handoffs:[],memorySignals:[],readOnly:true,mockMode:true,mode:'MOCK',selectedAgentId:'a',sourceHealth:{source:'mock',mode:'MOCK',connection:'CONNECTED',eventsLoaded:0,agentsLoaded:2,tasksLoaded:0}};
}
// Rendered positions deliberately differ from station/destination anchors.
function sceneFixture() {
  const changes:boolean[]=[];
  const scene:any=Object.create(OfficeScene.prototype);
  const world={x:0,y:0,scale:{x:1,y:1,set(n:number){this.x=n;this.y=n;}},position:{set(x:number,y:number){world.x=x;world.y=y;}}};
  const sprite=(x:number,y:number)=>({x,y,updateAgent(){},setSelected(){},destroy(){},setHovered(){}});
  Object.assign(scene,{world,state:snapshot(),sprites:new Map([['a',sprite(420,290)],['b',sprite(810,470)]]),motions:new Map(),
    app:{screen:{width:800,height:600},destroy(){}},fitScale:1,elapsed:0,highlightUntil:0,effects:[],seen:new Set(),
    zoneHighlight:{clear(){return this;},lineStyle(){return this;},drawPolygon(){return this;}},
    depthLayer:{sortChildren(){}},stationLights:new Map(),memoryOrigins:{clear(){}},
    onHover(){},onZoom(){},onCriticalFocusChange:(enabled:boolean)=>changes.push(enabled),
    resizeObserver:{disconnect(){}},canvas:{removeEventListener(){}}});
  return {scene,world,changes};
}

test('new source creates a real AgentSprite and immediate focus uses the current motion before any tick',()=>{
  // Minimal canvas resource adapter, not a replacement sprite/motion or renderer.
  const originalAdapter=settings.ADAPTER;
  const canvasDescriptor=Object.getOwnPropertyDescriptor(globalThis,'HTMLCanvasElement');
  class TestCanvas { width=16;height=16;getContext(){return {fillRect(){}};} }
  Object.defineProperty(globalThis,'HTMLCanvasElement',{value:TestCanvas,configurable:true});
  settings.ADAPTER={...originalAdapter,createCanvas:()=>new TestCanvas() as unknown as HTMLCanvasElement};
  const {scene}=sceneFixture();scene.sprites.clear();scene.depthLayer=new Container();scene.onSelect=()=>{};
  const state={...snapshot(),mode:'LIVE_READ_ONLY' as const,mockMode:false,
    agents:{a:{...snapshot().agents.a,zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const}},
    sourceHealth:{...snapshot().sourceHealth,mode:'LIVE_READ_ONLY' as const,source:'munder' as const}};
  const before=structuredClone(state);
  try {
    scene.update(state); // actual source switch, real construction, no preseeded sprite
    const sprite=scene.sprites.get('a');const motion=scene.motions.get('a');
    assert.ok(sprite instanceof AgentSprite);assert.equal(motion.walking,true);
    assert.equal(scene.focusAgent('a'),true); // deliberately NO tick between update and focus
    assert.deepEqual({x:sprite.x,y:sprite.y},motion.position);
    assert.notDeepEqual(motion.position,{x:0,y:0});
    assert.deepEqual(scene.focusTarget,{x:400-motion.position.x,y:300-motion.position.y});
    const initial={...motion.position};scene.tick(16);
    assert.notDeepEqual(motion.position,initial,'the existing route still advances normally');
    sprite.position.set(sprite.x+7,sprite.y-2);
    const rendered={x:sprite.x,y:sprite.y};scene.update(state);
    assert.equal(scene.sprites.get('a'),sprite);assert.equal(scene.motions.get('a'),motion);
    assert.deepEqual({x:sprite.x,y:sprite.y},rendered,'later refreshes preserve an existing rendered offset');
    assert.deepEqual(state,before,'focus/initial projection do not mutate domain data');
  } finally {
    scene.depthLayer.destroy({children:true});settings.ADAPTER=originalAdapter;
    if(canvasDescriptor)Object.defineProperty(globalThis,'HTMLCanvasElement',canvasDescriptor);
    else Reflect.deleteProperty(globalThis,'HTMLCanvasElement');
  }
});

for(const conflict of ['owner','campaign','both'] as const) {
  test(`task attribution rejects contradictory ${conflict} metadata`,()=>{
    const state=snapshot();state.agents.a.currentTaskId='task-a';state.agents.a.campaignId='campaign-a';
    state.tasks['task-a']={id:'task-a',title:'Must not attribute this title',status:'RUNNING',
      ownerAgentId:conflict==='campaign'?'a':'b',campaignId:conflict==='owner'?'campaign-a':'campaign-b'};
    const before=structuredClone(state);const view=officeAgentView(state);
    assert.equal(view.task,undefined);assert.equal(view.taskState,'INCONSISTENT');assert.deepEqual(state,before);
  });
}

for(const scenario of ['missing-owner','agent-campaign-only','task-campaign-only','matching-campaigns','no-campaigns','record-id-mismatch'] as const) {
  test(`task relationship distinguishes incomplete and coherent evidence: ${scenario}`,()=>{
    const state=snapshot();state.agents.a.currentTaskId='task-a';state.agents.a.campaignId=undefined;
    const task={id:'task-a',title:'Coherent task',status:'RUNNING',ownerAgentId:'a',campaignId:undefined as string|undefined};
    if(scenario==='missing-owner')Reflect.deleteProperty(task,'ownerAgentId');
    if(scenario==='agent-campaign-only'||scenario==='matching-campaigns')state.agents.a.campaignId='campaign-a';
    if(scenario==='task-campaign-only'||scenario==='matching-campaigns')task.campaignId='campaign-a';
    if(scenario==='record-id-mismatch')task.id='foreign-task';
    state.tasks['task-a']=task;
    const before=structuredClone(state);const view=officeAgentView(state);
    const matched=scenario==='matching-campaigns'||scenario==='no-campaigns';
    assert.equal(view.taskState,matched?'MATCHED':scenario==='record-id-mismatch'?'INCONSISTENT':'INCOMPLETE');
    assert.equal(view.task,matched?task:undefined);assert.deepEqual(state,before);
  });
}

test('inspector withdraws a task on inconsistent or incomplete refresh and recovers only from coherent metadata',async()=>{
  const state=snapshot();state.agents.a.currentTaskId='task-a';state.agents.a.campaignId='campaign-a';
  state.tasks['task-a']={id:'task-a',title:'Synthetic task title',status:'RUNNING',ownerAgentId:'a',campaignId:'campaign-a'};
  let view!:ReactTestRenderer;
  await act(async()=>{view=create(<AgentInspector view={officeAgentView(state)}/>);});
  assert.match(JSON.stringify(view.toJSON()),/Synthetic task title/);
  state.tasks['task-a'].ownerAgentId='b';
  await act(async()=>view.update(<AgentInspector view={officeAgentView(state)}/>));
  assert.match(JSON.stringify(view.toJSON()),/Metadatos inconsistentes · tarea no atribuida/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/Synthetic task title/);
  state.tasks['task-a'].ownerAgentId='a';state.tasks['task-a'].campaignId=undefined;
  await act(async()=>view.update(<AgentInspector view={officeAgentView(state)}/>));
  assert.match(JSON.stringify(view.toJSON()),/Información incompleta/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/Synthetic task title/);
  state.tasks['task-a'].campaignId='campaign-a';
  await act(async()=>view.update(<AgentInspector view={officeAgentView(state)}/>));
  assert.match(JSON.stringify(view.toJSON()),/Synthetic task title/);
  delete state.tasks['task-a'];
  await act(async()=>view.update(<AgentInspector view={officeAgentView(state)}/>));
  assert.match(JSON.stringify(view.toJSON()),/referencia sin detalle confirmado/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/Synthetic task title/);
  await act(async()=>view.unmount());
});

test('manual focus snapshots rendered position and refocuses the same selected agent',()=>{
  const {scene}=sceneFixture();const before=structuredClone(scene.state);
  assert.equal(scene.focusAgent('a'),true);assert.deepEqual(scene.focusTarget,{x:-20,y:10});
  scene.sprites.get('a').x=450;
  assert.deepEqual(scene.focusTarget,{x:-20,y:10},'no continuous tracking');
  scene.focusAgent('a');assert.deepEqual(scene.focusTarget,{x:-50,y:10});
  assert.deepEqual(scene.state,before);
});
test('rapid focus A then B retains only B; invalid or unavailable coordinates do not create a target',()=>{
  const {scene}=sceneFixture();scene.focusAgent('a');scene.state.selectedAgentId='b';scene.focusAgent('b');
  assert.deepEqual(scene.focusTarget,{x:-410,y:-170});assert.equal(scene.focusAgentId,'b');
  assert.equal(scene.focusAgent('constructor'),false);assert.equal(scene.focusAgent('missing'),false);
  scene.sprites.get('b').x=NaN;assert.equal(scene.focusAgent('b'),false);
});
test('manual control cancels focus and prevents later critical takeover until explicit reenable',()=>{
  const {scene,changes}=sceneFixture();scene.setCriticalEventFocus(true);scene.highlight('WAR_ROOM',true);assert.ok(scene.focusTarget);
  scene.takeCameraControl();assert.equal(scene.focusTarget,undefined);assert.equal(changes.at(-1),false);
  scene.highlight('WAR_ROOM',true);assert.equal(scene.focusTarget,undefined);
  scene.setCriticalEventFocus(true);scene.highlight('WAR_ROOM',true);assert.ok(scene.focusTarget);
  scene.focusAgent('a');scene.highlight('WAR_ROOM',true);assert.deepEqual(scene.focusTarget,{x:-20,y:10});
});
test('zoom and centering cancel focus and synchronize the critical toggle',()=>{
  const {scene,changes}=sceneFixture();scene.setCriticalEventFocus(true);scene.focusAgent('a');scene.zoom(1.1);
  assert.equal(scene.focusTarget,undefined);assert.equal(changes.at(-1),false);
  scene.focusAgent('a');scene.resetCamera();assert.equal(scene.focusTarget,undefined);assert.equal(scene.focusAgentId,undefined);
});
test('reduced motion finishes focus on one frame without modifying agents or sprite positions',()=>{
  const {scene,world}=sceneFixture();scene.reducedMotion={matches:true};scene.focusAgent('a');
  const before=structuredClone(scene.state);scene.tick(16);
  assert.equal(scene.focusTarget,undefined);assert.deepEqual({x:world.x,y:world.y},{x:-20,y:10});
  assert.deepEqual(scene.state,before);assert.equal(scene.sprites.get('a').x,420);
});
test('agent disappearance cancels its pending focus without inventing a replacement',()=>{
  const {scene}=sceneFixture();scene.focusAgent('a');
  scene.update({...snapshot(),agents:{},selectedAgentId:undefined});
  assert.equal(scene.focusTarget,undefined);assert.equal(scene.sprites.size,0);
});
test('external selection change invalidates an earlier manual target',()=>{
  const {scene}=sceneFixture();scene.focusAgent('a');scene.update({...snapshot(),selectedAgentId:'b'});
  assert.equal(scene.focusTarget,undefined);assert.equal(scene.focusAgentId,undefined);
});
test('source change or disconnect cancels critical and manual targets',()=>{
  for(const mode of ['LIVE_READ_ONLY','HISTORICAL_REPLAY'] as const){
    const {scene}=sceneFixture();scene.focusAgent('a');
    scene.update({...snapshot(),agents:{},mode,sourceHealth:{...snapshot().sourceHealth,source:'codex',mode,connection:'DISCONNECTED'}});
    assert.equal(scene.focusTarget,undefined);assert.equal(scene.focusCriticalEvents,false);
  }
  const {scene}=sceneFixture();scene.setCriticalEventFocus(true);scene.highlight('WAR_ROOM',true);
  scene.update({...snapshot(),agents:{}});assert.equal(scene.focusTarget,undefined);
});
test('historical viewer/run scope invalidates pending focus even if the mode is unchanged',()=>{
  const {scene}=sceneFixture();scene.state.mode='HISTORICAL_REPLAY';
  scene.state.observation={viewerId:'old',runId:'old'};scene.focusAgent('a');
  scene.update({...snapshot(),agents:{},mode:'HISTORICAL_REPLAY',observation:{viewerId:'new',runId:'new'}});
  assert.equal(scene.focusTarget,undefined);
});
test('destroyed scene rejects late focus and frames',()=>{
  const {scene,world}=sceneFixture();scene.focusAgent('a');scene.destroy();
  const before={x:world.x,y:world.y};assert.equal(scene.focusAgent('a'),false);scene.tick(16);
  assert.equal(scene.focusTarget,undefined);assert.deepEqual({x:world.x,y:world.y},before);
});
test('view selectors preserve snapshots and reject inherited selection/task lookups',()=>{
  const state=snapshot();state.selectedAgentId='constructor';assert.equal(officeAgentView(state).agent,undefined);
  state.selectedAgentId='a';state.agents.a.currentTaskId='constructor';
  const before=structuredClone(state);assert.equal(officeAgentView(state).task,undefined);assert.deepEqual(state,before);
});
test('dock native buttons support repeated activation and inspector offers no operational controls',async()=>{
  const state=snapshot();const calls:string[]=[];let view!:ReactTestRenderer;
  await act(async()=>{view=create(<><AgentDock view={officeAgentView(state)} onSelect={id=>calls.push(id)}/><AgentInspector view={officeAgentView(state)}/></>);});
  const buttons=view.root.findAllByType('button');assert.equal(buttons.length,2);
  assert.equal(buttons[0].props['aria-pressed'],true);assert.equal(buttons[0].props.type,'button');
  assert.match(buttons[0].props['aria-label'],/Seleccionar y enfocar/);
  for(const id of buttons[0].props['aria-describedby'].split(' '))assert.equal(view.root.findAllByProps({id}).length,1);
  await act(async()=>{buttons[0].props.onClick();buttons[0].props.onClick();});assert.deepEqual(calls,['a','a']);
  const inspector=view.root.findByProps({id:'office-agent-inspector'});assert.equal(inspector.findAllByType('button').length,0);
  assert.match(JSON.stringify(view.toJSON()),/no conceden permisos/);
  await act(async()=>view.unmount());
});
test('mounted StrictMode App shares sprite/dock selection intent, preserves operational state and causes no extra calls',async()=>{
  let user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'} as User;let reads=0,calls=0;
  const auth=new AuthStore({getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})} as unknown as SupabaseClient['auth']);
  const repository=()=>({findWorkspace:async()=>{reads++;return null;},createWorkspace:async()=>{throw Error('forbidden');},listIdeas:async()=>[],createIdea:async()=>{throw Error('forbidden');}});
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('forbidden');};
  const tree=(key=0)=><StrictMode><AuthProvider store={auth}><MemoryRouter><Routes><Route element={<ProtectedRoute/>}><Route path="/" element={<App key={key} ideaRepository={repository}/>}/></Route></Routes></MemoryRouter></AuthProvider></StrictMode>;
  let view!:ReactTestRenderer;
  try {
    await act(async()=>{view=create(tree());});
    await act(async()=>{await hqStore.switchMode('MOCK');});
    const before=structuredClone(hqStore.getSnapshot());const baseline=reads;
    const dock=view.root.findByType(AgentDock);const id=Object.keys(before.agents)[1];
    await act(async()=>{dock.props.onSelect(id);dock.props.onSelect(id);});assert.equal(hqStore.getSnapshot().selectedAgentId,id);
    // Same callback used by the actual Pixi pointertap binding (without WebGL in Node).
    const handlers=new Map();const sprite={on:(name:string,fn:()=>void)=>handlers.set(name,fn)};
    OfficeScene.prototype['bindAgentEvents'].call({onSelect:dock.props.onSelect} as unknown as OfficeScene,sprite as never,Object.keys(before.agents)[0]);
    await act(async()=>{handlers.get('pointertap')();});
    const after=hqStore.getSnapshot();assert.equal(after.selectedAgentId,Object.keys(before.agents)[0]);
    for(const field of ['tasks','events','campaigns','agents','handoffs','memorySignals'] as const)assert.deepEqual(after[field],before[field]);
    assert.equal(reads,baseline);assert.equal(calls,0);
    await act(async()=>{await hqStore.switchMode('LIVE_READ_ONLY');});
    assert.equal(view.root.findByType(AgentDock).props.view.agents.length,0);
    await act(async()=>{await hqStore.loadHistoricalCapture();});
    assert.match(view.root.findByType(AgentDock).props.view.modeLabel,/HISTORICAL_REPLAY/);
    user={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'} as User;
    await act(async()=>{await auth.validate();});assert.equal(view.root.findByType(AgentDock).props.view.agents.length,0);
    await act(async()=>{view.update(tree(1));});assert.equal(hqStore.getSnapshot().observation,undefined);
    await act(async()=>view.unmount());assert.equal(hqStore.getSnapshot().selectedAgentId,undefined);assert.equal(timers.size,0);
  } finally {globalThis.fetch=oldFetch;hqStore.stop();}
});
