import type { OfficeAgentView } from './agentViewSelectors';

const missing = 'Sin información verificada';
export function AgentInspector({ view }: { view: OfficeAgentView }) {
  const { agent, task, event } = view;
  return <aside id="office-agent-inspector" className="agent-inspector" aria-label="Agente seleccionado">
    <h2>{agent?.displayName ?? 'Inspector de agente'}</h2>
    <p className="agent-mode">{view.modeLabel} · {view.source} · {view.connection}</p>
    {!agent ? <p>Selecciona un agente disponible en esta oficina.</p> : <>
      <p>{agent.role}</p>
      <dl><dt>Estado recibido</dt><dd>{agent.status}</dd>
        <dt>Zona</dt><dd>{agent.zone}</dd><dt>Destino representado</dt><dd>{agent.destinationZone ?? '—'}</dd>
        <dt>Seguridad declarada</dt><dd>{agent.securityState}</dd>
        <dt>Esperando</dt><dd>{agent.waitingFor ?? missing}</dd>
        <dt>Tarea</dt><dd>{task ? `${task.title} · ${task.id}` : agent.currentTaskId ? `${agent.currentTaskId} · detalle no disponible` : missing}</dd>
        <dt>Proveedor / modelo declarados</dt><dd>{agent.provider ?? missing} · {agent.model === 'read-only adapter' ? 'adaptador de solo lectura' : agent.model ?? missing}</dd>
        <dt>Capacidades descriptivas · no conceden permisos</dt><dd>{agent.capabilities.join(', ') || missing}</dd>
        <dt>Última marca del agente</dt><dd>{agent.lastEventAt ?? missing}</dd>
        <dt>Evento disponible en esta vista</dt><dd>{event ? `${event.id} · ${event.timestamp} · ${event.source} · ${view.mode === 'MOCK' ? 'simulado · sin evidencia REAL' : event.verified ? 'marcado verificado por la fuente' : 'no verificado'}` : missing}</dd>
        {view.observation && <><dt>Ejecutor externo / ejecución histórica</dt><dd>{view.observation.executorId} · {view.observation.runId}</dd><dt>Referencia de origen</dt><dd>{view.observation.originRef}</dd></>}
      </dl>
      <p>No permite ejecutar herramientas, aprobar tareas ni autorizar costes.</p>
    </>}
  </aside>;
}
