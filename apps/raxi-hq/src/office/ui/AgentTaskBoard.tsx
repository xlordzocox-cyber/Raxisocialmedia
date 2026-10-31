import { useEffect, useMemo, useState } from 'react';
import type { HQState } from '../../domain/hq';
import type { OfficeAgentView } from './agentViewSelectors';
import { taskBoardView } from './taskBoardSelectors';

/** Main office snapshots only. No commands, repositories, timers or transports. */
export function AgentTaskBoard({state,view,scope}:{state:HQState;view:OfficeAgentView;scope:string}) {
  const key=JSON.stringify([scope,state.mode,state.sourceHealth.source,state.sourceHealth.connection,state.observation?.runId]);
  return <TaskBoardContent key={key} state={state} view={view}/>;
}
function TaskBoardContent({state,view}:{state:HQState;view:OfficeAgentView}) {
  const board=useMemo(()=>taskBoardView(state),[state]);
  const [owner,setOwner]=useState(''),[campaign,setCampaign]=useState('');
  const effectiveOwner=board.ownerIds.includes(owner)?owner:'';
  const effectiveCampaign=board.campaignIds.includes(campaign)?campaign:'';
  useEffect(()=>{if(owner!==effectiveOwner)setOwner('');if(campaign!==effectiveCampaign)setCampaign('');},[owner,campaign,effectiveOwner,effectiveCampaign]);
  const rows=board.rows.filter(row=>(!effectiveOwner||row.task.ownerAgentId===effectiveOwner)&&(!effectiveCampaign||row.task.campaignId===effectiveCampaign));
  return <section className="task-board" aria-label="Tareas de esta oficina">
    <div className="task-board-heading"><h2>Tareas de esta oficina</h2><span>{view.modeLabel} · {view.source} · {view.connection}</span></div>
    <p>Solo lectura · vínculos y estados declarados por la fuente. Filtrar no asigna tareas.</p>
    <div className="task-board-filters">
      <label>Agente · propietario declarado<select value={effectiveOwner} onChange={event=>setOwner(event.target.value)}><option value="">Todos los propietarios declarados</option>{board.ownerIds.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
      <label>Campaña declarada<select value={effectiveCampaign} onChange={event=>setCampaign(event.target.value)}><option value="">Todas las campañas declaradas</option>{board.campaignIds.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
    </div>
    <p role="status">{board.invalidIdentity?'Snapshot inconsistente: IDs de tareas duplicados o discordantes. No se muestran atribuciones.'
      :board.unavailable?'Sin datos LIVE vigentes. No se utilizan tareas MOCK como sustituto.'
        :board.rows.length===0?'La fuente no aporta tareas de Raxi a esta oficina.'
          :`${rows.length} de ${board.rows.length} tareas recibidas · solo lectura`}</p>
    {board.rows.length>0 && rows.length===0 && <p>No hay tareas para estos filtros.</p>}
    {board.referenceWarnings.length>0 && <ul aria-label="Referencias de agentes sin tarea disponible">{board.referenceWarnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
    <div className="task-board-grid">{rows.map(({task,owner,classification,relationship,warnings,currentTaskReferences})=><article className="task-board-card" key={task.id} aria-label={`Tarea ${task.id}`}>
      <span className="task-classification">{classification}</span><h3>{task.title}</h3><code>{task.id}</code>
      <dl><dt>Estado original de fuente</dt><dd>{task.status}</dd>
        <dt>Propietario declarado</dt><dd>{task.ownerAgentId ?? 'No declarado'}{owner?` · ${owner.displayName} (presente, no acredita asignación)`:''}</dd>
        <dt>Relación disponible</dt><dd>{relationship}</dd>
        <dt>Referencias currentTaskId de agentes</dt><dd>{currentTaskReferences.join(', ') || 'Ninguna disponible'}</dd>
        <dt>Campaña declarada</dt><dd>{task.campaignId ?? 'No declarada'}</dd>
        <dt>Dependencias · IDs</dt><dd>{task.dependsOn?.join(', ') || 'No declaradas'}</dd>
        <dt>Requisito de aprobación declarado</dt><dd>{task.approvalRequired===true?'La fuente indica aprobación requerida; no acredita una aprobación pendiente real':task.approvalRequired===false?'La fuente indica false; no concede permisos':'No informado'}</dd>
      </dl>{warnings.length>0 && <ul aria-label="Advertencias de referencias">{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
    </article>)}</div>
  </section>;
}
