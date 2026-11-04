import type {HQState} from '../src/domain/hq';
import type {HQEvent} from '../src/domain/events';
import {mockAgents} from '../src/adapters/mock/mockScenario';
export function signalEvent(patch:Partial<HQEvent>={}):HQEvent{return {id:'signal-fixture',type:'QA_REQUESTED',timestamp:'2000-01-01T00:00:00Z',label:'Synthetic only',source:'munder',verified:true,actorId:'a',taskId:'t',...patch};}
export function signalsFixture(mode:HQState['mode']='MOCK'):HQState{return {
  agents:{a:{...mockAgents[0],id:'a',displayName:'Agente sintético A',status:'BLOCKED',securityState:'READ_ONLY',currentTaskId:'t',campaignId:undefined},b:{...mockAgents[1],id:'b',displayName:'Agente sintético B',status:'IDLE',securityState:'WRITE_DISABLED',currentTaskId:undefined,campaignId:undefined}},
  tasks:{t:{id:'t',title:'Tarea sintética',status:'BLOCKED',ownerAgentId:'a'}},campaigns:{},events:[signalEvent()],handoffs:[],memorySignals:[],readOnly:true,
  mockMode:mode==='MOCK',mode,selectedAgentId:'a',sourceHealth:{source:mode==='MOCK'?'mock':mode==='LIVE_READ_ONLY'?'munder':'codex',mode,connection:'CONNECTED',agentsLoaded:2,tasksLoaded:1,eventsLoaded:1},
};}
