import { useEffect, useRef, useState } from 'react';
import { hqStore, useHQState } from './store/hqStore';
import { OfficeScene } from './office/OfficeScene';
import { getStatusVisual } from './office/agents/agentVisualState';

export default function App() {
  const state = useHQState();
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | undefined>(undefined);
  const [hoveredId,setHoveredId] = useState<string>();
  const [zoomPercent,setZoomPercent] = useState(100);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let scene: OfficeScene;
    try { scene = new OfficeScene(host.current!, (id) => hqStore.selectAgent(id),setHoveredId,setZoomPercent); sceneRef.current=scene; }
    catch (cause) { setError(String(cause)); return; }
    const update = () => scene.update(hqStore.getSnapshot());
    const unsubscribe = hqStore.subscribe(update);
    update();
    void hqStore.initialize().catch((cause) => setError(String(cause)));
    return () => { unsubscribe(); hqStore.stop(); sceneRef.current=undefined; scene.destroy(); };
  }, []);
  const selected = state.selectedAgentId ? state.agents[state.selectedAgentId] : undefined;
  const hovered = hoveredId ? state.agents[hoveredId] : undefined;
  const campaign = Object.values(state.campaigns)[0];
  return <main>
    <header><div><h1>Raxi HQ <span>Office v0.3</span></h1><p>Visual Office · un equipo, siete departamentos</p></div>
      <div className="controls"><strong>MOCK · READ ONLY</strong><button onClick={() => hqStore.restartDemo()}>Reiniciar demo</button></div></header>
    <section className="campaign"><b>{campaign?.title ?? 'Cargando…'}</b><span>{campaign?.progress ?? 0}% · {campaign?.status}</span></section>
    <div className="workspace"><section className="office"><div className="office-toolbar"><span>Arrastra el suelo · rueda para zoom · click para inspeccionar</span><div><button aria-label="Alejar cámara" onClick={()=>sceneRef.current?.zoom(0.85)}>−</button><output aria-label="Zoom de cámara">{zoomPercent}%</output><button aria-label="Acercar cámara" onClick={()=>sceneRef.current?.zoom(1.18)}>+</button><button onClick={()=>sceneRef.current?.resetCamera()}>Centrar</button></div></div><div ref={host} className="canvas-host" />{hovered && <div className="hover-card"><b>{hovered.displayName}</b><span>{hovered.role}</span><span>{hovered.status} · {hovered.zone}</span><span>{hovered.securityState}</span></div>}{error && <p role="alert">{error}</p>}</section>
      <aside><h2>Agentes</h2><div className="agent-list">{Object.values(state.agents).map((agent) => <button key={agent.id} aria-pressed={agent.id === state.selectedAgentId} onClick={() => hqStore.selectAgent(agent.id)}>{agent.displayName}<span>{getStatusVisual(agent.status).label}</span></button>)}</div>
        {selected && <section aria-label="Agente seleccionado"><h2>{selected.displayName}</h2><p>{selected.role}</p><dl><dt>Estado</dt><dd>{selected.status}</dd><dt>Zona</dt><dd>{selected.zone}</dd><dt>Destino</dt><dd>{selected.destinationZone ?? '—'}</dd><dt>Seguridad</dt><dd>{selected.securityState}</dd><dt>Esperando</dt><dd>{selected.waitingFor ?? '—'}</dd><dt>Tarea</dt><dd>{selected.currentTaskId ?? '—'}</dd><dt>Provider / modelo</dt><dd>{selected.provider ?? '—'} · {selected.model ?? '—'}</dd><dt>Capacidades</dt><dd>{selected.capabilities.join(', ')}</dd></dl></section>}
      </aside></div>
    <section className="events"><h2>Mock engine · {state.events.length} eventos</h2><p>Aria, GitHub, Munder Difflin y Supermemory: stubs sin conexión ni escrituras.</p><div>{state.events.map((event) => <button key={event.id} aria-pressed={event.id === state.selectedEventId} onClick={() => hqStore.selectEvent(event.id)}><b>{event.type}</b> {event.label}</button>)}</div></section>
  </main>;
}
