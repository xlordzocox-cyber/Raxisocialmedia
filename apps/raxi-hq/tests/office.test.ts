import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mockAgents, mockTimeline, mockTasks, mockCampaign } from '../src/adapters/mock/mockScenario';
import { reduceEventToVisualState } from '../src/store/hqReducer';
import { hqStore } from '../src/store/hqStore';
import { AgentMotion, stationLightKey, syncAgentMotions } from '../src/office/agents/agentMotion';
import { routeBetweenZones } from '../src/office/pathfinding';
import { stationCapacity, zones, zoneOrder } from '../src/office/zones';
import { getStatusVisual } from '../src/office/agents/agentVisualState';
import { zoomAt, clampCamera, advanceCameraFocus } from '../src/office/camera';
import { OfficeScene } from '../src/office/OfficeScene';
import { handoffFrame, memoryFrame } from '../src/office/effects/visualTimelines';
import { PendingMemoryOrigins } from '../src/office/effects/memoryOrigins';
import { MAX_LIVE_AGENTS, MAX_LIVE_TASKS, MAX_TASK_DEPENDENCIES, MAX_LIVE_SOURCE_EVENTS, MAX_AGENT_CAPABILITIES, normalizeLiveAgents, normalizeLiveTasks, normalizeLiveEvents } from '../src/adapters/munder/canonicalFeed';
import { HQStore } from '../src/store/hqStore';
import type { LiveOfficeSource } from '../src/adapters/munder/liveSource';
import type { Container } from 'pixi.js';
import type { HQState } from '../src/domain/hq';
import type { AgentStatus } from '../src/domain/agents';

