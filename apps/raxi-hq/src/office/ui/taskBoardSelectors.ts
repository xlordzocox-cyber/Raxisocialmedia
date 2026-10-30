import { getOwnAgent } from '../../domain/agents';
import type { HQState } from '../../domain/hq';
import { taskOwnerMetadata } from './agentViewSelectors';

// Exact tokens already accepted by RuntimeOfficeStore's task contract. Not a
// mapping from AgentStatus, not admission, and not proof that a provider is running.
export function taskClassification(status: string): string {
  switch(status) {
    case 'QUEUED': return 'En cola';
    case 'RUNNING': return 'En ejecución · declarado';
    case 'BLOCKED': return 'Bloqueada';
    case 'COMPLETED': return 'Completada · declarado';
    case 'FAILED': return 'Fallida';
    case 'CANCELED': return 'Cancelada';
    default: return 'Sin clasificación';
  }
}

/** Tarjan over existing IDs only; inspect cycles, never change the operational graph. */
function cyclicTasks(graph: Map<string, readonly string[]>): Set<string> {
  let next=0; const indices=new Map<string,number>(), low=new Map<string,number>();
  const stack:string[]=[], onStack=new Set<string>(), cyclic=new Set<string>();
  const visit=(id:string)=>{
    indices.set(id,next);low.set(id,next++);stack.push(id);onStack.add(id);
    for(const dep of graph.get(id) ?? []) {
      if(!graph.has(dep))continue;
      if(!indices.has(dep)){visit(dep);low.set(id,Math.min(low.get(id)!,low.get(dep)!));}
      else if(onStack.has(dep))low.set(id,Math.min(low.get(id)!,indices.get(dep)!));
    }
    if(low.get(id)!==indices.get(id))return;
    const members:string[]=[];let item:string;
    do {item=stack.pop()!;onStack.delete(item);members.push(item);} while(item!==id);
    if(members.length>1 || graph.get(id)?.includes(id))members.forEach(member=>cyclic.add(member));
  };
  for(const id of graph.keys())if(!indices.has(id))visit(id);
  return cyclic;
}

export function taskBoardView(state: HQState) {
  // Suppress stale rows on loss of LIVE evidence, even if a caller retains a snapshot.
  const unavailable=state.mode==='LIVE_READ_ONLY' && state.sourceHealth.connection!=='CONNECTED';
  const entries=unavailable?[]:Object.entries(state.tasks);
  const ids=new Set<string>();
  const invalidIdentity=entries.some(([key,task])=>{
    const invalid=key!==task.id || ids.has(task.id);ids.add(task.id);return invalid;
  });
  const tasks=invalidIdentity?[]:entries.map(([,task])=>task);
  const graph=new Map(tasks.map(task=>[task.id,task.dependsOn ?? []]));
  const cyclic=cyclicTasks(graph);
  const agents=Object.values(state.agents);
  const referenceWarnings=unavailable||invalidIdentity?[]:agents.flatMap(agent=>agent.currentTaskId && !graph.has(agent.currentTaskId)
    ? [`${agent.id} referencia una tarea no disponible: ${agent.currentTaskId}`] : []);
  const rows=tasks.map(task=>{
    const owner=getOwnAgent(state.agents,task.ownerAgentId);
    const claimants=agents.filter(agent=>agent.currentTaskId===task.id);
    const foreignClaim=claimants.some(agent=>agent.id!==task.ownerAgentId);
    let relationship:string;
    if(foreignClaim)relationship=task.ownerAgentId ? 'Información contradictoria' : 'Información incompleta';
    else if(!task.ownerAgentId)relationship='Información incompleta';
    else if(!owner)relationship='Propietario declarado no presente en esta oficina';
    else {
      const link=taskOwnerMetadata(owner,task);
      relationship=link==='INCONSISTENT'?'Información contradictoria'
        :link==='INCOMPLETE'?'Información incompleta'
          :owner.currentTaskId===task.id?'Relación consistente · metadatos'
            :'Relación no confirmada como tarea actual';
    }
    const warnings:string[]=[];
    if(task.ownerAgentId && !owner)warnings.push('Propietario declarado no presente en esta oficina');
    if(cyclic.has(task.id))warnings.push('Dependencia circular en el snapshot');
    if(new Set(task.dependsOn).size!==(task.dependsOn?.length ?? 0))warnings.push('Dependencias repetidas');
    for(const dep of task.dependsOn ?? [])if(!graph.has(dep))warnings.push(`Dependencia no disponible: ${dep}`);
    const campaign=task.campaignId && Object.hasOwn(state.campaigns,task.campaignId)?state.campaigns[task.campaignId]:undefined;
    if(task.campaignId && !campaign)warnings.push('Campaña declarada sin detalle en esta oficina');
    if(campaign && campaign.id!==task.campaignId){warnings.push('Referencia de campaña inconsistente');relationship='Información contradictoria';}
    return {task,owner,relationship,warnings,currentTaskReferences:claimants.map(agent=>agent.id),classification:taskClassification(task.status)};
  });
  // Filter options are declared references, not inferred/confirmed assignments.
  const ownerIds=[...new Set(tasks.flatMap(task=>task.ownerAgentId?[task.ownerAgentId]:[]))].sort();
  const campaignIds=[...new Set(tasks.flatMap(task=>task.campaignId?[task.campaignId]:[]))].sort();
  return {rows,ownerIds,campaignIds,unavailable,invalidIdentity,referenceWarnings};
}
export type TaskBoardView=ReturnType<typeof taskBoardView>;
