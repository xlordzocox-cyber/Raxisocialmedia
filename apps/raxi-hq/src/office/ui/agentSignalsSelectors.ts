import type { HQState } from '../../domain/hq';
import { getOwnAgent } from '../../domain/agents';
import { officeDeclarationContext } from '../declarationContext';
import { officeAgentView, taskOwnerMetadata } from './agentViewSelectors';
import { taskBoardView } from './taskBoardSelectors';

const agentCategories:Record<string,string>={BLOCKED:'Bloqueo declarado',FAILED:'Fallo declarado',QUARANTINED:'Restricción declarada',WAITING:'Espera declarada',WAITING_AGENT:'Espera declarada',WAITING_ASSET:'Espera declarada',WAITING_QA:'Espera declarada',WAITING_APPROVAL:'Espera declarada'};
const securityCategories:Record<string,string>={APPROVAL_REQUIRED:'Requisito de revisión declarado',AUTH_REQUIRED:'Seguridad declarada',RATE_LIMITED:'Límite declarado',CIRCUIT_BREAKER_OPEN:'Seguridad declarada',VISUAL_REVIEW_REQUIRED:'Revisión solicitada',PUBLISH_BLOCKED:'Bloqueo declarado',QUARANTINED:'Restricción declarada'};
const eventTypes=new Set(['AGENT_BLOCKED','QA_REQUESTED','QA_FAIL','VISUAL_REVIEW_REQUIRED','APPROVAL_REQUIRED','SECURITY_STATE_CHANGED','MEMORY_SAVE_FAILED','QA_PASS','APPROVAL_GRANTED']);
export interface AgentSignal {
  key:string;id:string;category:string;original:string;agentId?:string;agentName?:string;targetId?:string;
  taskId?:string;campaignId?:string;assetId?:string;timestamp?:string;source:string;verified?:boolean;
  warnings:string[];inspectId?:string;
}
/** Pure projection of admitted office records. Never an incident/approval ledger. */
export function agentSignalsView(state:HQState){
  const {demo,live}=officeDeclarationContext(state);
  const available=demo||live;
  const message=state.mode==='HISTORICAL_REPLAY'?'La captura histórica de Codex representa un ejecutor externo; no acredita bloqueos, QA ni aprobaciones de Raxi.'
    :!available?state.mode==='LIVE_READ_ONLY'?'No hay información LIVE vigente para confirmar avisos o bloqueos.':'Contexto de procedencia inconsistente; sin señales vigentes.':'';
  const provenance=demo?'DEMO/MOCK · simulación · sin actividad productiva':live?'Estado declarado por la fuente · sin verificación independiente de ejecución':'Fuente no disponible para avisos de Raxi';
  const current:AgentSignal[]=[],history:AgentSignal[]=[],warnings:string[]=[];
  if(!available)return {available:false,current,history,warnings,message,provenance};
  const entries=Object.entries(state.agents),ids=entries.map(([,a])=>a.id);
  const invalidAgents=entries.some(([key,a])=>key!==a.id)||new Set(ids).size!==ids.length;
  if(invalidAgents)warnings.push('Diccionario de agentes inconsistente: IDs repetidos o discordantes; sin atribuciones de agente.');
  const agent=(id?:string)=>{const a=invalidAgents?undefined:getOwnAgent(state.agents,id);return a?.id===id?a:undefined;};
  const board=taskBoardView(state);
  if(board.invalidIdentity)warnings.push('Diccionario de tareas inconsistente: IDs repetidos o discordantes; sin atribuciones de tarea.');
  warnings.push(...board.referenceWarnings);
  const campaignEntries=Object.entries(state.campaigns),campaignIds=campaignEntries.map(([,c])=>c.id);
  const invalidCampaigns=campaignEntries.some(([key,c])=>key!==c.id)||new Set(campaignIds).size!==campaignIds.length;
  if(invalidCampaigns)warnings.push('Diccionario de campañas inconsistente: IDs repetidos o discordantes.');
  const campaignWarnings=(id?:string)=>!id?[]:invalidCampaigns?['Referencia de campaña no conciliada: diccionario inconsistente']:!Object.hasOwn(state.campaigns,id)?['Campaña declarada sin detalle disponible']:[];
  for(const [id,a] of invalidAgents?[]:entries){
    const view=officeAgentView({...state,selectedAgentId:id});
    const refs=campaignWarnings(a.campaignId);
    if(a.currentTaskId && board.invalidIdentity)refs.push('Relación agente/tarea no conciliada: diccionario de tareas inconsistente');
    if(a.currentTaskId && board.rows.some(row=>row.task.id===a.currentTaskId && row.relationship==='Información contradictoria'))refs.push('Referencias de propietario o campaña contradictorias en el tablero');
    if(a.currentTaskId && view.taskState!=='MATCHED')refs.push(`Relación agente/tarea ${view.taskState}: referencia descriptiva, no asignación confirmada`);
    const base={id,agentId:id,agentName:a.displayName,taskId:a.currentTaskId,campaignId:a.campaignId,timestamp:a.lastEventAt,source:state.sourceHealth.source,warnings:refs,inspectId:refs.length?undefined:id};
    if(Object.hasOwn(agentCategories,a.status))current.push({...base,key:`agent:${id}:status`,category:agentCategories[a.status],original:a.status});
    if(Object.hasOwn(securityCategories,a.securityState))current.push({...base,key:`agent:${id}:security`,category:securityCategories[a.securityState],original:a.securityState});
  }
  for(const row of board.rows){
    const t=row.task,owner=agent(t.ownerAgentId);
    const refs=[...row.warnings,...campaignWarnings(t.campaignId)];if(row.relationship!=='Relación consistente · metadatos')refs.push(row.relationship);
    const base={id:t.id,taskId:t.id,agentId:t.ownerAgentId,agentName:owner?.displayName,campaignId:t.campaignId,source:state.sourceHealth.source,warnings:refs,inspectId:owner && !refs.length?owner.id:undefined};
    if(t.status==='BLOCKED'||t.status==='FAILED')current.push({...base,key:`task:${t.id}:status`,category:t.status==='BLOCKED'?'Bloqueo declarado':'Fallo declarado',original:t.status});
    if(t.approvalRequired===true)current.push({...base,key:`task:${t.id}:review`,category:'Requisito de revisión declarado',original:`approvalRequired: true · status: ${t.status}`});
  }
  const counts=new Map<string,number>();state.events.forEach(e=>counts.set(e.id,(counts.get(e.id)??0)+1));
  const seen=new Set<string>();
  for(const event of state.events){
    if(!eventTypes.has(event.type)||seen.has(event.id))continue;seen.add(event.id);
    if(counts.get(event.id)!==1){warnings.push(`Evento ${event.id}: ID repetido o contradictorio; no se selecciona una versión.`);continue;}
    const refs:string[]=[],actor=agent(event.actorId),target=agent(event.targetId);
    if(event.actorId&&!actor)refs.push('Agente declarado no resuelto');if(event.targetId&&!target)refs.push('Receptor declarado no resuelto');
    if(live&&event.source!==state.sourceHealth.source)refs.push('Fuente del evento discordante con la conexión admitida');
    const task=event.taskId && !board.invalidIdentity && Object.hasOwn(state.tasks,event.taskId)?state.tasks[event.taskId]:undefined;
    if(event.taskId && !task)refs.push('Referencia de tarea no disponible o inconsistente');
    if(task && actor){const link=taskOwnerMetadata(actor,task);if(link!=='MATCHED')refs.push(link==='INCONSISTENT'?'Relación de propietario o campaña de tarea y agente contradictoria':'Relación de propietario o campaña de tarea y agente incompleta');}
    if(task?.campaignId && event.campaignId && task.campaignId!==event.campaignId)refs.push('Campaña de tarea y evento contradictorias');
    for(const endpoint of [actor,target])if(task?.campaignId && endpoint?.campaignId && task.campaignId!==endpoint.campaignId)refs.push('Campaña de tarea y participante contradictorias');
    for(const endpoint of [actor,target])if(endpoint?.campaignId && event.campaignId && endpoint.campaignId!==event.campaignId)refs.push('Campaña de agente y evento contradictorias');
    refs.push(...campaignWarnings(event.campaignId),...campaignWarnings(task?.campaignId),...campaignWarnings(actor?.campaignId),...campaignWarnings(target?.campaignId));
    history.push({key:`event:${event.id}`,id:event.id,category:'Registro histórico · declaración de fuente',original:event.type,agentId:event.actorId,agentName:actor?.displayName,targetId:event.targetId,taskId:event.taskId,campaignId:event.campaignId,assetId:event.assetId,timestamp:event.timestamp,source:event.source,verified:event.verified,warnings:refs,inspectId:actor && !refs.length?actor.id:undefined});
  }
  return {available:true,current,history,warnings:[...new Set(warnings)],message,provenance};
}
export type AgentSignalsView=ReturnType<typeof agentSignalsView>;