function initial(): HQState {
  return { agents: Object.fromEntries(structuredClone(mockAgents).map(a => [a.id, a])), tasks: Object.fromEntries(mockTasks.map(t => [t.id,t])), campaigns: { [mockCampaign.id]: mockCampaign }, events: [], handoffs: [], memorySignals: [], readOnly: true, mockMode: true, mode:'MOCK', sourceHealth:{source:'mock',mode:'MOCK',connection:'CONNECTED',eventsLoaded:0,agentsLoaded:0,tasksLoaded:0} };
}
test('camera zoom preserves pointer anchor and clamps zoom/pan bounds', () => {
  const camera={x:20,y:30,scale:{x:0.5,y:0.5,set(value:number){this.x=value;this.y=value;}}};
  const stage=camera as unknown as Container;
  const worldX=(200-camera.x)/camera.scale.x,worldY=(180-camera.y)/camera.scale.x;
  zoomAt(stage,2,200,180,0.4,1.4);
  assert.equal((200-camera.x)/camera.scale.x,worldX);
  assert.equal((180-camera.y)/camera.scale.x,worldY);
  zoomAt(stage,100,200,180,0.4,1.4); assert.equal(camera.scale.x,1.4);
  zoomAt(stage,0.001,200,180,0.4,1.4); assert.equal(camera.scale.x,0.4);
  camera.x=-9999; camera.y=9999;
  clampCamera(stage,{minX:-100,maxX:50,minY:-80,maxY:60});
  assert.equal(camera.x,-100); assert.equal(camera.y,60);
});
test('camera focus reaches an in-bounds target', () => {
  const camera={x:0,y:0} as Container;
  const bounds={minX:-100,maxX:50,minY:-80,maxY:60};
  const target={x:-60,y:40};
  let active=true;
  for(let frame=0;frame<200 && active;frame++) active=advanceCameraFocus(camera,target,bounds,16);
  assert.equal(active,false);
  assert.deepEqual({x:camera.x,y:camera.y},target);
});
test('camera focus clamps an out-of-bounds target and finishes at the limit', () => {
  const camera={x:0,y:0} as Container;
  const bounds={minX:-100,maxX:50,minY:-80,maxY:60};
  const target={x:-1000,y:1000};
  let active=true;
  for(let frame=0;frame<200 && active;frame++) active=advanceCameraFocus(camera,target,bounds,16);
  assert.equal(active,false);
  assert.deepEqual({x:camera.x,y:camera.y},{x:-100,y:60});
  assert.equal(advanceCameraFocus(camera,target,bounds,16),false);
  assert.deepEqual({x:camera.x,y:camera.y},{x:-100,y:60});
});
test('Centrar cancels focus and the next scene frame preserves the centered camera', () => {
  const world={x:-100,y:60,scale:{x:1,y:1,set(value:number){this.x=value;this.y=value;}},position:{set(x:number,y:number){world.x=x;world.y=y;}}};
  const scene={
    app:{screen:{width:630,height:630}},world,fitScale:1,
    focusTarget:{x:-1000,y:1000},elapsed:0,highlightUntil:0,
    zoneHighlight:{alpha:0},stationLights:new Map(),motions:new Map(),
    depthLayer:{sortChildren(){}},effects:[],
    constrainCamera(){clampCamera(world as unknown as Container,{minX:-450,maxX:40,minY:-45,maxY:105});},
    onZoom(_percent:number){},
  };
  OfficeScene.prototype.resetCamera.call(scene as unknown as OfficeScene);
  assert.equal(scene.focusTarget,undefined);
  const centered={x:world.x,y:world.y};
  OfficeScene.prototype['tick'].call(scene as unknown as OfficeScene,16);
  assert.deepEqual({x:world.x,y:world.y},centered);
});
test('camera focus replay after reset is deterministic', () => {
  const run=()=>{
    const world={x:0,y:0,scale:{x:1,y:1,set(value:number){this.x=value;this.y=value;}},position:{set(x:number,y:number){world.x=x;world.y=y;}}};
    const bounds={minX:-100,maxX:50,minY:-80,maxY:60};
    const target={x:-1000,y:1000};
    const positions:{x:number;y:number;active:boolean}[]=[];
    let active=true;
    for(let frame=0;frame<12;frame++) advanceCameraFocus(world as unknown as Container,target,bounds,16);
    const scene={app:{screen:{width:630,height:630}},world,fitScale:1,focusTarget:target,
      constrainCamera(){clampCamera(world as unknown as Container,{minX:-450,maxX:40,minY:-45,maxY:105});},
      onZoom(_percent:number){},
    };
    OfficeScene.prototype.resetCamera.call(scene as unknown as OfficeScene);
    assert.equal(scene.focusTarget,undefined);
    positions.push({x:world.x,y:world.y,active:false});
    for(let frame=0;frame<120 && active;frame++) {
      active=advanceCameraFocus(world as unknown as Container,target,bounds,16);
      positions.push({x:world.x,y:world.y,active});
    }
    return positions;
  };
  assert.deepEqual(run(),run());
});
test('pathfinding connects all 49 pairs and ends at the target', () => {
  for (const from of zoneOrder) for (const to of zoneOrder) {
    const route = routeBetweenZones(from, to);
    assert.deepEqual(route.at(-1), zones[to].workPoints[0]);
    assert.ok(route.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
  assert.deepEqual(routeBetweenZones('SUPERMEMORY_CORE','PUBLISHING'), [zones.WAR_ROOM.entrances[0],zones.ARIA_LINK.entrances[0],zones.PUBLISHING.entrances[0],zones.PUBLISHING.workPoints[0]]);
});
test('idle coordinates never drift; assignment starts a continuous route and task start does not teleport', () => {
  let state = initial();
  const motion = new AgentMotion(state.agents.research, 0);
  const start = { ...motion.position };
  motion.update(60000); assert.deepEqual(motion.position, start);
  state = reduceEventToVisualState(mockTimeline[0].event, state);
  motion.sync(state.agents.research);
  assert.deepEqual(motion.position, start); assert.ok(motion.walking);
  motion.update(100); assert.notDeepEqual(motion.position, start);
  assert.ok(Math.hypot(motion.position.x-start.x,motion.position.y-start.y) <= 18.001);
  const beforeStart = { ...motion.position };
  state = reduceEventToVisualState(mockTimeline[1].event, state);
  motion.sync(state.agents.research); assert.deepEqual(motion.position, beforeStart);
  motion.update(10000); assert.equal(motion.walking,false); assert.deepEqual(motion.position,zones.RESEARCH_LAB.workPoints[0]);
  const arrived = { ...motion.position }; motion.update(60000); assert.deepEqual(motion.position,arrived);
});
test('blocked agents stop and resume their event route', () => {
  const agent = { ...mockAgents[1], destinationZone: 'ARIA_LINK' as const };
  const motion = new AgentMotion(agent,0); motion.sync(agent); motion.update(100);
  motion.sync({ ...agent,status:'BLOCKED' }); const stopped={...motion.position};
  motion.update(10000); assert.deepEqual(motion.position,stopped);
  motion.sync({ ...agent,status:'RUNNING' }); motion.update(10000);
  assert.deepEqual(motion.position,zones.ARIA_LINK.workPoints[0]);
});
test('overflow positions do not recycle small-zone station coordinates', () => {
  const agent={...mockAgents[7],zone:'SUPERMEMORY_CORE' as const};
  const points=Array.from({length:8},(_,slot)=>new AgentMotion(agent,slot).position);
  assert.equal(new Set(points.map(point=>`${point.x}:${point.y}`)).size,points.length);
  assert.deepEqual(points[0],zones.SUPERMEMORY_CORE.workPoints[0]);
});
test('timeline covers IDLE/RUNNING/WAITING/BLOCKED/QA/COMPLETED and preserves read-only invariants', () => {
  let state = initial(); const statuses = new Set(Object.values(state.agents).map(a=>a.status));
  for (const {event} of mockTimeline) {
    const previous = state; const original = structuredClone(previous);
    state = reduceEventToVisualState(event,state); assert.deepEqual(previous,original);
    Object.values(state.agents).forEach(a=>statuses.add(a.status));
    assert.equal(state.readOnly,true); assert.equal(state.mockMode,true);
  }
  for (const status of ['IDLE','RUNNING','WAITING','BLOCKED','QA','COMPLETED'] as AgentStatus[]) {
    assert.ok(statuses.has(status), status); assert.ok(getStatusVisual(status).label);
  }
  assert.equal(state.campaigns[mockCampaign.id].progress,100);
  assert.equal(state.campaigns[mockCampaign.id].status,'MOCK_READY');
  assert.ok(Object.values(state.agents).every(agent=>agent.status==='COMPLETED'));
  assert.equal(state.agents['visual-qa'].securityState,'VISUAL_REVIEW_REQUIRED');
  assert.equal(state.agents.publisher.securityState,'APPROVAL_REQUIRED');
  assert.equal(state.memorySignals.at(-1)?.status,'ARCHIVED');
  const archived = mockTimeline.find(t=>t.event.type==='MEMORY_ARCHIVED')!.event;
  assert.equal(reduceEventToVisualState({...archived,verified:false},initial()).memorySignals.at(-1)?.status,'FAILED');
});
test('campaign progress follows workflow milestones, pauses on blockage and finishes at mock-ready', () => {
  let state=initial();
  const progress=[state.campaigns[mockCampaign.id].progress];
  for(const {event} of mockTimeline) {
    state=reduceEventToVisualState(event,state);
    progress.push(state.campaigns[mockCampaign.id].progress);
  }
  assert.deepEqual(progress,[0,8,15,25,35,35,35,42,50,58,68,74,80,86,91,95,95,98,98,98,98,100]);
  assert.equal(state.campaigns[mockCampaign.id].status,'MOCK_READY');
  assert.ok(progress.some(value=>value>8 && value<100));
});
test('campaign progress ignores invalid values and events for other campaigns', () => {
  const source=mockTimeline[0].event;
  for(const invalid of [NaN,Infinity,-1,101,'50']) {
    const state=reduceEventToVisualState({...source,payload:{progress:invalid}},initial());
    assert.equal(state.campaigns[mockCampaign.id].progress,0);
  }
  const unrelated=reduceEventToVisualState({...source,campaignId:'another-campaign'},initial());
  assert.equal(unrelated.campaigns[mockCampaign.id].progress,0);
});
test('replaying the same event sequence produces identical states regardless of wall clock', (t) => {
  let wallClock = 1000;
  const clock = t.mock.method(Date, 'now', () => wallClock);
  const replay = (startTime: number): HQState[] => {
    let state = initial();
    wallClock = startTime;
    return structuredClone(mockTimeline).map(({ event }) => {
      wallClock += 12345;
      state = reduceEventToVisualState(event, state);
      return state;
    });
  };
  const first = replay(1000);
  const second = replay(9000000000000);
  assert.equal(first.length, mockTimeline.length);
  first.forEach((state, index) => assert.deepEqual(second[index], state, `event ${index}`));
  assert.equal(clock.mock.callCount(), 0, 'reducer must not consult the wall clock');
});
test('handoff and asset receipt timestamps come from their events in epoch milliseconds', () => {
  const handoff = mockTimeline.find(({ event }) => event.type === 'HANDOFF_SENT')!.event;
  const asset = mockTimeline.find(({ event }) => event.type === 'ASSET_RECEIVED')!.event;
  const events = [
    { ...handoff, timestamp: '2026-01-01T00:00:00.000Z' },
    { ...asset, timestamp: '2026-01-01T00:00:02.500Z' },
  ];
  const state = events.reduce((current, event) => reduceEventToVisualState(event, current), initial());
  assert.deepEqual(state.handoffs.map(({ createdAt }) => createdAt), [1767225600000, 1767225602500]);
});
test('complete mock engine drives Research, Creative and Performance to their zones', () => {
  let state = initial(); const motions = Object.fromEntries(Object.values(state.agents).map((a,i)=>[a.id,new AgentMotion(a,i)]));
  let time=0;
  for (const {atMs,event} of mockTimeline) {
    for (const motion of Object.values(motions)) motion.update(atMs-time);
    state=reduceEventToVisualState(event,state);
    for (const [id,motion] of Object.entries(motions)) motion.sync(state.agents[id]);
    time=atMs;
  }
  for (const motion of Object.values(motions)) motion.update(20000);
  assert.equal(state.agents.research.zone,'RESEARCH_LAB');
  assert.equal(state.agents.creative.zone,'ARIA_LINK');
  assert.equal(state.agents.performance.zone,'SUPERMEMORY_CORE');
  assert.ok(Object.values(motions).every(m=>!m.walking));
});
test('store handles StrictMode initialization, selection, event ticks, restart and cleanup', async () => {
  const timers=new Map<number,()=>void>(); let id=0; let now=0;
  Object.defineProperty(globalThis,'window',{value:{setInterval:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearInterval:(key:number)=>timers.delete(key)},configurable:true});
  Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
  const first=hqStore.initialize(); hqStore.stop(); const second=hqStore.initialize(); await Promise.all([first,second]);
  assert.equal(timers.size,1);
  hqStore.selectAgent('creative'); assert.equal(hqStore.getSnapshot().selectedAgentId,'creative');
  now=3000; for (const tick of timers.values()) tick();
  assert.equal(hqStore.getSnapshot().agents.research.destinationZone,'RESEARCH_LAB');
  hqStore.selectEvent(mockTimeline[0].event.id); assert.equal(hqStore.getSnapshot().selectedAgentId,'orchestrator');
  hqStore.restartDemo(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(hqStore.getSnapshot().events.length,0); assert.equal(timers.size,1);
  assert.equal(hqStore.getSnapshot().campaigns[mockCampaign.id].progress,0);
  const replayProgress=()=>{
    const start=now;
    const values=[hqStore.getSnapshot().campaigns[mockCampaign.id].progress];
    for(const {atMs} of mockTimeline) {
      now=start+atMs;
      for(const tick of [...timers.values()]) tick();
      values.push(hqStore.getSnapshot().campaigns[mockCampaign.id].progress);
    }
    return values;
  };
  const firstProgress=replayProgress();
  hqStore.restartDemo(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(hqStore.getSnapshot().campaigns[mockCampaign.id].progress,0);
  assert.deepEqual(replayProgress(),firstProgress);
  hqStore.stop(); assert.equal(timers.size,0);
});
test('adapter boundaries contain no renderer imports, connections or external write operations', () => {
  const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
  for (const file of files('src/adapters').filter(f=>f.endsWith('.ts'))) {
    const code=readFileSync(file,'utf8');
    assert.doesNotMatch(code,/pixi|office\/|OfficeScene|fetch\s*\(|WebSocket|axios|https?:\/\//i,file);
  }
  assert.doesNotMatch(readFileSync('src/office/OfficeScene.ts','utf8'),/adapters\/|hqStore/);
  assert.doesNotMatch(readFileSync('src/store/hqReducer.ts','utf8'),/pixi|react|office\/|fetch\(/);
});

test('handoff stages approach, transfer and resume at original agent positions', () => {
  const from={x:120,y:220},to={x:340,y:260};
  const approach=handoffFrame(200,from,to);
  const transfer=handoffFrame(1000,from,to);
  const done=handoffFrame(1900,from,to);
  assert.equal(approach.phase,'approach');
  assert.ok(approach.senderOffset.x>0 && approach.receiverOffset.x<0);
  assert.equal(approach.packet.alpha,0);
  assert.equal(transfer.phase,'transfer');
  assert.ok(transfer.packet.x>from.x && transfer.packet.x<to.x);
  assert.equal(done.phase,'done');
  assert.deepEqual(done.senderOffset,{x:0,y:0});
  assert.deepEqual(done.receiverOffset,{x:0,y:0});
});

test('visual handoff and memory frames are deterministic for the same event and elapsed time', () => {
  const from={x:230,y:242},to={x:520,y:60};
  const times=[0,180,530,900,1500,1900,2500];
  const first=times.map(ms=>({handoff:handoffFrame(ms,from,to),memory:memoryFrame(ms,from,to)}));
  const second=times.map(ms=>({handoff:handoffFrame(ms,{...from},{...to}),memory:memoryFrame(ms,{...from},{...to})}));
  assert.deepEqual(first,second);
});

test('working agent reaches the exact station and stays there during work', () => {
  const source={...mockAgents[1],destinationZone:'RESEARCH_LAB' as const,status:'RUNNING' as const};
  const motion=new AgentMotion(source,1);
  motion.sync(source);
  assert.equal(motion.atStation('RESEARCH_LAB'),false);
  motion.update(10000);
  assert.equal(motion.atStation('RESEARCH_LAB'),true);
  assert.deepEqual(motion.position,motion.stationPoint('RESEARCH_LAB'));
  const atWork={...motion.position};
  for(let i=0;i<120;i++) motion.update(250);
  assert.deepEqual(motion.position,atWork);
});

test('memory signal travels to Core, receives, indexes and then settles', () => {
  const from={x:488,y:455},core=zones.SUPERMEMORY_CORE.anchor;
  const travel=memoryFrame(700,from,core);
  const receiving=memoryFrame(1500,from,core);
  const indexing=memoryFrame(2100,from,core);
  const stable=memoryFrame(2500,from,core);
  assert.equal(travel.phase,'travel');
  assert.ok(travel.signal.x>from.x && travel.signal.x<core.x);
  assert.equal(receiving.phase,'receiving');
  assert.deepEqual({x:receiving.signal.x,y:receiving.signal.y},{x:core.x,y:core.y-43});
  assert.equal(indexing.phase,'indexing');
  assert.equal(stable.phase,'done');
  assert.equal(stable.signal.alpha,0);
});

test('memory archive starts at the request position after Performance reaches Core', () => {
  const request=mockTimeline.find(({event})=>event.type==='MEMORY_SAVE_REQUESTED')!.event;
  const archive=mockTimeline.find(({event})=>event.type==='MEMORY_ARCHIVED')!.event;
  const motion=new AgentMotion(mockAgents.find(agent=>agent.id==='performance')!,0);
  const source={...motion.position};
  const pending=new PendingMemoryOrigins();
  pending.remember(request,motion.position);
  motion.sync({...mockAgents.find(agent=>agent.id==='performance')!,status:'WALKING',destinationZone:'SUPERMEMORY_CORE'});
  motion.update(8000);
  const destination={...motion.position};
  assert.notDeepEqual(destination,source);
  const origin=pending.consume(archive,destination);
  assert.deepEqual(origin,source);
  assert.notDeepEqual(origin,destination);
  const travelling=memoryFrame(700,origin,zones.SUPERMEMORY_CORE.anchor);
  assert.ok(travelling.signal.y>zones.SUPERMEMORY_CORE.anchor.y-43);
  assert.deepEqual(pending.consume(archive,destination),destination,'consumed origin must be removed');
});

test('memory origin reset and fallback replay deterministically', () => {
  const request=mockTimeline.find(({event})=>event.type==='MEMORY_SAVE_REQUESTED')!.event;
  const archive=mockTimeline.find(({event})=>event.type==='MEMORY_ARCHIVED')!.event;
  const pending=new PendingMemoryOrigins();
  const source=zones.GITHUB_HUB.workPoints[0];
  const fallback=zones.SUPERMEMORY_CORE.workPoints[0];
  const replay=()=>{
    pending.clear();
    pending.remember(request,source);
    const origin=pending.consume(archive,fallback);
    return {origin,frame:memoryFrame(700,origin,zones.SUPERMEMORY_CORE.anchor)};
  };
  assert.deepEqual(replay(),replay());
  pending.remember(request,source);
  pending.clear();
  assert.deepEqual(pending.consume(archive,fallback),fallback);
});

test('neither idle motion nor animation timelines introduce random walking', () => {
  const idle=new AgentMotion(mockAgents[0],0);
  const start={...idle.position};
  for(let i=0;i<400;i++) idle.update(250);
  assert.deepEqual(idle.position,start);
  const motionSource=readFileSync('src/office/agents/agentMotion.ts','utf8');
  const sceneSource=readFileSync('src/office/OfficeScene.ts','utf8');
  assert.doesNotMatch(motionSource+sceneSource,/Math\.random|crypto\.getRandomValues/);
});

test('demo reset reconstructs the same stations and event-driven route', () => {
  const run=()=>{
    let state=initial();
    const motion=new AgentMotion(state.agents.research,1);
    const positions=[{...motion.position}];
    for(const {event} of mockTimeline.slice(0,3)) {
      state=reduceEventToVisualState(event,state);
      motion.sync(state.agents.research);
      motion.update(2000);
      positions.push({...motion.position});
    }
    return {positions,state};
  };
  assert.deepEqual(run(),run());
});

const liveAgent = {...mockAgents[0],id:'agent-01',displayName:'Observed Agent',status:'RUNNING' as const,
  lastEventAt:'2026-01-02T03:04:05+02:00'};
const liveTask = {...mockTasks[0],id:'task-01',ownerAgentId:'agent-01'};
const liveEvent = {...mockTimeline[0].event,id:'event-01',source:'munder' as const,verified:true,
  actorId:'agent-01',taskId:'task-01',timestamp:'2026-01-02T03:04:05+02:00'};

test('LIVE roster [b] to [a,b] reassigns the existing motion and station slot', () => {
  const a={...liveAgent,id:'a',zone:'RESEARCH_LAB' as const};
  const b={...liveAgent,id:'b',zone:'RESEARCH_LAB' as const};
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([b],motions,true);
  const original=motions.get('b')!;
  assert.equal(original.slot,0);
  syncAgentMotions([b,a],motions,true);
  assert.equal(motions.get('b'),original,'existing motion must be retained');
  assert.equal(motions.get('a')!.slot,0);
  assert.equal(original.slot,1);
  original.update(10000);
  assert.deepEqual(original.position,original.stationPoint(b.zone));
  assert.equal(original.atStation(b.zone),true);
  assert.equal(new Set([...motions.values()].map(motion=>motion.slot)).size,2);
});

test('LIVE roster [a,b] to [b] frees slot zero and removes the departed motion', () => {
  const a={...liveAgent,id:'a',zone:'QA_LAB' as const};
  const b={...liveAgent,id:'b',zone:'QA_LAB' as const};
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([a,b],motions,true);
  const original=motions.get('b')!;
  syncAgentMotions([b],motions,true);
  assert.equal(motions.has('a'),false);
  assert.equal(motions.get('b'),original);
  assert.equal(original.slot,0);
  original.update(10000);
  assert.deepEqual(original.position,original.stationPoint(b.zone));
});

for(const status of ['BLOCKED','FAILED','QUARANTINED'] as const) {
  test(`${status} LIVE agent takes its new slot immediately without walking`, () => {
    const a={...liveAgent,id:'a',zone:'RESEARCH_LAB' as const};
    const b={...liveAgent,id:'b',zone:'RESEARCH_LAB' as const,status};
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions([b],motions,true);
    const original=motions.get('b')!;
    const oldPosition={...original.position};
    syncAgentMotions([b,a],motions,true);
    assert.equal(motions.get('b'),original);
    assert.deepEqual([motions.get('a')!.slot,original.slot],[0,1]);
    assert.notDeepEqual(original.position,oldPosition);
    assert.deepEqual(original.position,original.stationPoint('RESEARCH_LAB'));
    assert.notDeepEqual(original.position,motions.get('a')!.position);
    assert.equal(original.walking,false);
    assert.equal(stationLightKey(b,original,true),'RESEARCH_LAB:1');
    const settled={...original.position};
    original.update(10000);
    assert.deepEqual(original.position,settled);
    original.sync({...b,status:'RUNNING'});
    assert.equal(original.walking,false,'no impossible route remains after the immobile correction');
  });
}

test('immobile LIVE agent returns to the freed slot on [a,b] to [b]', () => {
  const a={...liveAgent,id:'a',zone:'QA_LAB' as const};
  const b={...liveAgent,id:'b',zone:'QA_LAB' as const,status:'BLOCKED' as const};
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([a,b],motions,true);
  const original=motions.get('b')!;
  assert.equal(original.slot,1);
  syncAgentMotions([b],motions,true);
  assert.equal(motions.has('a'),false);
  assert.equal(original.slot,0);
  assert.deepEqual(original.position,original.stationPoint('QA_LAB'));
  assert.equal(original.walking,false);
  original.update(10000);
  assert.deepEqual(original.position,original.stationPoint('QA_LAB'));
});

test('immobile LIVE agent from another current zone keeps its position until recovery', () => {
  const a={...liveAgent,id:'a',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const};
  const b={...liveAgent,id:'b',zone:'QA_LAB' as const,destinationZone:'RESEARCH_LAB' as const,status:'FAILED' as const};
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([b],motions,true);
  assert.deepEqual(motions.get('b')!.position,zones.QA_LAB.workPoints[0]);
  syncAgentMotions([b,a],motions,true);
  const failed=motions.get('b')!;
  assert.equal(failed.slot,1);
  assert.deepEqual(failed.position,zones.QA_LAB.workPoints[0]);
  assert.equal(failed.walking,false);
  failed.update(10000);
  assert.deepEqual(failed.position,zones.QA_LAB.workPoints[0]);
  motions.get('a')!.update(10000);
  assert.deepEqual(motions.get('a')!.position,motions.get('a')!.stationPoint('RESEARCH_LAB'));
  failed.sync({...b,status:'RUNNING'});
  failed.update(10000);
  assert.deepEqual(failed.position,failed.stationPoint('RESEARCH_LAB'));
  assert.notDeepEqual(failed.position,motions.get('a')!.position);
});

test('immobile LIVE agent repositions to an overflow slot without a nonexistent station light', () => {
  const blocked={...liveAgent,id:'z',zone:'RESEARCH_LAB' as const,status:'QUARANTINED' as const};
  const others=Array.from({length:5},(_,index)=>({...liveAgent,id:String.fromCharCode(97+index),zone:'RESEARCH_LAB' as const}));
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([blocked],motions,true);
  syncAgentMotions([blocked,...others],motions,true);
  const isolated=motions.get('z')!;
  assert.equal(isolated.slot,5);
  assert.deepEqual(isolated.position,isolated.stationPoint('RESEARCH_LAB'));
  assert.equal(isolated.walking,false);
  assert.equal(stationLightKey(blocked,isolated,true),undefined);
  const points=[...motions.values()].map(motion=>`${motion.position.x}:${motion.position.y}`);
  assert.equal(new Set(points).size,6);
});

for(const status of ['RUNNING','READY'] as const) {
  test(`${status} LIVE agent keeps the normal animated slot transition`, () => {
    const a={...liveAgent,id:'a',zone:'RESEARCH_LAB' as const};
    const b={...liveAgent,id:'b',zone:'RESEARCH_LAB' as const,status};
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions([b],motions,true);
    const original=motions.get('b')!;
    const start={...original.position};
    syncAgentMotions([a,b],motions,true);
    assert.deepEqual(original.position,start,'movable agents must not teleport');
    assert.equal(original.walking,true);
    original.update(10000);
    assert.deepEqual(original.position,original.stationPoint('RESEARCH_LAB'));
    assert.equal(original.walking,false);
  });
}

test('immobile LIVE roster ordering and reset produce identical unique final positions', () => {
  const agents=[
    {...liveAgent,id:'c',zone:'QA_LAB' as const,destinationZone:'RESEARCH_LAB' as const,status:'FAILED' as const},
    {...liveAgent,id:'a',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'b',zone:'RESEARCH_LAB' as const,status:'BLOCKED' as const},
  ];
  const replay=(input:typeof agents)=>{
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions([agents[2],agents[0]],motions,true);
    syncAgentMotions(input,motions,true);
    for(const motion of motions.values()) motion.update(10000);
    const result=agents.map(agent=>({id:agent.id,slot:motions.get(agent.id)!.slot,position:motions.get(agent.id)!.position}));
    assert.equal(new Set(result.map(value=>`${value.position.x}:${value.position.y}`)).size,result.length);
    return result;
  };
  const first=replay(agents);
  assert.deepEqual(replay([...agents].reverse()),first);
  assert.deepEqual(replay(agents),first);
});

for(const status of ['BLOCKED','FAILED','QUARANTINED'] as const) {
  test(`in-flight LIVE agent pauses at its real position on ${status} plus a slot change`, () => {
    const incoming={...liveAgent,id:'a',zone:'RESEARCH_LAB' as const};
    const moving={...liveAgent,id:'b',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const};
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions([moving],motions,true);
    const motion=motions.get('b')!;
    motion.update(350);
    const midpoint={...motion.position};
    assert.equal(motion.walking,true);
    const stopped={...moving,status};
    syncAgentMotions([stopped,incoming],motions,true);
    assert.equal(motion.slot,1);
    assert.deepEqual(motion.position,midpoint,'in-flight agents must not teleport');
    assert.equal(motion.atStation('RESEARCH_LAB'),false);
    assert.equal(motion.walking,false);
    motion.update(10000);
    assert.deepEqual(motion.position,midpoint,'immobile agents must stay stopped');
    motion.sync({...moving,status:'RUNNING'});
    assert.equal(motion.walking,true,'the original route must remain available on recovery');
    motion.update(10000);
    assert.deepEqual(motion.position,motion.stationPoint('RESEARCH_LAB'));
    assert.notDeepEqual(motion.position,motions.get('a')!.position);
  });
}

test('in-flight overflow keeps its position and resumes toward a unique deterministic endpoint', () => {
  const moving={...liveAgent,id:'z',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const};
  const residents=Array.from({length:5},(_,index)=>({...liveAgent,id:String.fromCharCode(97+index),zone:'RESEARCH_LAB' as const}));
  const replay=()=>{
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions([moving],motions,true);
    const motion=motions.get('z')!;
    motion.update(350);
    const midpoint={...motion.position};
    syncAgentMotions([...residents,{...moving,status:'BLOCKED' as const}],motions,true);
    assert.equal(motion.slot,5);
    assert.deepEqual(motion.position,midpoint);
    assert.equal(motion.atStation('RESEARCH_LAB'),false);
    assert.equal(stationLightKey(moving,motion,true),undefined);
    motion.update(10000);
    assert.deepEqual(motion.position,midpoint);
    motion.sync(moving);
    motion.update(10000);
    const positions=[...motions.values()].map(item=>`${item.position.x}:${item.position.y}`);
    assert.equal(new Set(positions).size,positions.length);
    return {slot:motion.slot,position:motion.position,positions};
  };
  assert.deepEqual(replay(),replay());
});

test('LIVE slots are unique per zone and independent of input order', () => {
  const agents=[
    {...liveAgent,id:'b',zone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'a',zone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'d',zone:'QA_LAB' as const},
    {...liveAgent,id:'c',zone:'QA_LAB' as const},
  ];
  const snapshot=(input:typeof agents)=>{
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions(input,motions,true);
    return Object.fromEntries([...motions].sort(([a],[b])=>a.localeCompare(b)).map(([id,motion])=>[id,{slot:motion.slot,station:motion.stationPoint(agents.find(agent=>agent.id===id)!.zone)}]));
  };
  assert.deepEqual(snapshot(agents),snapshot([...agents].reverse()));
  assert.deepEqual(Object.fromEntries(Object.entries(snapshot(agents)).map(([id,value])=>[id,value.slot])),{a:0,b:1,c:0,d:1});
  for (const zone of ['RESEARCH_LAB','QA_LAB'] as const) {
    const slots=agents.filter(agent=>agent.zone===zone).map(agent=>snapshot(agents)[agent.id].slot);
    assert.equal(new Set(slots).size,slots.length);
  }
});

test('slot reassignment preserves an in-flight route and MOCK keeps its input-order slots', () => {
  const a={...liveAgent,id:'a',zone:'RESEARCH_LAB' as const};
  const b={...liveAgent,id:'b',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const};
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([b],motions,true);
  const moving=motions.get('b')!;
  moving.update(250);
  syncAgentMotions([a,{...b,zone:'RESEARCH_LAB' as const}],motions,true);
  assert.equal(moving.slot,1);
  moving.update(10000);
  assert.deepEqual(moving.position,moving.stationPoint('RESEARCH_LAB'));
  const mockMotions=new Map<string,AgentMotion>();
  const mockOrder=[mockAgents[1],mockAgents[0]];
  syncAgentMotions(mockOrder,mockMotions,false);
  assert.deepEqual(mockOrder.map(agent=>mockMotions.get(agent.id)!.slot),[0,1]);
  assert.deepEqual(mockMotions.get(mockOrder[0].id)!.position,new AgentMotion(mockOrder[0],0).position);
});

test('LIVE roster replay after reset assigns the same slots and station positions', () => {
  const a={...liveAgent,id:'a',zone:'RESEARCH_LAB' as const};
  const b={...liveAgent,id:'b',zone:'RESEARCH_LAB' as const};
  const run=()=>{
    const motions=new Map<string,AgentMotion>();
    for(const roster of [[b],[a,b],[b]]) {
      syncAgentMotions(roster,motions,true);
      for(const motion of motions.values()) motion.update(10000);
    }
    return [...motions].map(([id,motion])=>({id,slot:motion.slot,position:motion.position}));
  };
  assert.deepEqual(run(),run());
});

test('LIVE agents from two origin zones reserve different slots in one destination', () => {
  const a={...liveAgent,id:'a',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const};
  const b={...liveAgent,id:'b',zone:'QA_LAB' as const,destinationZone:'RESEARCH_LAB' as const};
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([b,a],motions,true);
  assert.deepEqual([motions.get('a')!.slot,motions.get('b')!.slot],[0,1]);
  assert.deepEqual(motions.get('a')!.position,zones.WAR_ROOM.workPoints[0]);
  assert.deepEqual(motions.get('b')!.position,zones.QA_LAB.workPoints[0]);
  for(const motion of motions.values()) motion.update(10000);
  assert.notDeepEqual(motions.get('a')!.position,motions.get('b')!.position);
  assert.deepEqual(motions.get('a')!.position,motions.get('a')!.stationPoint('RESEARCH_LAB'));
  assert.deepEqual(motions.get('b')!.position,motions.get('b')!.stationPoint('RESEARCH_LAB'));
  assert.equal(stationLightKey(a,motions.get('a')!,true),'RESEARCH_LAB:0');
  assert.equal(stationLightKey(b,motions.get('b')!,true),'RESEARCH_LAB:1');
});

test('a LIVE resident moves to its reserved destination slot when an incoming agent sorts first', () => {
  const incoming={...liveAgent,id:'a',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const};
  const resident={...liveAgent,id:'b',zone:'RESEARCH_LAB' as const};
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions([resident,incoming],motions,true);
  const stationed=motions.get('b')!;
  assert.equal(stationed.slot,1);
  assert.equal(stationed.atStation('RESEARCH_LAB'),false);
  stationed.update(10000);
  assert.deepEqual(stationed.position,stationed.stationPoint('RESEARCH_LAB'));
  assert.equal(stationLightKey(resident,stationed,true),'RESEARCH_LAB:1');
  motions.get('a')!.update(10000);
  assert.notDeepEqual(stationed.position,motions.get('a')!.position);
});

test('three LIVE origins sharing a destination have unique target slots and station lights', () => {
  const agents=[
    {...liveAgent,id:'c',zone:'GITHUB_HUB' as const,destinationZone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'a',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'b',zone:'QA_LAB' as const,destinationZone:'RESEARCH_LAB' as const},
  ];
  const motions=new Map<string,AgentMotion>();
  syncAgentMotions(agents,motions,true);
  assert.deepEqual(['a','b','c'].map(id=>motions.get(id)!.slot),[0,1,2]);
  for(const motion of motions.values()) motion.update(10000);
  const keys=agents.map(agent=>stationLightKey(agent,motions.get(agent.id)!,true));
  assert.equal(new Set(keys).size,3);
  assert.deepEqual(new Set(keys),new Set(['RESEARCH_LAB:0','RESEARCH_LAB:1','RESEARCH_LAB:2']));
});

test('LIVE destination slots are independent across zones and input order', () => {
  const agents=[
    {...liveAgent,id:'d',zone:'WAR_ROOM' as const,destinationZone:'QA_LAB' as const},
    {...liveAgent,id:'b',zone:'GITHUB_HUB' as const,destinationZone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'a',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'c',zone:'PUBLISHING' as const,destinationZone:'QA_LAB' as const},
  ];
  const snapshot=(input:typeof agents)=>{
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions(input,motions,true);
    return Object.fromEntries([...motions].map(([id,motion])=>[id,motion.slot]).sort(([a],[b])=>a.localeCompare(b)));
  };
  assert.deepEqual(snapshot(agents),snapshot([...agents].reverse()));
  assert.deepEqual(snapshot(agents),{a:0,b:1,c:0,d:1});
  for(const destination of ['RESEARCH_LAB','QA_LAB']) {
    const slots=agents.filter(agent=>agent.destinationZone===destination).map(agent=>snapshot(agents)[agent.id]);
    assert.equal(new Set(slots).size,slots.length);
  }
});

test('LIVE destination slot replay after reset is deterministic and MOCK retains current-zone placement', () => {
  const agents=[
    {...liveAgent,id:'b',zone:'QA_LAB' as const,destinationZone:'RESEARCH_LAB' as const},
    {...liveAgent,id:'a',zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const},
  ];
  const run=()=>{
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions(agents,motions,true);
    for(const motion of motions.values()) motion.update(10000);
    return [...motions].map(([id,motion])=>({id,slot:motion.slot,position:motion.position}));
  };
  assert.deepEqual(run(),run());
  const mockMotions=new Map<string,AgentMotion>();
  syncAgentMotions(agents,mockMotions,false);
  assert.deepEqual(agents.map(agent=>mockMotions.get(agent.id)!.slot),[0,0]);
  assert.equal(stationLightKey(agents[0],mockMotions.get('b')!,false),undefined);
});

test('five and six LIVE agents in a normal zone have unique deterministic positions', () => {
  const agents=Array.from({length:6},(_,index)=>({...liveAgent,id:`normal-${index}`,zone:'RESEARCH_LAB' as const}));
  const positions=(input:typeof agents)=>{
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions(input,motions,true);
    for(const motion of motions.values()) motion.update(10000);
    return agents.slice(0,input.length).map(agent=>motions.get(agent.id)!.position);
  };
  for(const count of [5,6]) {
    const expected=positions(agents.slice(0,count));
    assert.equal(new Set(expected.map(point=>`${point.x}:${point.y}`)).size,count);
    assert.deepEqual(positions([...agents.slice(0,count)].reverse()),expected);
    assert.deepEqual(positions(agents.slice(0,count)),expected,'reset must replay identically');
  }
});

test('three and four LIVE agents in Supermemory Core have unique overflow positions', () => {
  const agents=Array.from({length:4},(_,index)=>({...liveAgent,id:`core-${index}`,zone:'SUPERMEMORY_CORE' as const}));
  for(const count of [3,4]) {
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions(agents.slice(0,count).reverse(),motions,true);
    for(const motion of motions.values()) motion.update(10000);
    const points=agents.slice(0,count).map(agent=>motions.get(agent.id)!.position);
    assert.equal(new Set(points.map(point=>`${point.x}:${point.y}`)).size,count);
    assert.deepEqual(points,agents.slice(0,count).map((agent,slot)=>new AgentMotion(agent,slot).position));
  }
});

test('mixed LIVE destinations keep independent slots and never reference absent station lights', () => {
  const agents=[
    ...Array.from({length:6},(_,index)=>({...liveAgent,id:`research-${index}`,zone:'WAR_ROOM' as const,destinationZone:'RESEARCH_LAB' as const})),
    ...Array.from({length:4},(_,index)=>({...liveAgent,id:`core-${index}`,zone:'QA_LAB' as const,destinationZone:'SUPERMEMORY_CORE' as const})),
  ];
  const lightKeys=new Set(zoneOrder.flatMap(zone=>Array.from({length:stationCapacity(zone)},(_,slot)=>`${zone}:${slot}`)));
  const run=(input:typeof agents)=>{
    const motions=new Map<string,AgentMotion>();
    syncAgentMotions(input,motions,true);
    for(const motion of motions.values()) motion.update(10000);
    return agents.map(agent=>{
      const motion=motions.get(agent.id)!;
      const key=stationLightKey(agent,motion,true);
      assert.ok(key===undefined || lightKeys.has(key));
      assert.equal(key===undefined,motion.slot>=stationCapacity(agent.destinationZone));
      return {id:agent.id,slot:motion.slot,position:motion.position,key};
    });
  };
  const first=run(agents);
  assert.deepEqual(run([...agents].reverse()),first);
  assert.deepEqual(run(agents),first);
  for(const zone of ['RESEARCH_LAB','SUPERMEMORY_CORE'] as const) {
    const group=first.filter(value=>agents.find(agent=>agent.id===value.id)!.destinationZone===zone);
    assert.equal(new Set(group.map(value=>value.slot)).size,group.length);
    assert.equal(new Set(group.map(value=>`${value.position.x}:${value.position.y}`)).size,group.length);
  }
});

test('canonical live agent and task snapshots preserve real IDs, status and optional fields', () => {
  const agents=normalizeLiveAgents([liveAgent]);
  const tasks=normalizeLiveTasks([liveTask]);
  assert.equal(agents[0].id,'agent-01');
  assert.equal(agents[0].status,'RUNNING');
  assert.equal(agents[0].lastEventAt,'2026-01-02T03:04:05+02:00');
  assert.equal(tasks[0].id,'task-01');
  assert.equal(tasks[0].ownerAgentId,'agent-01');
  const minimalAgent={id:'agent-min',displayName:'Agent',role:'Observer',status:'IDLE',zone:'WAR_ROOM',
    capabilities:[],securityState:'READ_ONLY'};
  const minimalTask={id:'task-min',title:'Observed task',status:'open'};
  assert.equal(normalizeLiveAgents([minimalAgent])[0].currentTaskId,undefined);
  assert.equal(normalizeLiveTasks([minimalTask])[0].dependsOn,undefined);
});

test('LIVE roster accepts its exact bound, empty and small feeds, and retains ID ordering', () => {
  const roster=Array.from({length:MAX_LIVE_AGENTS},(_,index)=>({...liveAgent,id:`agent-${String(index).padStart(2,'0')}`}));
  const expected=roster.map(agent=>agent.id);
  assert.equal(MAX_LIVE_AGENTS,32);
  assert.deepEqual(normalizeLiveAgents([...roster].reverse()).map(agent=>agent.id),expected);
  assert.deepEqual(normalizeLiveAgents(roster).map(agent=>agent.id),expected);
  assert.deepEqual(normalizeLiveAgents([]),[]);
  assert.deepEqual(normalizeLiveAgents([liveAgent]).map(agent=>agent.id),['agent-01']);
});

test('oversized LIVE roster is rejected before visiting agent records without exposing source data', () => {
  const roster=Array.from({length:MAX_LIVE_AGENTS+1},(_,index)=>({...liveAgent,id:`agent-${index}`}));
  Object.defineProperty(roster,0,{get(){throw new Error('source-private-payload-marker');}});
  assert.throws(()=>normalizeLiveAgents(roster),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/Live agent roster exceeds maximum/);
    assert.equal(error.message.includes('source-private-payload-marker'),false);
    return true;
  });
});

test('oversized LIVE refresh degrades atomically, never falls back to MOCK, then recovers', async () => {
  const valid=[liveAgent];
  let roster=[...valid];
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:'CONNECTED' as const,lastSuccessfulRead:'2026-01-02T01:04:10Z'};},
    async readAgents(){return roster;},
    async readTasks(){return [liveTask];},
    async readEvents(){return [liveEvent];},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  const first=store.getSnapshot();
  assert.equal(first.sourceHealth.connection,'CONNECTED');
  assert.deepEqual(Object.keys(first.agents),['agent-01']);
  roster=Array.from({length:MAX_LIVE_AGENTS+1},(_,index)=>({...liveAgent,id:`oversized-${index}`}));
  await store.refreshLive();
  const rejected=store.getSnapshot();
  assert.equal(rejected.mode,'LIVE_READ_ONLY');
  assert.equal(rejected.mockMode,false);
  assert.equal(rejected.sourceHealth.connection,'DEGRADED');
  assert.equal(rejected.sourceHealth.agentsLoaded,0);
  assert.equal(rejected.sourceHealth.tasksLoaded,0);
  assert.equal(rejected.sourceHealth.eventsLoaded,0);
  assert.deepEqual(rejected.agents,{});
  assert.deepEqual(rejected.tasks,{});
  assert.deepEqual(rejected.events,[]);
  assert.equal(rejected.sourceHealth.message?.includes('oversized-'),false);
  roster=[...valid];
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot(),first);
  store.stop();
});

test('LIVE task and dependency limits accept exact bounds and retain deterministic ordering', () => {
  const tasks=Array.from({length:MAX_LIVE_TASKS},(_,index)=>({...liveTask,id:`task-${String(index).padStart(3,'0')}`}));
  const ids=tasks.map(task=>task.id);
  assert.equal(MAX_LIVE_TASKS,256);
  assert.equal(MAX_TASK_DEPENDENCIES,32);
  assert.deepEqual(normalizeLiveTasks([...tasks].reverse()).map(task=>task.id),ids);
  assert.deepEqual(normalizeLiveTasks(tasks).map(task=>task.id),ids);
  const dependencies=Array.from({length:MAX_TASK_DEPENDENCIES},(_,index)=>`dependency-${index}`);
  assert.deepEqual(normalizeLiveTasks([{...liveTask,dependsOn:dependencies}])[0].dependsOn,dependencies);
  assert.deepEqual(normalizeLiveTasks([{...liveTask,dependsOn:[]}])[0].dependsOn,[]);
  assert.deepEqual(normalizeLiveTasks([liveTask]).map(task=>task.id),['task-01']);
  assert.deepEqual(normalizeLiveTasks([]),[]);
});

test('oversized LIVE task ledger is rejected before visiting any task or leaking its data', () => {
  const tasks=Array.from({length:MAX_LIVE_TASKS+1},(_,index)=>({...liveTask,id:`task-${index}`}));
  Object.defineProperty(tasks,0,{get(){throw new Error('source-private-task-marker');}});
  assert.throws(()=>normalizeLiveTasks(tasks),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/Live task collection exceeds maximum/);
    assert.equal(error.message.includes('source-private-task-marker'),false);
    return true;
  });
});

