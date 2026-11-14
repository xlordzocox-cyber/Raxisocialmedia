import type { HQState } from '../domain/hq';
import type { HQEvent } from '../domain/events';
interface RuntimeTask {id:string;status:string;title:string;simulated:boolean;result:unknown}
interface RuntimeEvent {id:number;workspace_id:string;agent_id:string|null;task_id:string;event_type:string;source_kind:string;evidence_status:string;occurred_at:string;payload:{simulated:boolean;stage:string;leaseUntil:string;phase?:string;operationalReceiptOnly?:boolean;providerAcknowledged?:boolean}}
interface OfficeSnapshot {workspaceId:string;ownerId:string;serverTime:string;tasks:RuntimeTask[];events:RuntimeEvent[]}
const empty=():HQState=>({agents:{},tasks:{},campaigns:{},events:[],handoffs:[],memorySignals:[],readOnly:true,mockMode:false,mode:'LIVE_READ_ONLY',sourceHealth:{source:'runtime',mode:'LIVE_READ_ONLY',connection:'DISCONNECTED',agentsLoaded:0,tasksLoaded:0,eventsLoaded:0}});
export { empty as emptyRuntimeHQ };
export function projectRuntime(raw:unknown,owner:string,workspace:string,elapsed=0):{hq:HQState;tasks:RuntimeTask[]} {
 const s=raw as OfficeSnapshot;
 if(!s||s.ownerId!==owner||s.workspaceId!==workspace||!Number.isFinite(Date.parse(s.serverTime))||!Array.isArray(s.tasks)||s.tasks.length>100||!Array.isArray(s.events)||s.events.length>1000)throw Error('Invalid runtime snapshot');
 if(new Set(s.tasks.map(t=>t.id)).size!==s.tasks.length||new Set(s.events.map(e=>e.id)).size!==s.events.length)throw Error('Duplicate runtime records');
 for(const t of s.tasks)if(typeof t.simulated!=='boolean'||typeof t.title!=='string'||t.title.length>1500||!['QUEUED','RUNNING','BLOCKED','COMPLETED','FAILED','CANCELED'].includes(t.status))throw Error('Invalid runtime task');
 const hq=empty();const now=Date.parse(s.serverTime)+Math.max(0,elapsed);
 for(const e of [...s.events].sort((a,b)=>a.id-b.id)) {
  if(e.workspace_id!==workspace||!Number.isSafeInteger(e.id)||e.id<1||!Number.isFinite(Date.parse(e.occurred_at)))throw Error('Foreign or malformed event');
  const task=s.tasks.find(t=>t.id===e.task_id);if(!task)throw Error('Orphan runtime event');
  if(task.simulated||e.source_kind!=='AGENT_EXECUTOR'||e.evidence_status!=='VERIFIED'||e.payload?.simulated!==false)continue;
  const stage=e.payload.stage;if(!['DIRECTOR','RESEARCHER'].includes(stage)||!e.agent_id)continue;
  // Only these two durable transitions have an equivalent HQ visual event.
  // OUTCOME_UNKNOWN, LEASE_UNKNOWN and future types must not be mislabeled AGENT_BLOCKED.
  const dispatch=e.event_type==='RUNTIME_DISPATCH_AUTHORIZED' && e.payload.phase==='DISPATCH_AUTHORIZED' &&
   e.payload.operationalReceiptOnly===true && e.payload.providerAcknowledged===false &&
   task.status==='QUEUED' && Date.parse(e.payload.leaseUntil)>now;
  const type:HQEvent['type']|undefined=dispatch?'TASK_ASSIGNED':e.event_type==='RUNTIME_ACKNOWLEDGED'?'TASK_STARTED':e.event_type==='RUNTIME_RESULT_COMMITTED'?'TASK_COMPLETED':undefined;
  if(!type)continue;
  const running=type==='TASK_STARTED'&&task.status==='RUNNING'&&Date.parse(e.payload.leaseUntil)>now;
  hq.agents[e.agent_id]={id:e.agent_id,displayName:stage==='DIRECTOR'?'Director IA':'Investigador',role:stage,status:dispatch?'WAITING':running?'RUNNING':task.status==='COMPLETED'?'COMPLETED':task.status==='BLOCKED'?'BLOCKED':'IDLE',zone:stage==='DIRECTOR'?'WAR_ROOM':'RESEARCH_LAB',currentTaskId:task.id,capabilities:['authorized-read-only-task'],securityState:'READ_ONLY',lastEventAt:e.occurred_at};
  hq.tasks[task.id]={id:task.id,title:task.title,status:task.status==='RUNNING'&&!running?'UNCONFIRMED':task.status,ownerAgentId:e.agent_id};
  hq.events.push({id:'RUNTIME-'+e.id,timestamp:e.occurred_at,type,label:e.event_type,actorId:e.agent_id,taskId:e.task_id,source:'runtime',verified:true});
 }
 hq.sourceHealth={...hq.sourceHealth,connection:'CONNECTED',lastSuccessfulRead:s.serverTime,agentsLoaded:Object.keys(hq.agents).length,eventsLoaded:hq.events.length,tasksLoaded:s.tasks.filter(t=>!t.simulated).length};
 return {hq,tasks:structuredClone(s.tasks)};
}
/**
 * A newly observed, durable runtime acknowledgement may trigger one visual route.
 * This is a UI metaphor for a verified state transition, not a claim about the
 * agent's physical location. Never replay history from cold start/reconnection.
 *
 * Crucially, this does not create an event, task, permission or execution: all
 * evidence and RUNNING/lease checks come from the canonical server projection.
 */
