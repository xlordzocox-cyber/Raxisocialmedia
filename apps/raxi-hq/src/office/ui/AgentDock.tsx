import { getStatusVisual } from '../agents/agentVisualState';
import type { OfficeAgentView } from './agentViewSelectors';

export function AgentDock({ view, onSelect }: { view: OfficeAgentView; onSelect: (id: string) => void }) {
  return <section className="agent-dock" aria-label="Agentes de esta oficina">
    <div className="agent-dock-heading"><h2>Agentes de esta oficina</h2><span id="office-agent-context">{view.modeLabel} · {view.source} · {view.connection}</span></div>
    {view.agents.length ? <div className="agent-dock-list" role="group" aria-label="Seleccionar y enfocar agente">
      {view.agents.map(agent => <button type="button" key={agent.id}
        aria-pressed={agent.id === view.agent?.id} aria-controls="office-agent-inspector"
        aria-describedby={`office-agent-context office-agent-${encodeURIComponent(agent.id)}-status office-agent-${encodeURIComponent(agent.id)}-security`}
        aria-label={`Seleccionar y enfocar a ${agent.displayName}`}
        onClick={() => onSelect(agent.id)}>
        <strong>{agent.displayName}</strong><span id={`office-agent-${encodeURIComponent(agent.id)}-status`}>{getStatusVisual(agent.status).label}</span><small id={`office-agent-${encodeURIComponent(agent.id)}-security`}>{agent.securityState}</small>
      </button>)}
    </div> : <p role="status">Sin agentes cargados. {view.connection === 'CONNECTED' ? 'La fuente no aporta agentes.' : 'Sin evidencia vigente; no se activa una simulación.'}</p>}
  </section>;
}