test('oversized task dependencies are rejected before visiting IDs or later tasks', () => {
  const dependencies=Array.from({length:MAX_TASK_DEPENDENCIES+1},(_,index)=>`dependency-${index}`);
  Object.defineProperty(dependencies,0,{get(){throw new Error('source-private-dependency-marker');}});
  const tasks=[{...liveTask,dependsOn:dependencies},{...liveTask,id:'later-task'}];
  Object.defineProperty(tasks,1,{get(){throw new Error('later-task-was-mapped');}});
  assert.throws(()=>normalizeLiveTasks(tasks),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/Task dependency collection exceeds maximum/);
    assert.equal(error.message.includes('source-private-dependency-marker'),false);
    assert.equal(error.message.includes('later-task-was-mapped'),false);
    return true;
  });
});

test('oversized task collections degrade the entire LIVE snapshot and a valid feed recovers', async () => {
  let tasks:unknown=[liveTask];
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:'CONNECTED' as const,lastSuccessfulRead:'2026-01-02T01:04:10Z'};},
    async readAgents(){return [liveAgent];},
    async readTasks(){return tasks;},
    async readEvents(){return [liveEvent];},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  const valid=store.getSnapshot();
  assert.equal(valid.sourceHealth.connection,'CONNECTED');
  const oversizedTasks=Array.from({length:MAX_LIVE_TASKS+1},(_,index)=>({...liveTask,id:`task-${index}`}));
  const oversizedDependencies=[{...liveTask,dependsOn:Array.from({length:MAX_TASK_DEPENDENCIES+1},(_,index)=>`dependency-${index}`)}];
  for(const invalid of [oversizedTasks,oversizedDependencies]) {
    tasks=invalid;
    await store.refreshLive();
    const rejected=store.getSnapshot();
    assert.equal(rejected.mode,'LIVE_READ_ONLY');
    assert.equal(rejected.mockMode,false);
    assert.equal(rejected.sourceHealth.connection,'DEGRADED');
    assert.equal(rejected.sourceHealth.agentsLoaded,0);
    assert.equal(rejected.sourceHealth.tasksLoaded,0);
    assert.equal(rejected.sourceHealth.eventsLoaded,0);
    assert.deepEqual(rejected.agents,{});
    assert.deepEqual(rejected.tasks,{});
    assert.deepEqual(rejected.events,[]);
    assert.equal(rejected.sourceHealth.message?.includes('dependency-'),false);
    tasks=[liveTask];
    await store.refreshLive();
    assert.deepEqual(store.getSnapshot(),valid);
  }
  store.stop();
});

