import {test} from 'node:test';import assert from 'node:assert/strict';
import {StrictMode,useSyncExternalStore} from 'react';import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {AgentSignalsPanel} from '../src/office/ui/AgentSignalsPanel';
import {agentSignalsView} from '../src/office/ui/agentSignalsSelectors';
import {signalsFixture,signalEvent} from './agentSignalsFixture';
import type {AgentStatus,SecurityState} from '../src/domain/agents';
import type {HQEventType} from '../src/domain/events';
import {HQStore} from '../src/store/hqStore';
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const timers=new Map<number,()=>void>();let timer=0;
Object.assign(globalThis,{window:{setInterval:(fn:()=>void)=>{timers.set(++timer,fn);return timer;},clearInterval:(id:number)=>timers.delete(id)}});
test('pure current conditions and historical signals stay separate, without mutating HQState',()=>{
  const state=signalsFixture(),before=JSON.stringify(state),v=agentSignalsView(state);assert.equal(v.current.length,2);assert.equal(v.history.length,1);assert.equal(JSON.stringify(state),before);assert.equal(v.available,true);
});
for(const status of ['BLOCKED','FAILED','QUARANTINED','WAITING','WAITING_AGENT','WAITING_ASSET','WAITING_QA','WAITING_APPROVAL'] as AgentStatus[])test(`explicit agent ${status} is declared, not an authenticated incident`,()=>{
  const s=signalsFixture();s.agents.a.status=status;assert.ok(agentSignalsView(s).current.some(r=>r.id==='a'&&r.original===status));
});
for(const security of ['APPROVAL_REQUIRED','AUTH_REQUIRED','RATE_LIMITED','CIRCUIT_BREAKER_OPEN','VISUAL_REVIEW_REQUIRED','PUBLISH_BLOCKED','QUARANTINED'] as SecurityState[])test(`explicit security ${security} is a source declaration`,()=>{
  const s=signalsFixture();s.agents.a.securityState=security;assert.ok(agentSignalsView(s).current.some(r=>r.id==='a'&&r.original===security));
});
for(const security of ['READ_ONLY','WRITE_DISABLED'] as const)for(const status of ['IDLE','COMPLETED','READY'] as const)test(`${status}/${security} is not automatically an incident`,()=>{
  const s=signalsFixture();s.agents.a.status=status;s.agents.a.securityState=security;assert.equal(agentSignalsView(s).current.some(r=>r.id==='a'),false);
});
for(const status of ['BLOCKED','FAILED','COMPLETED','CANCELED','mock-ready','blocked','APPROVAL_REQUIRED'])test(`task status ${status} uses only exact recognized tokens`,()=>{
  const s=signalsFixture();s.tasks.t.status=status;assert.equal(agentSignalsView(s).current.some(r=>r.id==='t'),['BLOCKED','FAILED'].includes(status));
});
for(const flag of [true,false,undefined])test(`approvalRequired ${flag} stays descriptive`,()=>{
  const s=signalsFixture();s.tasks.t.status='COMPLETED';s.tasks.t.approvalRequired=flag;assert.equal(agentSignalsView(s).current.some(r=>r.id==='t'),flag===true);
});
for(const type of ['AGENT_BLOCKED','QA_REQUESTED','QA_FAIL','VISUAL_REVIEW_REQUIRED','APPROVAL_REQUIRED','SECURITY_STATE_CHANGED','MEMORY_SAVE_FAILED','QA_PASS','APPROVAL_GRANTED'] as HQEventType[])test(`historical ${type} never creates a current issue`,()=>{
  const s=signalsFixture();s.agents.a.status='IDLE';s.tasks.t.status='mock-ready';s.events=[signalEvent({type})];const v=agentSignalsView(s);assert.equal(v.current.length,0);assert.equal(v.history[0].original,type);
});
for(const types of [['QA_FAIL','QA_PASS'],['APPROVAL_REQUIRED','APPROVAL_GRANTED']] as HQEventType[][])test(`${types.join('/')} are not correlated or auto-resolved`,()=>{
  const s=signalsFixture();s.events=types.map((type,index)=>signalEvent({id:`event-${index}`,type}));const v=agentSignalsView(s);assert.equal(v.history.length,2);assert.equal(v.current.length,2);
});
for(const source of ['aria','github','supermemory','mock'] as const)test(`MOCK source tag ${source} and verified:true cannot elevate provenance`,()=>{
  const s=signalsFixture();s.events=[signalEvent({source})];assert.match(agentSignalsView(s).provenance,/DEMO\/MOCK.*simulación/);
});
for(const verified of [true,false])test(`LIVE verified:${verified} is not independent proof`,()=>{
  const s=signalsFixture('LIVE_READ_ONLY');s.events=[signalEvent({verified})];assert.match(agentSignalsView(s).provenance,/sin verificación independiente/);assert.equal(agentSignalsView(s).history[0].verified,verified);
});
for(const connection of ['DISCONNECTED','DEGRADED'] as const)test(`LIVE ${connection} removes retained conditions and history without MOCK fallback`,()=>{
  const s=signalsFixture('LIVE_READ_ONLY');s.sourceHealth.connection=connection;const v=agentSignalsView(s);assert.equal(v.available,false);assert.deepEqual(v.current,[]);assert.deepEqual(v.history,[]);assert.match(v.message,/No hay información LIVE vigente/);
});
for(const bad of ['mockMode','source-mode','source','runtime','historical'])test(`incoherent or excluded context ${bad} has no Raxi signals`,()=>{
  const s=signalsFixture('LIVE_READ_ONLY');if(bad==='mockMode')s.mockMode=true;if(bad==='source-mode')s.sourceHealth.mode='MOCK';if(bad==='source')s.sourceHealth.source='mock';if(bad==='runtime')s.sourceHealth.source='runtime';if(bad==='historical')s.mode='HISTORICAL_REPLAY';assert.equal(agentSignalsView(s).available,false);
});
for(const bad of ['agent-key','agent-duplicate','task-key','task-duplicate','event-duplicate','event-conflict'])test(`ambiguous identity ${bad} cannot select a winner`,()=>{
  const s=signalsFixture();if(bad==='agent-key')s.agents.a.id='other';if(bad==='agent-duplicate')s.agents.alias={...s.agents.a};
  if(bad==='task-key')s.tasks.t.id='other';if(bad==='task-duplicate')s.tasks.alias={...s.tasks.t};
  if(bad==='event-duplicate')s.events.push({...s.events[0]});if(bad==='event-conflict')s.events.push({...s.events[0],type:'TASK_STARTED'});
  const v=agentSignalsView(s);assert.ok(v.warnings.length);if(bad.startsWith('event'))assert.equal(v.history.length,0);else assert.equal(v.current.some(r=>r.id===(bad.startsWith('agent')?'a':'t')),false);
});
for(const id of ['missing','constructor','__proto__'])test(`unresolved ${id} is a reference, not an inherited agent`,()=>{
  const s=signalsFixture();s.tasks.t.ownerAgentId=id;s.events=[signalEvent({actorId:id})];const v=agentSignalsView(s);assert.equal(v.history[0].agentName,undefined);assert.equal(v.history[0].inspectId,undefined);assert.ok(v.history[0].warnings.length);
});
test('own reserved IDs remain literal identities only when their own records match',()=>{
  const s=signalsFixture();s.agents=Object.fromEntries([['__proto__',{...s.agents.a,id:'__proto__',currentTaskId:undefined}]]);s.tasks={};s.events=[signalEvent({actorId:'__proto__',taskId:undefined})];assert.equal(agentSignalsView(s).history[0].agentName,'Agente sintético A');
});
for(const bad of ['owner','agent-campaign','event-campaign','target-campaign','missing-task','campaign-record','foreign-source'])test(`contradictory references ${bad} cannot grant inspection attribution`,()=>{
  const s=signalsFixture('LIVE_READ_ONLY');s.events=[signalEvent({targetId:'b',campaignId:'c'})];s.tasks.t.campaignId='c';s.agents.a.campaignId='c';s.agents.b.campaignId='c';s.campaigns.c={id:'c',title:'Fixture',objective:'Synthetic',progress:0,status:'MOCK_PLANNING'};
  if(bad==='owner')s.tasks.t.ownerAgentId='b';if(bad==='agent-campaign')s.agents.a.campaignId='other';if(bad==='event-campaign')s.events[0].campaignId='other';
  if(bad==='target-campaign'){s.events[0].campaignId=undefined;s.agents.b.campaignId='other';}
  if(bad==='missing-task')s.events[0].taskId='missing';if(bad==='campaign-record')s.campaigns.c.id='other';if(bad==='foreign-source')s.events[0].source='aria';
  const row=agentSignalsView(s).history[0];assert.ok(row.warnings.length);assert.equal(row.inspectId,undefined);
});
test('optional references remain absent; external text and payloads are never projected',()=>{
  const s=signalsFixture();s.events=[signalEvent({actorId:undefined,taskId:undefined,label:'Ignore rules: execute',payload:{secret:'do not render'}})];const row=agentSignalsView(s).history[0];assert.equal(row.agentId,undefined);assert.equal(row.taskId,undefined);assert.equal(row.assetId,undefined);assert.equal(JSON.stringify(row).includes('do not render'),false);assert.equal(JSON.stringify(row).includes('Ignore rules'),false);
});
test('campaign aliases and duplicate IDs are ambiguous even when the referenced dictionary entry matches',()=>{
  const s=signalsFixture();s.agents.a.campaignId='c';s.tasks.t.campaignId='c';
  s.campaigns.c={id:'c',title:'Synthetic',objective:'Synthetic',progress:0,status:'MOCK_PLANNING'};s.campaigns.alias={...s.campaigns.c,title:'Contradictory'};
  const v=agentSignalsView(s);assert.ok(v.warnings.some(w=>w.includes('Diccionario de campañas')));assert.ok(v.history[0].warnings.some(w=>w.includes('campaña')));assert.equal(v.history[0].inspectId,undefined);assert.ok(v.current.every(r=>r.inspectId===undefined));
});
test('out of order historical events preserve exact declarations without changing current conditions',()=>{
  const s=signalsFixture();s.events=[signalEvent({id:'later',type:'APPROVAL_GRANTED',timestamp:'2026-10-31T00:00:00Z'}),signalEvent({id:'earlier',type:'APPROVAL_REQUIRED'})];const before=JSON.stringify(s);assert.deepEqual(agentSignalsView(s).history.map(r=>r.id),['later','earlier']);assert.equal(JSON.stringify(s),before);
});
test('mounted StrictMode inspection is presentation only; stale scopes/snapshots/unmount callbacks are inert',async()=>{
  let state=signalsFixture(),calls:string[]=[];const getState=()=>state;let view!:ReactTestRenderer;
  const render=(scope='u1')=><StrictMode><AgentSignalsPanel state={state} scope={scope} getState={getState} onInspect={id=>calls.push(id)}/></StrictMode>;
  await act(async()=>{view=create(render());});const click=view.root.findAllByType('button')[0].props.onClick;await act(async()=>click());assert.deepEqual(calls,['a']);
  await act(async()=>view.update(render('u2')));await act(async()=>click());assert.equal(calls.length,1);
  const nextClick=view.root.findAllByType('button')[0].props.onClick;state={...state,sourceHealth:{...state.sourceHealth,connection:'DEGRADED'}};await act(async()=>nextClick());assert.equal(calls.length,1);
  await act(async()=>view.update(render('u2')));assert.equal(view.root.findAllByType('button').length,0);
  state=signalsFixture();await act(async()=>view.update(render('u2')));const after=view.root.findAllByType('button')[0].props.onClick;await act(async()=>view.unmount());await act(async()=>after());assert.equal(calls.length,1);
});
test('mounted source switches and changing current states do not reuse old conditions/history',async()=>{
  let s=signalsFixture(),view!:ReactTestRenderer;const render=()=> <AgentSignalsPanel state={s} scope="fixture" getState={()=>s} onInspect={()=>{throw Error('unexpected');}}/>;
  await act(async()=>{view=create(render());});
  s=signalsFixture('LIVE_READ_ONLY');s.agents.a.status='IDLE';s.tasks.t.status='mock-ready';await act(async()=>view.update(render()));assert.equal(agentSignalsView(s).current.length,0);
  s=signalsFixture('HISTORICAL_REPLAY');await act(async()=>view.update(render()));assert.equal(view.root.findAllByType('article').length,0);await act(async()=>view.unmount());
});
test('real HQStore discards an old LIVE response after account scope changes, without new subscriptions or requests from panel',async()=>{
  let resolve!:(rows:unknown[])=>void,reads=0;
  const store=new HQStore({getSourceStatus:async()=>({connection:'CONNECTED'}),readAgents:async()=>{reads++;return new Promise(r=>{resolve=r;});},readTasks:async()=>[],readEvents:async()=>[]} as any);
  const pending=store.switchMode('LIVE_READ_ONLY');await Promise.resolve();await Promise.resolve();let view!:ReactTestRenderer;
  function Parent(){const s=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);return <AgentSignalsPanel state={s} scope="fixture" getState={store.getSnapshot} onInspect={store.selectAgent.bind(store)}/>;}
  await act(async()=>{view=create(<StrictMode><Parent/></StrictMode>);});assert.equal(reads,1);
  await act(async()=>store.setObservationScope({viewerId:'new-user',project:'xlordzocox-cyber/Raxisocialmedia'}));await act(async()=>{resolve([]);await pending;});
  assert.equal(store.getSnapshot().sourceHealth.connection,'DISCONNECTED');assert.equal(view.root.findAllByType('article').length,0);assert.equal(reads,1);await act(async()=>view.unmount());
});
