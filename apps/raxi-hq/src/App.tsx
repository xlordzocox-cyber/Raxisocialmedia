import { useEffect, useMemo, useRef, useState } from 'react';
import { hqStore, useHQState } from './store/hqStore';
import { OfficeScene } from './office/OfficeScene';
import { getStatusVisual } from './office/agents/agentVisualState';
import { getOwnAgent } from './domain/agents';
import { CampusOverview } from './campus/CampusOverview';
import { loadMockIdeaCenter } from './ideas/mockIdeas';
import { useAuth } from './auth/AuthProvider';
import { supabase } from './auth/client';
import { RealIdeaStore, type RealIdeaRepository } from './persistence/realIdeaStore';
import { createSupabaseIdeaRepository } from './persistence/supabaseIdeaRepository';
import { RealIdeaCenter } from './persistence/RealIdeaCenter';
import { RealCampaignStore, createCampaignRepository } from './persistence/realCampaignStore';

const defaultIdeaRepository = (ownerId: string) => createSupabaseIdeaRepository(supabase!, ownerId);

export default function App({ ideaRepository = defaultIdeaRepository }: { ideaRepository?: (ownerId: string) => RealIdeaRepository } = {}) {
  const state = useHQState();
  const { signOut, getRealIdeaStore, getRealCampaignStore } = useAuth();
  const [campusMode, setCampusMode] = useState<'REAL' | 'DEMO'>('REAL');
  const ideaCenter = useMemo(() => campusMode === 'DEMO' ? loadMockIdeaCenter() : null, [campusMode]);
  // AuthStore owns this resource until verified session loss/account change.
  const realIdeas = getRealIdeaStore(ownerId => new RealIdeaStore(ideaRepository(ownerId), ownerId));
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | undefined>(undefined);
  const [hoveredId,setHoveredId] = useState<string>();
  const [zoomPercent,setZoomPercent] = useState(100);
  const [focusCritical,setFocusCritical] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let scene: OfficeScene;
    try { scene = new OfficeScene(host.current!, (id) => hqStore.selectAgent(id),setHoveredId,setZoomPercent); sceneRef.current=scene; }
    catch (cause) { setError(String(cause)); return; }
    const update = () => scene.update(hqStore.getSnapshot());
    const unsubscribe = hqStore.subscribe(update);
    update();
    return () => { unsubscribe(); hqStore.stop(); sceneRef.current=undefined; scene.destroy(); };
  }, []);
  useEffect(() => {
    void hqStore.switchMode(campusMode === 'DEMO' ? 'MOCK' : 'LIVE_READ_ONLY').catch((cause) => setError(String(cause)));
  }, [campusMode]);
  const selected = getOwnAgent(state.agents,state.selectedAgentId);
  const hovered = getOwnAgent(state.agents,hoveredId);
  const campaign = Object.values(state.campaigns)[0];
  const connectionLabel = { CONNECTED: 'Conectada', DISCONNECTED: 'Sin conexión', DEGRADED: 'Degradada' }[state.sourceHealth.connection];
  const liveEmptyMessage = state.sourceHealth.connection === 'CONNECTED'
    ? 'La fuente Munder está conectada, pero no hay agentes disponibles.'
    : state.sourceHealth.connection === 'DEGRADED'
      ? 'La lectura de Munder está degradada.'
      : 'La fuente Munder está desconectada.';
  return <main>
    <header><div><h1>Raxi HQ <span>v1.0 · Campus REAL</span></h1><p>Campus de operaciones e ideas · fuentes independientes</p></div><button onClick={() => { void signOut(); }}>Cerrar sesión</button>
      <div className="controls"><button disabled={campusMode === 'REAL'} aria-pressed={state.mode === 'MOCK'} onClick={() => void hqStore.switchMode('MOCK')}>FUENTE: MOCK</button><button aria-pressed={state.mode === 'LIVE_READ_ONLY'} onClick={() => void hqStore.switchMode('LIVE_READ_ONLY')}>FUENTE: MUNDER EN VIVO · SOLO LECTURA</button>{state.mode === 'MOCK' ? <button onClick={() => hqStore.restartDemo()}>Reiniciar demo</button> : <button onClick={() => void hqStore.refreshLive()}>Reintentar lectura</button>}</div></header>
    <div className="controls" role="group" aria-label="Datos del Campus">
      <button type="button" aria-pressed={campusMode === 'REAL'} onClick={() => { void hqStore.switchMode('LIVE_READ_ONLY'); setCampusMode('REAL'); }}>Campus REAL</button>
      <button type="button" aria-pressed={campusMode === 'DEMO'} onClick={() => setCampusMode('DEMO')}>Campus DEMO · datos ficticios</button>
    </div>
    {campusMode === 'DEMO'
      ? <CampusOverview ideas={ideaCenter!.ideas} />
      : <RealIdeaCenter store={realIdeas} campaigns={supabase ? workspace => getRealCampaignStore(workspace, owner => new RealCampaignStore(createCampaignRepository(supabase!), owner, workspace)) : undefined} />}
    <section className="campaign"><b>{state.mode === 'MOCK' ? campaign ? 'Centro de Operaciones · Office v0.5 · Demo MOCK' : 'Cargando…' : 'Centro de Operaciones · Office v0.5 · Munder en vivo · solo lectura'}</b><span>{state.mode === 'MOCK' ? `${campaign?.progress ?? 0}% · ${campaign?.status}` : `${state.sourceHealth.connection} · ${connectionLabel}`}</span></section>
    <div className="workspace"><section className="office"><div className="office-toolbar"><span>Arrastra el suelo · rueda para zoom · click para inspeccionar</span><div><button aria-label="Alejar cámara" onClick={()=>sceneRef.current?.zoom(0.85)}>−</button><output aria-label="Zoom de cámara">{zoomPercent}%</output><button aria-label="Acercar cámara" onClick={()=>sceneRef.current?.zoom(1.18)}>+</button><button aria-pressed={focusCritical} onClick={()=>{const enabled=!focusCritical;setFocusCritical(enabled);sceneRef.current?.setCriticalEventFocus(enabled);}}>Seguir críticos</button><button onClick={()=>sceneRef.current?.resetCamera()}>Centrar</button></div></div><div ref={host} className="canvas-host" />{hovered && <div className="hover-card"><b>{hovered.displayName}</b><span>{hovered.role}</span><span>{hovered.status} · {hovered.zone}</span><span>{hovered.securityState}</span></div>}{error && <p role="alert">{error}</p>}</section>
      <aside><h2>Agentes</h2><div className="agent-list">{Object.values(state.agents).map((agent) => <button key={agent.id} aria-pressed={agent.id === state.selectedAgentId} onClick={() => hqStore.selectAgent(agent.id)}>{agent.displayName}<span>{getStatusVisual(agent.status).label}</span></button>)}</div>{state.mode === 'LIVE_READ_ONLY' && Object.keys(state.agents).length === 0 && <div className="empty-agents" role="status"><strong>Sin agentes cargados</strong><p>{liveEmptyMessage}</p></div>}
        {selected && <section aria-label="Agente seleccionado"><h2>{selected.displayName}</h2><p>{selected.role}</p><dl><dt>Estado</dt><dd>{selected.status}</dd><dt>Zona</dt><dd>{selected.zone}</dd><dt>Destino</dt><dd>{selected.destinationZone ?? '—'}</dd><dt>Seguridad</dt><dd>{selected.securityState}</dd><dt>Esperando</dt><dd>{selected.waitingFor ?? '—'}</dd><dt>Tarea</dt><dd>{selected.currentTaskId ?? '—'}</dd><dt>Proveedor / modelo</dt><dd>{selected.provider ?? '—'} · {selected.model === 'read-only adapter' ? 'adaptador de solo lectura' : selected.model ?? '—'}</dd><dt>Capacidades</dt><dd>{selected.capabilities.join(', ')}</dd></dl></section>}
      </aside></div>
    <section className="source-health" aria-label="Estado de la fuente"><h2>Estado de la fuente</h2><dl><dt>Fuente</dt><dd>{state.sourceHealth.source === 'mock' ? 'MOCK' : 'Munder Difflin'}</dd><dt>Modo</dt><dd>{state.mode}</dd><dt>Conexión</dt><dd>{state.sourceHealth.connection} · {connectionLabel}</dd><dt>Última lectura correcta</dt><dd>{state.mode === 'MOCK' ? 'No aplica · MOCK' : state.sourceHealth.lastSuccessfulRead ?? 'Sin lectura correcta'}</dd><dt>Último evento de fuente</dt><dd>{state.sourceHealth.lastSourceEvent ?? '—'}</dd><dt>Eventos cargados</dt><dd>{state.sourceHealth.eventsLoaded}</dd><dt>Agentes cargados</dt><dd>{state.sourceHealth.agentsLoaded}</dd><dt>Tareas cargadas</dt><dd>{state.sourceHealth.tasksLoaded}</dd></dl>{state.sourceHealth.message && <p role="status">{state.sourceHealth.message} {campusMode === 'DEMO' ? 'Puedes cambiar manualmente a MOCK.' : 'La demostración está separada en Campus DEMO.'}</p>}</section>
    <section className="events"><h2>{state.mode === 'MOCK' ? 'Motor MOCK' : 'Actividad LIVE'} · {state.events.length} eventos</h2>{state.mode === 'MOCK' ? <p>Aria, GitHub, Munder Difflin y Supermemory: stubs sin conexión ni escrituras.</p> : <p>Solo eventos recibidos de una fuente verificada. Sin conexión no se muestra actividad inventada.</p>}<div>{state.events.map((event) => <button key={event.id} aria-pressed={event.id === state.selectedEventId} onClick={() => hqStore.selectEvent(event.id)}>{state.mode === 'MOCK' ? <><b>{event.type}</b> {event.label.replaceAll('read-only','solo lectura')}</> : <><time dateTime={event.timestamp}>{event.timestamp}</time> · {getOwnAgent(state.agents,event.actorId)?.displayName ?? event.actorId ?? '—'} · <b>{event.type}</b> · {event.taskId ?? '—'} · {event.source}</>}</button>)}</div></section>
  </main>;
}
