import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hqStore, useHQState } from './store/hqStore';
import { OfficeScene } from './office/OfficeScene';
import { AgentDock } from './office/ui/AgentDock';
import { AgentInspector } from './office/ui/AgentInspector';
import { AgentTaskBoard } from './office/ui/AgentTaskBoard';
import { HandoffTimeline } from './office/ui/HandoffTimeline';
import { AgentSignalsPanel } from './office/ui/AgentSignalsPanel';
import { officeAgentView } from './office/ui/agentViewSelectors';
import { getOwnAgent } from './domain/agents';
import { CampusOverview } from './campus/CampusOverview';
import { loadMockIdeaCenter } from './ideas/mockIdeas';
import { useAuth } from './auth/AuthProvider';
import { supabase } from './auth/client';
import { RealIdeaStore, type RealIdeaRepository } from './persistence/realIdeaStore';
import { createSupabaseIdeaRepository } from './persistence/supabaseIdeaRepository';
import { RealIdeaCenter } from './persistence/RealIdeaCenter';
import { RealCampaignStore, createCampaignRepository, type CampaignRepository } from './persistence/realCampaignStore';
import { ExecutionObserverPanel } from './observation/ExecutionObserverPanel';
import { OBSERVED_PROJECT } from './observation/executionObservation';
import type { RuntimeOfficeSink } from './runtime/runtimeOfficeStore';
import { mainOfficeSource, type ScopedRuntimeSnapshot } from './runtime/mainOfficeSource';

const defaultIdeaRepository = (ownerId: string) => createSupabaseIdeaRepository(supabase!, ownerId);
const defaultCampaignRepository = supabase ? () => createCampaignRepository(supabase!) : undefined;