test('LIVE event input accepts its exact bound with deterministic ordering', () => {
  const events=Array.from({length:MAX_LIVE_SOURCE_EVENTS},(_,index)=>({...liveEvent,id:`event-${String(index).padStart(4,'0')}`,
    timestamp:`2026-01-02T01:${String(Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}Z`}));
  assert.equal(MAX_LIVE_SOURCE_EVENTS,1000);
  const expected=events.map(event=>event.id).reverse();
  assert.deepEqual(normalizeLiveEvents(events).map(event=>event.id),expected);
  assert.deepEqual(normalizeLiveEvents([...events].reverse()).map(event=>event.id),expected);
  assert.deepEqual(normalizeLiveEvents([]),[]);
});

test('oversized LIVE event input is rejected before visiting or sorting source records', () => {
  const events=Array.from({length:MAX_LIVE_SOURCE_EVENTS+1},(_,index)=>({...liveEvent,id:`event-${index}`}));
  Object.defineProperty(events,0,{get(){throw new Error('source-private-event-marker');}});
  assert.throws(()=>normalizeLiveEvents(events),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/Live event collection exceeds maximum/);
    assert.equal(error.message.includes('source-private-event-marker'),false);
    return true;
  });
});

test('oversized event feed clears LIVE projection and a valid feed restores the 80-event window', async () => {
  const valid=Array.from({length:82},(_,index)=>({...liveEvent,id:`event-${index}`,
    timestamp:`2026-01-02T01:01:${String(index%60).padStart(2,'0')}.${String(index).padStart(4,'0')}Z`}));
  let feed=valid;
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:'CONNECTED' as const,lastSuccessfulRead:'2026-01-02T01:04:10Z'};},
    async readAgents(){return [liveAgent];},
    async readTasks(){return [liveTask];},
    async readEvents(){return feed;},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  const first=store.getSnapshot();
  assert.equal(first.sourceHealth.connection,'CONNECTED');
  assert.equal(first.sourceHealth.eventsLoaded,82);
  assert.equal(first.events.length,80);
  assert.equal(first.sourceHealth.lastSourceEvent,normalizeLiveEvents(valid)[0].timestamp);
  feed=Array.from({length:MAX_LIVE_SOURCE_EVENTS+1},(_,index)=>({...liveEvent,id:`oversized-${index}`}));
  await store.refreshLive();
  const rejected=store.getSnapshot();
  assert.equal(rejected.mode,'LIVE_READ_ONLY');
  assert.equal(rejected.mockMode,false);
  assert.equal(rejected.sourceHealth.connection,'DEGRADED');
  assert.equal(rejected.sourceHealth.eventsLoaded,0);
  assert.deepEqual(rejected.events,[]);
  assert.deepEqual(rejected.agents,{});
  assert.deepEqual(rejected.tasks,{});
  assert.equal(rejected.sourceHealth.message?.includes('oversized-'),false);
  feed=valid;
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot(),first);
  store.stop();
});

