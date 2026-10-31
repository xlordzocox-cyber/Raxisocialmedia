import { getOwnAgent } from '../domain/agents';
import type { HQState } from '../domain/hq';
import type { HQEvent } from '../domain/events';
import { taskOwnerMetadata } from './ui/agentViewSelectors';

const types=new Set(['HANDOFF_SENT','HANDOFF_RECEIVED','ASSET_RECEIVED']);
export function handoffDeclarationKey(event:HQEvent):string {
  // Exact header comparison for transient lifecycle only, not a digest or proof.
  // Payload/labels never authorize or drive this representation.
  return JSON.stringify([event.id,event.type,event.timestamp,event.source,event.verified,event.actorId,event.targetId,event.taskId,event.assetId,event.campaignId]);
}
export function handoffSnapshot(state:HQState) {
  const demo=state.mode==='MOCK' && state.mockMode && state.sourceHealth.mode==='MOCK' && state.sourceHealth.source==='mock' && state.sourceHealth.connection==='CONNECTED';
  const live=state.mode==='LIVE_READ_ONLY' && !state.mockMode && state.sourceHealth.mode==='LIVE_READ_ONLY' && state.sourceHealth.source==='munder' && state.sourceHealth.connection==='CONNECTED';
  const message=state.mode==='HISTORICAL_REPLAY'?'La captura histórica admitida no acredita handoffs de Raxi.'
    :state.mode==='LIVE_READ_ONLY'&&!live?'Sin declaraciones LIVE vigentes. Sin sustitución por MOCK.'
      :!demo&&!live?'Contexto de procedencia inconsistente; sin entregas representadas.':'';
  const events=message?[]:state.events;
  const counts=new Map<string,number>();events.forEach(event=>counts.set(event.id,(counts.get(event.id)??0)+1));
  const emitted=new Set<string>();
  const rows=events.filter(event=>{
    if(!types.has(event.type)||emitted.has(event.id))return false;
    emitted.add(event.id);return true;
  }).map(event=>{
    const warnings:string[]=[];let coherent=true;
    const duplicate=(counts.get(event.id)??0)>1;
    if(duplicate){warnings.push('ID repetido: no se selecciona una versión de la declaración');coherent=false;}
    const ownActor=getOwnAgent(state.agents,event.actorId), ownTarget=getOwnAgent(state.agents,event.targetId);
    const actor=ownActor?.id===event.actorId?ownActor:undefined, target=ownTarget?.id===event.targetId?ownTarget:undefined;
    if(!actor){warnings.push(event.actorId?'Emisor no resuelto en esta oficina':'Emisor no declarado');coherent=false;}
    if(!target){warnings.push(event.targetId?'Receptor no resuelto en esta oficina':'Receptor no declarado');coherent=false;}
    if(actor&&target&&actor.id===target.id){warnings.push('Emisor y receptor coinciden; transferencia no representada');coherent=false;}
    if(!event.taskId)warnings.push('ID de tarea no declarado');
    else {
      const task=Object.hasOwn(state.tasks,event.taskId)?state.tasks[event.taskId]:undefined;
      if(!task || task.id!==event.taskId){warnings.push('Referencia de tarea no disponible o inconsistente');coherent=false;}
      else {
        if(task.ownerAgentId && task.ownerAgentId!==event.actorId && task.ownerAgentId!==event.targetId){warnings.push('Propietario de tarea ajeno a los extremos declarados');coherent=false;}
        if(task.campaignId && event.campaignId && task.campaignId!==event.campaignId){warnings.push('Campaña del evento y tarea contradictorias');coherent=false;}
        const owner=getOwnAgent(state.agents,task.ownerAgentId);
        if(owner && taskOwnerMetadata(owner,task)==='INCONSISTENT'){warnings.push('Metadatos de tarea y propietario contradictorios');coherent=false;}
        for(const [role,agent] of [['emisor',actor],['receptor',target]] as const){
          if(task.campaignId && agent?.campaignId && task.campaignId!==agent.campaignId){warnings.push(`Campaña de tarea y ${role} contradictorias`);coherent=false;}
        }
      }
    }
    for(const agent of [actor,target])if(agent?.campaignId && event.campaignId && agent.campaignId!==event.campaignId){warnings.push('Campaña de agente y evento contradictorias');coherent=false;}
    if(!event.assetId)warnings.push('ID de asset no declarado');
    if(live && event.source!==state.sourceHealth.source){warnings.push('Fuente del evento discordante con la conexión');coherent=false;}
    return {event,key:handoffDeclarationKey(event),actor,target,duplicate,warnings,
      evidence:demo?'DEMO/MOCK · sin evidencia de producción':coherent?'Declaración de fuente · sin evidencia independiente':'Declaración con referencias no conciliadas · sin evidencia independiente',
      meaning:event.type==='HANDOFF_SENT'?'Envío declarado; no confirma recepción'
        :event.type==='HANDOFF_RECEIVED'?'Recepción declarada; no implica aprobación ni finalización'
          :'Recepción de asset declarada; no acredita QA ni publicación',
      demoEligible:demo&&coherent&&['HANDOFF_SENT','ASSET_RECEIVED'].includes(event.type)};
  });
  return {rows,message};
}
export type HandoffRow=ReturnType<typeof handoffSnapshot>['rows'][number];
export function canAnimateDemoHandoff(row:HandoffRow,from:{x:number;y:number}|undefined,to:{x:number;y:number}|undefined,reducedMotion:boolean):boolean {
  return row.demoEligible && !reducedMotion && !!from && !!to && [from.x,from.y,to.x,to.y].every(Number.isFinite);
}
