import type { HQState } from '../domain/hq';
import type { HQEvent } from '../domain/events';
/** Read-only, owner/workspace-scoped projection sent to the primary office. */
export type RuntimeOfficeSink = (scope:{owner:string;workspace:string},hq:HQState|null)=>void;
interface RuntimeTask {id:string;status:string;title:string;simulated:boolean;result:unknown}
interface RuntimeEvent {id:number;workspace_id:string;agent_id:string|null;task_id:string;event_type:string;source_kind:string;evidence_status:string;occurred_at:string;payload:{simulated:boolean;stage:string;leaseUntil:string;phase?:string;operationalReceiptOnly?:boolean;providerAcknowledged?:boolean;targetAgentId?:string;artifact?:string}}
interface RuntimeProfile {id:string;role:string;display_name:string;runtime_status:string}
interface OfficeSnapshot {workspaceId:string;ownerId:string;serverTime:string;tasks:RuntimeTask[];events:RuntimeEvent[];profiles?:RuntimeProfile[]}
// Claude-led team (Modo Estudio): each verified stage maps to one of the 7 office rooms.
export const RUNTIME_STAGES={
 DIRECTOR:{displayName:'Director IA',zone:'WAR_ROOM'},
 RESEARCHER:{displayName:'Investigador',zone:'RESEARCH_LAB'},
 CREATIVE:{displayName:'Director Creativo',zone:'WAR_ROOM'},
 PRODUCTION:{displayName:'Producción Aria',zone:'ARIA_LINK'},
 QA:{displayName:'QA Visual',zone:'QA_LAB'},
 COPY:{displayName:'Copy y Publicación',zone:'PUBLISHING'},
 ARCHIVIST:{displayName:'Archivista',zone:'SUPERMEMORY_CORE'},
} as const;
type RuntimeStage=keyof typeof RUNTIME_STAGES;
// Only these deliveries exist: each stage hands over exactly one kind of finished work.
const HANDOFF_ARTIFACTS:Partial<Record<RuntimeStage,Record<string,string>>>={
 DIRECTOR:{RESEARCH_BRIEF:'El Director entrega el encargo de investigación',STRATEGY_BRIEF:'El Director entrega la estrategia aprobada al Creativo',CAMPAIGN_PACKAGE:'El Director entrega la campaña aprobada a Copy'},
 RESEARCHER:{RESEARCH_REPORT:'Entrega del reporte de investigación'},
 CREATIVE:{DESIGN_PACKAGE:'Entrega del diseño de campaña al Director'},
 COPY:{SOCIAL_COPY:'Copy entrega el texto de la publicación a QA'},
 QA:{QA_REPORT:'QA entrega su reporte al Director'},
};
const isStage=(s:unknown):s is RuntimeStage=>typeof s==='string'&&Object.prototype.hasOwnProperty.call(RUNTIME_STAGES,s);
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
  if(task.simulated||e.evidence_status!=='VERIFIED'||e.payload?.simulated!==false)continue;
  const stage=e.payload.stage;if(!isStage(stage)||!e.agent_id)continue;
  // Aria Studio receipts are first-party evidence only for the Production stage.
  if(!(e.source_kind==='AGENT_EXECUTOR'||(e.source_kind==='ARIA_MCP'&&stage==='PRODUCTION')))continue;
  // A verified handoff of the research report: shown as a delivery, never changes anyone's status.
  if(e.event_type==='RUNTIME_HANDOFF'){
   const label=typeof e.payload.artifact==='string'&&Object.hasOwn(HANDOFF_ARTIFACTS[stage]??{},e.payload.artifact)?HANDOFF_ARTIFACTS[stage]![e.payload.artifact]:undefined;
   if(label&&e.source_kind==='AGENT_EXECUTOR'&&typeof e.payload.targetAgentId==='string'&&e.payload.targetAgentId&&e.payload.targetAgentId!==e.agent_id)
    hq.events.push({id:'RUNTIME-'+e.id,timestamp:e.occurred_at,type:'HANDOFF_SENT',label,actorId:e.agent_id,targetId:e.payload.targetAgentId,taskId:e.task_id,source:'runtime',verified:true});
   continue;
  }
  // Dispatch admission is WAITING, never proof of provider execution.
  // ACK/RESULT are separate receipts; UNKNOWN and future types remain unprojected.
  const dispatch=e.event_type==='RUNTIME_DISPATCH_AUTHORIZED' && e.payload.phase==='DISPATCH_AUTHORIZED' &&
   e.payload.operationalReceiptOnly===true && e.payload.providerAcknowledged===false &&
   task.status==='QUEUED' && Date.parse(e.payload.leaseUntil)>now;
  const type:HQEvent['type']|undefined=dispatch?'TASK_ASSIGNED':e.event_type==='RUNTIME_ACKNOWLEDGED'?'TASK_STARTED':e.event_type==='RUNTIME_RESULT_COMMITTED'?'TASK_COMPLETED':undefined;
  if(!type)continue;
  const running=type==='TASK_STARTED'&&task.status==='RUNNING'&&Date.parse(e.payload.leaseUntil)>now;
  hq.agents[e.agent_id]={id:e.agent_id,displayName:RUNTIME_STAGES[stage].displayName,role:stage,status:dispatch?'WAITING':running?'RUNNING':task.status==='COMPLETED'?'COMPLETED':task.status==='BLOCKED'?'BLOCKED':'IDLE',zone:RUNTIME_STAGES[stage].zone,currentTaskId:task.id,capabilities:['authorized-read-only-task'],securityState:'READ_ONLY',lastEventAt:e.occurred_at};
  hq.tasks[task.id]={id:task.id,title:task.title,status:task.status==='RUNNING'&&!running?'UNCONFIRMED':task.status,ownerAgentId:e.agent_id};
  hq.events.push({id:'RUNTIME-'+e.id,timestamp:e.occurred_at,type,label:e.event_type,actorId:e.agent_id,taskId:e.task_id,source:'runtime',verified:true});
 }
 // Registered team members are shown idle in their room. Only verified events above can make them work.
 if(s.profiles!==undefined){
  if(!Array.isArray(s.profiles)||s.profiles.length>50)throw Error('Invalid runtime profiles');
  for(const p of s.profiles){
   if(!p||typeof p.id!=='string'||!p.id||typeof p.display_name!=='string'||p.display_name.length>80)throw Error('Invalid runtime profile');
   if(p.runtime_status!=='CONNECTED'||!isStage(p.role)||hq.agents[p.id])continue;
   hq.agents[p.id]={id:p.id,displayName:p.display_name,role:p.role,status:'IDLE',zone:RUNTIME_STAGES[p.role].zone,capabilities:['registered-profile'],securityState:'READ_ONLY'};
  }
 }
 hq.sourceHealth={...hq.sourceHealth,connection:'CONNECTED',lastSuccessfulRead:s.serverTime,agentsLoaded:Object.keys(hq.agents).length,eventsLoaded:hq.events.length,tasksLoaded:s.tasks.filter(t=>!t.simulated).length};
 return {hq,tasks:structuredClone(s.tasks)};
}
/**
 * A newly observed, durable runtime dispatch/acknowledgement may trigger one visual route.
 * This is a UI metaphor for a verified state transition, not a claim about the
 * agent's physical location. Never replay history from cold start/reconnection.
 *
 * Crucially, this does not create an event, task, permission or execution: all
 * evidence and QUEUED/WAITING or RUNNING/lease checks come from the server projection.
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
  // Intake zones are a visual convention, NOT physical positions. A verified
  // dispatch is preparation, not provider execution; existing sprites never teleport.
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