test('LIVE agent capabilities accept the exact bound without truncation and remain deterministic', () => {
  const capabilities=Array.from({length:MAX_AGENT_CAPABILITIES},(_,index)=>`capability-${index}`);
  assert.equal(MAX_AGENT_CAPABILITIES,32);
  const agents=[{...liveAgent,id:'b',capabilities},{...liveAgent,id:'a',capabilities:[]}];
  const expected=normalizeLiveAgents(agents);
  assert.deepEqual(expected.map(agent=>agent.id),['a','b']);
  assert.deepEqual(expected[0].capabilities,[]);
  assert.deepEqual(expected[1].capabilities,capabilities);
  assert.deepEqual(normalizeLiveAgents([...agents].reverse()),expected);
});

test('oversized agent capabilities are rejected before visiting any capability value', () => {
  const capabilities=Array.from({length:MAX_AGENT_CAPABILITIES+1},(_,index)=>`capability-${index}`);
  Object.defineProperty(capabilities,0,{get(){throw new Error('source-private-capability-marker');}});
  assert.throws(()=>normalizeLiveAgents([{...liveAgent,capabilities}]),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/Agent capability collection exceeds maximum/);
    assert.equal(error.message.includes('source-private-capability-marker'),false);
    return true;
  });
});

test('one oversized capability list invalidates the full LIVE snapshot and valid detail recovers', async () => {
  const capabilities=Array.from({length:MAX_AGENT_CAPABILITIES},(_,index)=>`capability-${index}`);
  const valid=[{...liveAgent,id:'a',capabilities}, {...liveAgent,id:'b',capabilities:[]}];
  let agents=valid;
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:'CONNECTED' as const,lastSuccessfulRead:'2026-01-02T01:04:10Z'};},
    async readAgents(){return agents;},
    async readTasks(){return [liveTask];},
    async readEvents(){return [liveEvent];},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  const first=store.getSnapshot();
  assert.deepEqual(first.agents.a.capabilities,capabilities);
  agents=[valid[0],{...valid[1],capabilities:[...capabilities,'extra']}];
  await store.refreshLive();
  const rejected=store.getSnapshot();
  assert.equal(rejected.mode,'LIVE_READ_ONLY');
  assert.equal(rejected.mockMode,false);
  assert.equal(rejected.sourceHealth.connection,'DEGRADED');
  assert.equal(rejected.sourceHealth.agentsLoaded,0);
  assert.deepEqual(rejected.agents,{});
  assert.deepEqual(rejected.tasks,{});
  assert.deepEqual(rejected.events,[]);
  assert.equal(rejected.sourceHealth.message?.includes('capability-'),false);
  agents=valid;
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot(),first);
  store.stop();
});