export default function App({ ideaRepository = defaultIdeaRepository, campaignRepository = defaultCampaignRepository }: { ideaRepository?: (ownerId: string) => RealIdeaRepository; campaignRepository?: (ownerId: string) => CampaignRepository } = {}) {
  const state = useHQState();
  const { user, signOut, getRealIdeaStore, getRealCampaignStore } = useAuth();
  useLayoutEffect(() => {
    hqStore.setObservationScope(user ? { viewerId: user.id, project: OBSERVED_PROJECT } : undefined);
    return () => hqStore.setObservationScope(undefined);
  }, [user?.id]);
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
  const [runtimeOffice,setRuntimeOffice] = useState<ScopedRuntimeSnapshot|null>(null);
  const [selectedRuntimeAgent,setSelectedRuntimeAgent] = useState<string>();
  const [selectedRuntimeEvent,setSelectedRuntimeEvent] = useState<string>();
  const onRuntimeSnapshot = useCallback<RuntimeOfficeSink>((scope,hq)=>{
    if(scope.owner!==user?.id)return;
    setRuntimeOffice(previous=>{
      if(!hq)return previous?.owner===scope.owner && previous.workspace===scope.workspace?null:previous;
      return {owner:scope.owner,workspace:scope.workspace,hq};
    });
  },[user?.id]);
  useEffect(()=>{
    if(campusMode!=='REAL'||!user?.id){
      setRuntimeOffice(null);setSelectedRuntimeAgent(undefined);setSelectedRuntimeEvent(undefined);
    }
  },[campusMode,user?.id]);
  const officeState=mainOfficeSource(state,runtimeOffice,user?.id,campusMode,selectedRuntimeAgent);
  const officeStateRef=useRef(officeState);
  officeStateRef.current=officeState;
  const selectAndFocus = (id: string) => {
    if (!getOwnAgent(officeStateRef.current.agents,id)) return;
    if (officeStateRef.current.sourceHealth.source==='runtime') setSelectedRuntimeAgent(id);
    else hqStore.selectAgent(id);
    sceneRef.current?.focusAgent(id);
  };
  useEffect(() => {
    let scene: OfficeScene;
    try { scene = new OfficeScene(host.current!, selectAndFocus,setHoveredId,setZoomPercent,setFocusCritical); sceneRef.current=scene; }
    catch (cause) { setError(String(cause)); return; }
    const update = () => scene.update(officeStateRef.current);
    const unsubscribe = hqStore.subscribe(update);
    update();
    return () => { unsubscribe(); hqStore.stop(); sceneRef.current=undefined; scene.destroy(); };
  }, []);
  useEffect(() => {
    void hqStore.switchMode(campusMode === 'DEMO' ? 'MOCK' : 'LIVE_READ_ONLY').catch((cause) => setError(String(cause)));
  }, [campusMode, user?.id]);
  useEffect(()=>{sceneRef.current?.update(officeState);},[officeState]);
  const agentView = officeAgentView(officeState);
  const hovered = getOwnAgent(officeState.agents,hoveredId);
  const campaign = Object.values(officeState.campaigns)[0];
  const connectionLabel = { CONNECTED: 'Conectada', DISCONNECTED: 'Sin conexión', DEGRADED: 'Degradada' }[officeState.sourceHealth.connection];
  const usingRuntime=officeState.sourceHealth.source==='runtime';
  const selectOfficeEvent=(id:string,actorId?:string)=>{
    if(usingRuntime){setSelectedRuntimeEvent(id);if(actorId)selectAndFocus(actorId);}
    else hqStore.selectEvent(id);
  };
  return <main>
    <header><div><h1>Raxi HQ <span>v1.0 · Campus {campusMode}</span></h1><p>Campus de operaciones e ideas · fuentes independientes</p></div><button onClick={() => { void signOut(); }}>Cerrar sesión</button>
      <div className="controls"><button disabled={campusMode === 'REAL'} aria-pressed={state.mode === 'MOCK'} onClick={() => void hqStore.switchMode('MOCK')}>FUENTE: MOCK</button><button aria-pressed={state.mode === 'LIVE_READ_ONLY'&&!usingRuntime} onClick={() => void hqStore.switchMode('LIVE_READ_ONLY')}>FUENTE: MUNDER · SOLO LECTURA</button>{usingRuntime&&<span role="status">FUENTE ACTIVA: RUNTIME REAL · SOLO LECTURA</span>}{state.mode === 'MOCK' ? <button onClick={() => hqStore.restartDemo()}>Reiniciar demo</button> : <button onClick={() => void hqStore.refreshLive()}>Reintentar lectura</button>}</div></header>
    <div className="controls" role="group" aria-label="Datos del Campus">
      <button type="button" aria-pressed={campusMode === 'REAL'} onClick={() => { void hqStore.switchMode('LIVE_READ_ONLY'); setCampusMode('REAL'); }}>Campus REAL</button>
      <button type="button" aria-pressed={campusMode === 'DEMO'} onClick={() => setCampusMode('DEMO')}>Campus DEMO · datos ficticios</button>
    </div>
    {campusMode === 'DEMO'
      ? <CampusOverview ideas={ideaCenter!.ideas} />
      : <RealIdeaCenter store={realIdeas} campaigns={campaignRepository ? workspace => getRealCampaignStore(workspace, owner => new RealCampaignStore(campaignRepository(owner), owner, workspace)) : undefined} onRuntimeSnapshot={onRuntimeSnapshot} />}
    {campusMode === 'REAL' && <ExecutionObserverPanel state={state} />}
    <section className="campaign"><b>{officeState.mode === 'MOCK' ? campaign ? 'Centro de Operaciones · Office v0.5 · Demo MOCK' : 'Cargando…' : officeState.mode === 'HISTORICAL_REPLAY' ? 'REPRODUCCIÓN HISTÓRICA · no es actividad en vivo' : usingRuntime ? 'Centro de Operaciones · Runtime IA real · solo lectura' : 'Centro de Operaciones · Office v0.5 · Munder en vivo · solo lectura'}</b><span>{officeState.mode === 'MOCK' ? `${campaign?.progress ?? 0}% · ${campaign?.status}` : `${officeState.sourceHealth.connection} · ${connectionLabel}`}</span></section>
    <div className="workspace"><section className="office"><div className="office-toolbar"><span>Arrastra el suelo · rueda para zoom · click para inspeccionar</span><div><button aria-label="Alejar cámara" onClick={()=>sceneRef.current?.zoom(0.85)}>−</button><output aria-label="Zoom de cámara">{zoomPercent}%</output><button aria-label="Acercar cámara" onClick={()=>sceneRef.current?.zoom(1.18)}>+</button><button aria-pressed={focusCritical} onClick={()=>sceneRef.current?.setCriticalEventFocus(!focusCritical)}>Seguir críticos</button><button onClick={()=>sceneRef.current?.resetCamera()}>Centrar</button></div></div><div ref={host} className="canvas-host" />{hovered && <div className="hover-card"><b>{hovered.displayName}</b><span>{hovered.role}</span><span>{hovered.status} · {hovered.zone}</span><span>{hovered.securityState}</span></div>}{error && <p role="alert">{error}</p>}<AgentDock view={agentView} onSelect={selectAndFocus} /></section>
      <AgentInspector view={agentView} /></div>
    <AgentTaskBoard state={officeState} view={agentView} scope={user?.id ?? ''}/>
    <HandoffTimeline state={officeState} view={agentView}/>
    <AgentSignalsPanel state={officeState} scope={user?.id ?? ''} getState={()=>officeStateRef.current} onInspect={selectAndFocus}/>
    <section className="source-health" aria-label="Estado de la fuente"><h2>Estado de la fuente</h2><dl><dt>Fuente</dt><dd>{officeState.sourceHealth.source === 'mock' ? 'DEMO · MOCK' : officeState.sourceHealth.source === 'codex' ? 'Codex · archivo histórico' : usingRuntime ? 'Runtime IA · recibos verificados' : 'Munder Difflin'}</dd><dt>Modo</dt><dd>{state.mode}</dd><dt>Conexión</dt><dd>{state.sourceHealth.connection} · {connectionLabel}</dd><dt>Última lectura correcta</dt><dd>{state.mode === 'MOCK' ? 'No aplica · MOCK' : state.sourceHealth.lastSuccessfulRead ?? 'Sin lectura correcta'}</dd><dt>Último evento de fuente</dt><dd>{state.sourceHealth.lastSourceEvent ?? '—'}</dd><dt>Eventos cargados</dt><dd>{state.sourceHealth.eventsLoaded}</dd><dt>Agentes cargados</dt><dd>{state.sourceHealth.agentsLoaded}</dd><dt>Tareas cargadas</dt><dd>{state.sourceHealth.tasksLoaded}</dd></dl>{state.sourceHealth.message && <p role="status">{state.sourceHealth.message} {campusMode === 'DEMO' ? 'Puedes cambiar manualmente a MOCK.' : 'La demostración está separada en Campus DEMO.'}</p>}</section>
    <section className="events"><h2>{state.mode === 'MOCK' ? 'DEMO · simulación' : state.mode === 'HISTORICAL_REPLAY' ? 'HISTORICAL_REPLAY · eventos pasados' : 'Actividad LIVE'} · {state.events.length} eventos</h2>{state.mode === 'MOCK' ? <p>Aria, GitHub, Munder Difflin y Supermemory: stubs sin conexión ni escrituras.</p> : <p>Solo eventos recibidos de una fuente verificada. Sin conexión no se muestra actividad inventada.</p>}<div>{state.events.map((event) => <button key={event.id} aria-pressed={event.id === state.selectedEventId} onClick={() => hqStore.selectEvent(event.id)}>{state.mode === 'MOCK' ? <><b>{event.type}</b> {event.label.replaceAll('read-only','solo lectura')}</> : <><time dateTime={event.timestamp}>{event.timestamp}</time> · {getOwnAgent(state.agents,event.actorId)?.displayName ?? event.actorId ?? '—'} · <b>{event.type}</b> · {event.label} · {event.taskId ?? 'Tarea no observada'} · {event.source}</>}</button>)}</div></section>
  </main>;
}
