import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mockAgents, mockTimeline, mockTasks, mockCampaign } from '../src/adapters/mock/mockScenario';
import { reduceEventToVisualState } from '../src/store/hqReducer';
import { hqStore } from '../src/store/hqStore';
import { AgentMotion } from '../src/office/agents/agentMotion';
import { routeBetweenZones } from '../src/office/pathfinding';
import { zones, zoneOrder } from '../src/office/zones';
import { getStatusVisual } from '../src/office/agents/agentVisualState';
import { zoomAt, clampCamera } from '../src/office/camera';
import type { Container } from 'pixi.js';
import type { HQState } from '../src/domain/hq';
import type { AgentStatus } from '../src/domain/agents';

function initial(): HQState {
  return { agents: Object.fromEntries(structuredClone(mockAgents).map(a => [a.id, a])), tasks: Object.fromEntries(mockTasks.map(t => [t.id,t])), campaigns: { [mockCampaign.id]: mockCampaign }, events: [], handoffs: [], memorySignals: [], readOnly: true, mockMode: true };
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
test('agent seats stay bounded in small zones even for higher slot indices', () => {
  const agent={...mockAgents[7],zone:'SUPERMEMORY_CORE' as const};
  const motion=new AgentMotion(agent,7);
  assert.ok(Math.abs(motion.position.x-zones.SUPERMEMORY_CORE.workPoints[0].x)<=26);
  assert.ok(Math.abs(motion.position.y-zones.SUPERMEMORY_CORE.workPoints[0].y)<=32);
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
  assert.equal(state.memorySignals.at(-1)?.status,'ARCHIVED');
  const archived = mockTimeline.find(t=>t.event.type==='MEMORY_ARCHIVED')!.event;
  assert.equal(reduceEventToVisualState({...archived,verified:false},initial()).memorySignals.at(-1)?.status,'FAILED');
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