test('canonical live events retain source timestamps, deduplicate and order stably', (t) => {
  const clock=t.mock.method(Date,'now',()=>987654321);
  const later={...liveEvent,id:'event-02',timestamp:'2026-01-02T03:04:06+02:00'};
  const first=normalizeLiveEvents([liveEvent,later,{...liveEvent}]);
  const second=normalizeLiveEvents([later,{...liveEvent},liveEvent]);
  assert.deepEqual(first,second);
  assert.deepEqual(first.map(event=>event.id),['event-02','event-01']);
  assert.equal(first[1].timestamp,liveEvent.timestamp);
  assert.equal(clock.mock.callCount(),0);
  assert.equal(first[1].payload,undefined,'unreviewed payloads must not enter the renderer');
});

test('canonical event ordering preserves sub-millisecond precision and true ties use ID', () => {
  const early={...liveEvent,id:'a-early',timestamp:'2026-10-15T10:00:00.0001Z'};
  const late={...liveEvent,id:'z-late',timestamp:'2026-10-15T10:00:00.0009Z'};
  assert.deepEqual(normalizeLiveEvents([early,late]).map(event=>event.id),['z-late','a-early']);
  assert.deepEqual(normalizeLiveEvents([late,early]).map(event=>event.id),['z-late','a-early']);
  const equalA={...liveEvent,id:'a-tie',timestamp:'2026-10-15T10:00:00.1Z'};
  const equalB={...liveEvent,id:'b-tie',timestamp:'2026-10-15T12:00:00.100+02:00'};
  assert.deepEqual(normalizeLiveEvents([equalB,equalA]).map(event=>event.id),['a-tie','b-tie']);
  assert.deepEqual(normalizeLiveEvents([equalA,equalB]).map(event=>event.id),['a-tie','b-tie']);
  assert.deepEqual(normalizeLiveEvents([
    {...liveEvent,id:'millis',timestamp:'2026-10-15T10:00:00.123Z'},
    {...liveEvent,id:'offset',timestamp:'2026-10-15T12:00:00.124+02:00'},
  ]).map(event=>event.id),['offset','millis']);
  assert.throws(()=>normalizeLiveEvents([{...early,timestamp:'2026-02-30T10:00:00.0001Z'}]));
});

