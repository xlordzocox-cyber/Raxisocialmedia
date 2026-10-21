import type { HQState } from '../domain/hq';
import type { HQEvent } from '../domain/events';
interface RuntimeTask {id:string;status:string;title:string;simulated:boolean;result:unknown}
interface RuntimeEvent {id:number;workspace_id:string;agent_id:string|null;task_id:string;event_type:string;source_kind:string;evidence_status:string;occurred_at:string;payload:{simulated:boolean;stage:string;leaseUntil:string}}
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
  const running=e.event_type==='RUNTIME_ACKNOWLEDGED'&&task.status==='RUNNING'&&Date.parse(e.payload.leaseUntil)>now;
  hq.agents[e.agent_id]={id:e.agent_id,displayName:stage==='DIRECTOR'?'Director IA':'Investigador',role:stage,status:running?'RUNNING':task.status==='COMPLETED'?'COMPLETED':task.status==='BLOCKED'?'BLOCKED':'IDLE',zone:stage==='DIRECTOR'?'WAR_ROOM':'RESEARCH_LAB',currentTaskId:task.id,capabilities:['authorized-read-only-task'],securityState:'READ_ONLY',lastEventAt:e.occurred_at};
  hq.tasks[task.id]={id:task.id,title:task.title,status:task.status==='RUNNING'&&!running?'BLOCKED':task.status,ownerAgentId:e.agent_id};
  const type:HQEvent['type']=e.event_type==='RUNTIME_ACKNOWLEDGED'?'TASK_STARTED':e.event_type==='RUNTIME_RESULT_COMMITTED'?'TASK_COMPLETED':'AGENT_BLOCKED';
  hq.events.push({id:'RUNTIME-'+e.id,timestamp:e.occurred_at,type,label:e.event_type,actorId:e.agent_id,taskId:e.task_id,source:'runtime',verified:true});
 }
 hq.sourceHealth={...hq.sourceHealth,connection:'CONNECTED',lastSuccessfulRead:s.serverTime,agentsLoaded:Object.keys(hq.agents).length,eventsLoaded:hq.events.length,tasksLoaded:s.tasks.filter(t=>!t.simulated).length};
 return {hq,tasks:structuredClone(s.tasks)};
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
   this.received=this.clock();this.latency=Math.max(0,this.received-began);const projected=projectRuntime(raw,this.owner,this.workspace,this.latency);this.raw=raw;this.publish({phase:'ready',...projected});
  }catch(error){if(generation===this.generation&&!this.retired){this.raw=undefined;this.publish({phase:error instanceof Error&&error.message==='SERVICE_NOT_DEPLOYED'?'unavailable':'error',hq:empty(),tasks:[]});}}
  })().finally(()=>{this.reading=null;});return this.reading;
 }
 expire(){if(this.retired||!this.raw)return;const projected=projectRuntime(this.raw,this.owner,this.workspace,this.latency+Math.max(0,this.clock()-this.received));
  if(JSON.stringify(projected.hq.agents)!==JSON.stringify(this.state.hq.agents))this.publish({phase:'ready',...projected});
 }
 dispose(){this.retired=true;this.generation++;this.raw=undefined;this.publish({phase:'loading',hq:empty(),tasks:[]});}
}