export function applyVerifiedRuntimeMotion(previous: HQState | null, next: HQState): HQState {
 if(!previous || previous.mode!=='LIVE_READ_ONLY' || next.mode!=='LIVE_READ_ONLY' ||
    previous.sourceHealth.source!=='runtime' || next.sourceHealth.source!=='runtime' ||
    previous.sourceHealth.connection!=='CONNECTED' || next.sourceHealth.connection!=='CONNECTED')return next;
 const seen=new Set(previous.events.map(event=>event.id));
 let updated:HQState['agents']|undefined;
 for(const event of next.events) {
  if((event.type!=='TASK_STARTED' && event.type!=='TASK_ASSIGNED') || !event.verified || event.source!=='runtime' ||
     seen.has(event.id) || !event.actorId || !event.taskId)continue;
  const agent=Object.hasOwn(next.agents,event.actorId)?next.agents[event.actorId]:undefined;
  const task=Object.hasOwn(next.tasks,event.taskId)?next.tasks[event.taskId]:undefined;
  const currentDispatch=event.type==='TASK_ASSIGNED' && agent?.status==='WAITING' && task?.status==='QUEUED';
  const currentStart=event.type==='TASK_STARTED' && agent?.status==='RUNNING' && task?.status==='RUNNING';
  if(!agent || !task || agent.currentTaskId!==event.taskId || task.ownerAgentId!==agent.id ||
     (!currentDispatch && !currentStart) || Object.hasOwn(previous.agents,agent.id))continue;
  // Intake zones are a visual convention; the only claim of real work is the
  // authenticated, verified runtime event/active lease. Existing sprites do not teleport.
  const from=agent.role==='DIRECTOR'?'GITHUB_HUB':agent.role==='RESEARCHER'?'WAR_ROOM':undefined;
  if(!from || from===agent.zone)continue;
  updated??={...next.agents};
  updated[agent.id]={...agent,zone:from,destinationZone:agent.zone};
 }
 return updated?{...next,agents:updated}:next;
}

export class RuntimeOfficeStore {
 private state:{phase:'loading'|'ready'|'unavailable'|'error';hq:HQState;tasks:RuntimeTask[]}={phase:'loading',hq:empty(),tasks:[]};
 private generation=0;private retired=false;private reading:Promise<void>|null=null;private listeners=new Set<()=>void>();
 private raw:unknown;private received=0;private latency=0;
 constructor(private read:()=>Promise<unknown>,private owner:string,private workspace:string,private clock=()=>Date.now()){}
 getSnapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private publish(next:typeof this.state){this.state=next;this.listeners.forEach(fn=>fn());}
 load(){if(this.retired)return Promise.resolve();if(this.reading)return this.reading;
  const generation=this.generation;const began=this.clock();
  this.reading=(async()=>{try{const raw=await this.read();if(this.retired||generation!==this.generation)return;
   this.received=this.clock();this.latency=Math.max(0,this.received-began);const projected=projectRuntime(raw,this.owner,this.workspace,this.latency);
   const previous=this.state.phase==='ready'?this.state.hq:null;
   this.raw=raw;this.publish({phase:'ready',hq:applyVerifiedRuntimeMotion(previous,projected.hq),tasks:projected.tasks});
  }catch(error){if(generation===this.generation&&!this.retired){this.raw=undefined;this.publish({phase:error instanceof Error&&error.message==='SERVICE_NOT_DEPLOYED'?'unavailable':'error',hq:empty(),tasks:[]});}}
  })().finally(()=>{this.reading=null;});return this.reading;
 }
 expire(){if(this.retired||!this.raw)return;const projected=projectRuntime(this.raw,this.owner,this.workspace,this.latency+Math.max(0,this.clock()-this.received));
  if(JSON.stringify(projected.hq.agents)!==JSON.stringify(this.state.hq.agents))this.publish({phase:'ready',...projected});
 }
 dispose(){this.retired=true;this.generation++;this.raw=undefined;this.publish({phase:'loading',hq:empty(),tasks:[]});}
}