test('LIVE Source Health and the 80-event window use full fractional precision', async () => {
  const older=Array.from({length:79},(_,index)=>({...liveEvent,id:`older-${String(index).padStart(2,'0')}`,
    timestamp:`2026-10-15T09:${String(index%60).padStart(2,'0')}:00Z`}));
  const early={...liveEvent,id:'a-early',timestamp:'2026-10-15T10:00:00.0001Z'};
  const late={...liveEvent,id:'z-late',timestamp:'2026-10-15T10:00:00.0009Z'};
  let feed=[...older,early,late];
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:'CONNECTED',lastSuccessfulRead:'2026-10-15T10:00:01Z'};},
    async readAgents(){return [liveAgent];},
    async readTasks(){return [liveTask];},
    async readEvents(){return feed;},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  const first=store.getSnapshot();
  assert.equal(first.sourceHealth.lastSourceEvent,late.timestamp);
  assert.equal(first.sourceHealth.eventsLoaded,81);
  assert.equal(first.events.length,80);
  assert.deepEqual(first.events.slice(0,2).map(event=>event.id),['z-late','a-early']);
  feed=[...feed].reverse();
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot(),first);
  store.stop();

  const boundaryFeed=[...Array.from({length:79},(_,index)=>({...liveEvent,id:`newer-${index}`,
    timestamp:`2026-10-15T10:${String(Math.floor((index+1)/60)).padStart(2,'0')}:${String((index+1)%60).padStart(2,'0')}Z`})),early,late];
  const sorted=normalizeLiveEvents(boundaryFeed).slice(0,80);
  assert.equal(sorted.some(event=>event.id==='z-late'),true);
  assert.equal(sorted.some(event=>event.id==='a-early'),false);
});

test('canonical timestamps reject impossible calendar dates and out-of-range clock fields', () => {
  const invalid=[
    '2026-02-30T03:04:05Z','2026-04-31T03:04:05Z','2025-02-29T03:04:05Z',
    '2026-00-01T03:04:05Z','2026-13-01T03:04:05Z','2026-01-00T03:04:05Z',
    '2026-01-01T24:04:05Z','2026-01-01T03:60:05Z','2026-01-01T03:04:60Z',
    '2026-01-01T03:04:05+24:00','2026-01-01T03:04:05+02:60',
  ];
  for(const value of invalid) {
    assert.throws(()=>normalizeLiveEvents([{...liveEvent,timestamp:value}]),undefined,value);
    assert.throws(()=>normalizeLiveAgents([{...liveAgent,lastEventAt:value}]),undefined,value);
  }
});

test('canonical timestamps accept valid leap days and preserve the exact source representation', () => {
  for(const value of ['2026-01-02T03:04:05+02:00','2024-02-29T23:59:59.123Z']) {
    assert.equal(normalizeLiveEvents([{...liveEvent,timestamp:value}])[0].timestamp,value);
    assert.equal(normalizeLiveAgents([{...liveAgent,lastEventAt:value}])[0].lastEventAt,value);
  }
  const earlier={...liveEvent,id:'event-earlier',timestamp:'2024-02-29T23:59:59Z'};
  const later={...liveEvent,id:'event-later',timestamp:'2024-03-01T00:00:00Z'};
  assert.deepEqual(normalizeLiveEvents([earlier,later,earlier]).map(event=>event.id),['event-later','event-earlier']);
  assert.deepEqual(normalizeLiveEvents([later,earlier,earlier]).map(event=>event.id),['event-later','event-earlier']);
});

test('canonical live boundary rejects malformed records, unknown events and conflicting IDs', () => {
  assert.throws(()=>normalizeLiveAgents([{...liveAgent,id:undefined}]));
  assert.throws(()=>normalizeLiveAgents([{...liveAgent,status:'IMAGINARY'}]));
  assert.throws(()=>normalizeLiveAgents([liveAgent,liveAgent]));
  assert.throws(()=>normalizeLiveTasks([{...liveTask,approvalRequired:'yes'}]));
  assert.throws(()=>normalizeLiveTasks([{...liveTask,id:''}]));
  assert.throws(()=>normalizeLiveEvents([{...liveEvent,type:'UNKNOWN_EVENT'}]));
  assert.throws(()=>normalizeLiveEvents([{...liveEvent,timestamp:'yesterday'}]));
  assert.throws(()=>normalizeLiveEvents([liveEvent,{...liveEvent,label:'conflict'}]));
  assert.throws(()=>normalizeLiveEvents([{...liveEvent,source:'mock'}]));
});

test('LIVE disconnects without mock fallback, recovers from a canonical fixture and resets deterministically', async () => {
  let connected=false;
  let failRead=false;
  let reads=0;
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:connected ? 'CONNECTED' : 'DISCONNECTED',lastSuccessfulRead:connected ? '2026-01-02T01:04:10Z' : undefined};},
    async readAgents(){reads++;if(failRead) throw new Error('private source detail');return [liveAgent];},
    async readTasks(){reads++;return [liveTask];},
    async readEvents(){reads++;return [liveEvent];},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  assert.equal(store.getSnapshot().sourceHealth.connection,'DISCONNECTED');
  assert.equal(store.getSnapshot().mode,'LIVE_READ_ONLY');
  assert.deepEqual(Object.values(store.getSnapshot().agents),[]);
  assert.deepEqual(store.getSnapshot().events,[]);
  assert.equal(reads,0,'disconnected source must not be read');
  connected=true;
  await store.refreshLive();
  const connectedState=store.getSnapshot();
  assert.equal(connectedState.sourceHealth.connection,'CONNECTED');
  assert.equal(connectedState.sourceHealth.agentsLoaded,1);
  assert.equal(connectedState.sourceHealth.tasksLoaded,1);
  assert.equal(connectedState.sourceHealth.eventsLoaded,1);
  assert.equal(connectedState.sourceHealth.lastSourceEvent,liveEvent.timestamp);
  assert.equal(connectedState.agents['agent-01'].status,'RUNNING');
  failRead=true;
  await store.refreshLive();
  assert.equal(store.getSnapshot().sourceHealth.connection,'DEGRADED');
  assert.equal(store.getSnapshot().sourceHealth.message?.includes('private source detail'),false);
  assert.deepEqual(store.getSnapshot().agents,{});
  failRead=false;
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot(),connectedState);
  connected=false;
  await store.refreshLive();
  assert.equal(store.getSnapshot().sourceHealth.connection,'DISCONNECTED');
  assert.deepEqual(store.getSnapshot().agents,{});
  await store.switchMode('MOCK');
  const firstMock=store.getSnapshot();
  assert.equal(firstMock.mode,'MOCK');
  assert.equal(Object.keys(firstMock.agents).length,mockAgents.length);
  await store.switchMode('MOCK');
  assert.deepEqual(store.getSnapshot(),firstMock);
  store.stop();
});

test('Source Health rejects impossible lastSuccessfulRead and preserves valid source text', async (t) => {
  const clock=t.mock.method(Date,'now',()=>987654321);
  let timestamp='2026-02-30T03:04:05Z';
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:'CONNECTED',lastSuccessfulRead:timestamp};},
    async readAgents(){return [liveAgent];},
    async readTasks(){return [liveTask];},
    async readEvents(){return [liveEvent];},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  for(const invalid of [
    '2026-02-30T03:04:05Z','2026-04-31T03:04:05Z','2025-02-29T03:04:05Z',
    '2026-01-01T24:04:05Z','2026-01-01T03:60:05Z','2026-01-01T03:04:60Z',
  ]) {
    timestamp=invalid;
    await store.refreshLive();
    const state=store.getSnapshot();
    assert.equal(state.mode,'LIVE_READ_ONLY');
    assert.equal(state.sourceHealth.connection,'DEGRADED');
    assert.equal(state.sourceHealth.lastSuccessfulRead,undefined);
    assert.deepEqual(state.agents,{});
  }
  timestamp='2024-02-29T23:59:59.123+02:00';
  await store.refreshLive();
  const valid=store.getSnapshot();
  assert.equal(valid.sourceHealth.connection,'CONNECTED');
  assert.equal(valid.sourceHealth.lastSuccessfulRead,timestamp);
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot(),valid);
  assert.equal(clock.mock.callCount(),0);
  store.stop();
});

test('LIVE exposes only the newest 80 canonical events while retaining the deduplicated source count', async () => {
  const feed=Array.from({length:103},(_,index)=>({...liveEvent,id:`history-${String(index).padStart(3,'0')}`,
    timestamp:`2026-01-02T${String(Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}:00Z`}));
  let reverse=false;
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:'CONNECTED',lastSuccessfulRead:'2026-01-02T02:00:00Z'};},
    async readAgents(){return [liveAgent];},
    async readTasks(){return [liveTask];},
    async readEvents(){return [...(reverse ? [...feed].reverse() : feed),feed[0]];},
  };
  const store=new HQStore(source);
  await store.switchMode('LIVE_READ_ONLY');
  const first=store.getSnapshot();
  assert.equal(first.events.length,80);
  assert.equal(first.sourceHealth.eventsLoaded,103);
  assert.equal(first.events[0].id,'history-102');
  assert.equal(first.events.at(-1)?.id,'history-023');
  assert.equal(first.sourceHealth.lastSourceEvent,feed[102].timestamp);
  reverse=true;
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot(),first);
  store.stop();
});

function liveSelectionFixture() {
  const first={...liveAgent,id:'agent-01'};
  const second={...liveAgent,id:'agent-02'};
  const firstEvent={...liveEvent,id:'event-01',actorId:first.id};
  const secondEvent={...liveEvent,id:'event-02',actorId:second.id,timestamp:'2026-01-02T03:04:06+02:00'};
  const feed={
    connection:'CONNECTED' as 'CONNECTED'|'DISCONNECTED',
    agents:[first,second],
    events:[firstEvent,secondEvent],
  };
  const source:LiveOfficeSource={
    async getSourceStatus(){return {connection:feed.connection,lastSuccessfulRead:'2026-01-02T01:04:10Z'};},
    async readAgents(){return feed.agents;},
    async readTasks(){return [liveTask];},
    async readEvents(){return feed.events;},
  };
  return {store:new HQStore(source),feed,first,second,firstEvent,secondEvent};
}

test('LIVE refresh preserves a selected agent that still exists', async () => {
  const {store}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectAgent('agent-02');
  await store.refreshLive();
  assert.equal(store.getSnapshot().selectedAgentId,'agent-02');
  assert.equal(store.getSnapshot().selectedEventId,undefined);
  store.stop();
});

test('LIVE refresh preserves a selected event that still exists', async () => {
  const {store}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectEvent('event-02');
  await store.refreshLive();
  assert.equal(store.getSnapshot().selectedEventId,'event-02');
  store.stop();
});

test('LIVE refresh preserves agent and event selections independently', async () => {
  const {store}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectEvent('event-01');
  store.selectAgent('agent-02');
  await store.refreshLive();
  assert.equal(store.getSnapshot().selectedAgentId,'agent-02');
  assert.equal(store.getSnapshot().selectedEventId,'event-01');
  store.stop();
});

test('LIVE refresh falls back to the first canonical agent when the selected agent disappears', async () => {
  const {store,feed,first}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectEvent('event-01');
  store.selectAgent('agent-02');
  feed.agents=[first];
  await store.refreshLive();
  assert.equal(store.getSnapshot().selectedAgentId,first.id);
  assert.equal(store.getSnapshot().selectedEventId,'event-01');
  store.stop();
});

test('LIVE refresh clears only a selected event that disappears', async () => {
  const {store,feed,firstEvent}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectEvent('event-02');
  feed.events=[firstEvent];
  await store.refreshLive();
  assert.equal(store.getSnapshot().selectedEventId,undefined);
  assert.equal(store.getSnapshot().selectedAgentId,'agent-02');
  store.stop();
});

test('LIVE event selection survives a changed feed order', async () => {
  const {store,feed,firstEvent,secondEvent}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectEvent('event-01');
  feed.events=[
    {...firstEvent,timestamp:'2026-01-02T03:04:09+02:00'},
    {...secondEvent,timestamp:'2026-01-02T03:04:08+02:00'},
  ];
  await store.refreshLive();
  assert.deepEqual(store.getSnapshot().events.map(event=>event.id),['event-01','event-02']);
  assert.equal(store.getSnapshot().selectedEventId,'event-01');
  store.stop();
});

test('LIVE empty feed clears both selections without inventing a fallback', async () => {
  const {store,feed}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectEvent('event-02');
  feed.agents=[];
  feed.events=[];
  await store.refreshLive();
  assert.equal(store.getSnapshot().selectedAgentId,undefined);
  assert.equal(store.getSnapshot().selectedEventId,undefined);
  assert.deepEqual(store.getSnapshot().agents,{});
  assert.deepEqual(store.getSnapshot().events,[]);
  store.stop();
});

test('LIVE disconnect clears selections and recovery uses current fallback without hidden persistence', async () => {
  const {store,feed}=liveSelectionFixture();
  await store.switchMode('LIVE_READ_ONLY');
  store.selectEvent('event-02');
  feed.connection='DISCONNECTED';
  await store.refreshLive();
  assert.equal(store.getSnapshot().sourceHealth.connection,'DISCONNECTED');
  assert.equal(store.getSnapshot().selectedAgentId,undefined);
  assert.equal(store.getSnapshot().selectedEventId,undefined);
  feed.connection='CONNECTED';
  await store.refreshLive();
  assert.equal(store.getSnapshot().selectedAgentId,'agent-01');
  assert.equal(store.getSnapshot().selectedEventId,undefined);
  store.stop();
});

test('MOCK event projection retains its existing 80-event limit', () => {
  const source=mockTimeline[0].event;
  let state=initial();
  for(let index=0;index<103;index++) state=reduceEventToVisualState({...source,id:`mock-history-${index}`},state);
  assert.equal(state.events.length,80);
  assert.equal(state.events[0].id,'mock-history-102');
  assert.equal(state.events.at(-1)?.id,'mock-history-23');
});

test('live adapter boundary exposes reads only and no transport or write implementation', () => {
  const boundary=readFileSync('src/adapters/munder/liveSource.ts','utf8');
  assert.doesNotMatch(boundary,/\b(?:fetch|WebSocket|XMLHttpRequest|writeFile|unlink|rmSync|sendMessage|publish|deleteTask)\s*\(/i);
  assert.doesNotMatch(boundary,/OfficeScene|pixi|node:fs|process\.env/i);
});
