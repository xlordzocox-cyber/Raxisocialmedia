import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { hqStore, useHQState } from './store/hqStore';
import { OfficeScene } from './office/OfficeScene';
import { zoneOrder, zones } from './office/zones';
import type { ZoneId } from './domain/agents';
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
import { mainOfficeSource, matchesActiveRuntimeScope, type ScopedRuntimeSnapshot } from './runtime/mainOfficeSource';

const defaultIdeaRepository = (ownerId: string) => createSupabaseIdeaRepository(supabase!, ownerId);
const defaultCampaignRepository = supabase ? () => createCampaignRepository(supabase!) : undefined;

// Stable controls on the right; the office scene stays mounted above every panel.
const hqModules = [
  {id:'ideas',label:'Ideas',mark:'✦'},
  {id:'campaigns',label:'Campañas',mark:'▤'},
  {id:'agents',label:'Agentes',mark:'◎'},
  {id:'tasks',label:'Tareas',mark:'☷'},
  {id:'activity',label:'Actividad',mark:'◷'},
  {id:'runtime',label:'Runtime',mark:'⌘'},
  {id:'sources',label:'Fuentes',mark:'◈'},
] as const;
type HQModule = (typeof hqModules)[number]['id'];

// DEMO (fictional characters) is hidden unless explicitly enabled for development/QA.
const DEMO_ENABLED = (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_RAXI_SHOW_DEMO === 'true';
export default function App({ ideaRepository = defaultIdeaRepository, campaignRepository = defaultCampaignRepository, showDemo = DEMO_ENABLED }: { ideaRepository?: (ownerId: string) => RealIdeaRepository; campaignRepository?: (ownerId: string) => CampaignRepository; showDemo?: boolean } = {}) {
  const state = useHQState();
  const { user, signOut, getRealIdeaStore, getRealCampaignStore } = useAuth();
  useLayoutEffect(() => {
    hqStore.setObservationScope(user ? { viewerId: user.id, project: OBSERVED_PROJECT } : undefined);
    return () => hqStore.setObservationScope(undefined);
  }, [user?.id]);
  const [campusMode, setCampusMode] = useState<'REAL' | 'DEMO'>('REAL');
  const [activeModule,setActiveModule] = useState<HQModule>('ideas');
  const ideaCenter = useMemo(() => campusMode === 'DEMO' ? loadMockIdeaCenter() : null, [campusMode]);
  // AuthStore owns this resource until verified session loss/account change.
  const realIdeas = getRealIdeaStore(ownerId => new RealIdeaStore(ideaRepository(ownerId), ownerId));
  // The active scope comes from the authenticated, validated persistence store.
  const realIdeaSnapshot = useSyncExternalStore(realIdeas.subscribe,realIdeas.getSnapshot,realIdeas.getSnapshot);
  const activeWorkspaceId = (realIdeaSnapshot.phase === 'ready' || realIdeaSnapshot.phase === 'saving') &&
    user?.id && realIdeaSnapshot.workspace?.ownerId === user.id
    ? realIdeaSnapshot.workspace?.id : undefined;
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | undefined>(undefined);
  const [hoveredId,setHoveredId] = useState<string>();
  const [zoomPercent,setZoomPercent] = useState(100);
  const [focusedZone,setFocusedZone] = useState<ZoneId>();
  const [focusCritical,setFocusCritical] = useState(false);
  const [error, setError] = useState<string>();
  const [runtimeOffice,setRuntimeOffice] = useState<ScopedRuntimeSnapshot|null>(null);
  const [selectedRuntimeAgent,setSelectedRuntimeAgent] = useState<string>();
  const [selectedRuntimeEvent,setSelectedRuntimeEvent] = useState<string>();
  const onRuntimeSnapshot = useCallback<RuntimeOfficeSink>((scope,hq)=>{
    // Read current store state at delivery time; stale child callbacks cannot impersonate the new workspace.
    const current=realIdeas.getSnapshot();
    if(campusMode!=='REAL'||scope.owner!==user?.id||!['ready','saving'].includes(current.phase)||current.workspace?.ownerId!==user?.id||
       !matchesActiveRuntimeScope(scope,user?.id,current.workspace?.id))return;
    setRuntimeOffice(previous=>{
      if(!hq)return previous?.owner===scope.owner && previous.workspace===scope.workspace?null:previous;
      return {owner:scope.owner,workspace:scope.workspace,hq};
    });
  },[campusMode,realIdeas,user?.id]);
  useEffect(()=>{
    // Keep runtime snapshots only for the current confirmed REAL workspace.
    setRuntimeOffice(previous=>campusMode==='REAL'&&previous&&
      matchesActiveRuntimeScope(previous,user?.id,activeWorkspaceId)?previous:null);
    if(campusMode!=='REAL'||!user?.id||!activeWorkspaceId){
      setSelectedRuntimeAgent(undefined);setSelectedRuntimeEvent(undefined);
    }
  },[campusMode,user?.id,activeWorkspaceId]);
  // A different workspace must not inherit a selected agent/event from an older session.
  useEffect(()=>{
    setSelectedRuntimeAgent(undefined);
    setSelectedRuntimeEvent(undefined);
  },[runtimeOffice?.owner,runtimeOffice?.workspace]);
  const officeState=mainOfficeSource(state,runtimeOffice,user?.id,campusMode,activeWorkspaceId,selectedRuntimeAgent);
  const officeStateRef=useRef(officeState);
  officeStateRef.current=officeState;
  const selectAndFocus = (id: string) => {
    if (!getOwnAgent(officeStateRef.current.agents,id)) return;
    if (officeStateRef.current.sourceHealth.source==='runtime') setSelectedRuntimeAgent(id);
    else hqStore.selectAgent(id);
    sceneRef.current?.focusAgent(id);
    setActiveModule('agents');
  };
  useEffect(() => {
    let scene: OfficeScene;
    try { scene = new OfficeScene(host.current!, selectAndFocus,setHoveredId,setZoomPercent,setFocusCritical,setFocusedZone); sceneRef.current=scene; }
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
  return <main className="hq-command-shell">
    <header className="hq-command-header">
      <div className="hq-brand"><h1>Raxi HQ <span>Centro de mando</span></h1><p>{campusMode === 'DEMO' ? 'DEMO · personajes y estados ficticios' : 'REAL · tu workspace y eventos verificados de agentes'}</p></div>
      <div className="hq-session-controls" role="group" aria-label="Seleccionar Campus">
        {showDemo && <button type="button" aria-pressed={campusMode === 'REAL'} onClick={() => { void hqStore.switchMode('LIVE_READ_ONLY'); setCampusMode('REAL'); }}>REAL</button>}
        {showDemo && <button type="button" aria-pressed={campusMode === 'DEMO'} onClick={() => setCampusMode('DEMO')}>DEMO</button>}
        <Link className="hq-nav-link" to="/fototeca">Fototeca</Link>
        <button type="button" onClick={() => { void signOut(); }}>Salir</button>
      </div>
    </header>
    <section className="hq-fixed-office" aria-label="Oficina fija de Raxi HQ">
      <div className="hq-office-caption">
        <strong>{officeState.mode === 'MOCK' ? 'Oficina · DEMO' : usingRuntime ? 'Oficina · Runtime verificado' : officeState.mode === 'HISTORICAL_REPLAY' ? 'Reproducción histórica' : 'Oficina · REAL'}</strong>
        <span>{officeState.sourceHealth.source === 'runtime' ? 'Runtime IA' : officeState.sourceHealth.source === 'mock' ? 'MOCK · ficción' : 'Munder · solo lectura'} · {officeState.sourceHealth.connection}</span>
      </div>
      <section className="office"><div className="office-toolbar"><span className="office-help-desktop">Arrastra el suelo · rueda para zoom · click para inspeccionar</span><span className="office-help-mobile">Toca una sala para acercarte · arrastra para mover · usa +/− para zoom</span><div><button aria-label="Alejar cámara" onClick={()=>sceneRef.current?.zoom(0.85)}>−</button><output aria-label="Zoom de cámara">{zoomPercent}%</output><button aria-label="Acercar cámara" onClick={()=>sceneRef.current?.zoom(1.18)}>+</button><button aria-pressed={focusCritical} onClick={()=>sceneRef.current?.setCriticalEventFocus(!focusCritical)}>Seguir críticos</button><button onClick={()=>sceneRef.current?.resetCamera()}>Centrar</button></div></div><nav className="office-zone-nav" aria-label="Acercar cámara a departamentos"><button type="button" className="office-zone-home" onClick={()=>sceneRef.current?.resetCamera()} aria-pressed={!focusedZone}>Vista completa</button><div className="office-zone-scroll" role="group" aria-label="Elegir departamento">{zoneOrder.map(id=><button key={id} type="button" aria-pressed={focusedZone===id} onClick={()=>sceneRef.current?.focusZone(id)}>{zones[id].label}</button>)}</div></nav><p className="office-zone-status" role="status">{focusedZone ? `Vista cercana: ${zones[focusedZone].label} · sin activar agentes` : 'Vista completa · toca una sala para acercarte; arrastra para mover'}</p>{(campusMode==='DEMO'||agentView.agents.length===0)&&<div className="office-roster-bridge" role="group" aria-label="Explorar agentes sin ejecución real">{campusMode==='DEMO'?<><span>DEMO · personajes ficticios, sin ejecutar agentes reales.</span><button type="button" aria-label="Volver a Campus REAL" onClick={()=>{void hqStore.switchMode('LIVE_READ_ONLY');setCampusMode('REAL');}}>Volver a REAL</button></>:<><span>REAL · aún no hay agentes registrados en este workspace.</span>{showDemo&&<button type="button" aria-label="Ver agentes de demostración" onClick={()=>setCampusMode('DEMO')}>Ver agentes · DEMO</button>}</>}</div>}<div ref={host} className="canvas-host" />{hovered && <div className="hover-card"><b>{hovered.displayName}</b><span>{hovered.role}</span><span>{hovered.status} · {hovered.zone}</span><span>{hovered.securityState}</span></div>}{error && <p role="alert">{error}</p>}</section>
    </section>
    <div className="hq-lower-workspace">
      <section className="hq-work-panel" aria-label="Área de trabajo">
        <div className="hq-work-heading"><h2>{hqModules.find(item=>item.id===activeModule)?.label}</h2><span>{campusMode === 'DEMO' ? 'DEMO · sin datos reales' : 'REAL · workspace autenticado'}</span></div>
        <div className="hq-work-scroll">
          <div className="hq-module-content" hidden={activeModule !== 'ideas' && activeModule !== 'campaigns' && activeModule !== 'runtime'}>
            {campusMode === 'DEMO'
      ? <CampusOverview ideas={ideaCenter!.ideas} view={activeModule === 'campaigns' ? 'campaigns' : activeModule === 'runtime' ? 'runtime' : 'ideas'} onNavigateToCampaigns={()=>setActiveModule('campaigns')} />
      : <RealIdeaCenter store={realIdeas} campaigns={campaignRepository ? workspace => getRealCampaignStore(workspace, owner => new RealCampaignStore(campaignRepository(owner), owner, workspace)) : undefined} onRuntimeSnapshot={onRuntimeSnapshot} view={activeModule === 'campaigns' ? 'campaigns' : activeModule === 'runtime' ? 'runtime' : 'ideas'} />}
          </div>
          <div className="hq-module-content" hidden={activeModule !== 'agents'}>
            <AgentDock view={agentView} onSelect={selectAndFocus}/>
            <AgentInspector view={agentView}/>
            {campusMode==='REAL'&&agentView.agents.length===0&&<p className="hq-module-note">Equipo sin agentes registrados todavía. Los agentes aparecen al registrarse y se mueven solo con eventos verificados.</p>}
          </div>
          <div className="hq-module-content" hidden={activeModule !== 'tasks'}>
            <AgentTaskBoard state={officeState} view={agentView} scope={user?.id ?? ''}/>
            <HandoffTimeline state={officeState} view={agentView}/>
          </div>
          <div className="hq-module-content" hidden={activeModule !== 'activity'}>
            <section className="events"><h2>{officeState.mode === 'MOCK' ? 'DEMO · simulación' : officeState.mode === 'HISTORICAL_REPLAY' ? 'HISTORICAL_REPLAY · eventos pasados' : 'Actividad LIVE'} · {officeState.events.length} eventos</h2>{officeState.mode === 'MOCK' ? <p>Aria, GitHub, Munder Difflin y Supermemory: stubs sin conexión ni escrituras.</p> : <p>Solo eventos recibidos de una fuente verificada. Sin conexión no se muestra actividad inventada.</p>}<div>{officeState.events.map((event) => <button key={event.id} aria-pressed={event.id === (usingRuntime?selectedRuntimeEvent:officeState.selectedEventId)} onClick={() => selectOfficeEvent(event.id,event.actorId)}>{officeState.mode === 'MOCK' ? <><b>{event.type}</b> {event.label.replaceAll('read-only','solo lectura')}</> : <><time dateTime={event.timestamp}>{event.timestamp}</time> · {getOwnAgent(officeState.agents,event.actorId)?.displayName ?? event.actorId ?? '—'} · <b>{event.type}</b> · {event.label} · {event.taskId ?? 'Tarea no observada'} · {event.source}</>}</button>)}</div></section>
            <AgentSignalsPanel state={officeState} scope={user?.id ?? ''} getState={()=>officeStateRef.current} onInspect={selectAndFocus}/>
          </div>
          <div className="hq-module-content" hidden={activeModule !== 'sources'}>
            <div className="controls" role="group" aria-label="Fuentes de datos">
              <button type="button" disabled={campusMode === 'REAL'} aria-pressed={state.mode === 'MOCK'} onClick={() => void hqStore.switchMode('MOCK')}>FUENTE: MOCK</button>
              <button type="button" aria-pressed={state.mode === 'LIVE_READ_ONLY'&&!usingRuntime} onClick={() => void hqStore.switchMode('LIVE_READ_ONLY')}>FUENTE: MUNDER · SOLO LECTURA</button>
              {usingRuntime&&<span role="status">FUENTE: RUNTIME REAL · SOLO LECTURA</span>}
              {state.mode === 'MOCK'?<button onClick={()=>hqStore.restartDemo()}>Reiniciar demo</button>:<button onClick={()=>void hqStore.refreshLive()}>Reintentar lectura</button>}
            </div>
            <section className="source-health" aria-label="Estado de la fuente"><h2>Estado de la fuente</h2><dl><dt>Fuente</dt><dd>{officeState.sourceHealth.source === 'mock' ? 'DEMO · MOCK' : officeState.sourceHealth.source === 'codex' ? 'Codex · archivo histórico' : usingRuntime ? 'Runtime IA · recibos verificados' : 'Munder Difflin'}</dd><dt>Modo</dt><dd>{officeState.mode}</dd><dt>Conexión</dt><dd>{officeState.sourceHealth.connection} · {connectionLabel}</dd><dt>Última lectura correcta</dt><dd>{officeState.mode === 'MOCK' ? 'No aplica · MOCK' : officeState.sourceHealth.lastSuccessfulRead ?? 'Sin lectura correcta'}</dd><dt>Último evento de fuente</dt><dd>{officeState.sourceHealth.lastSourceEvent ?? '—'}</dd><dt>Eventos cargados</dt><dd>{officeState.sourceHealth.eventsLoaded}</dd><dt>Agentes cargados</dt><dd>{officeState.sourceHealth.agentsLoaded}</dd><dt>Tareas cargadas</dt><dd>{officeState.sourceHealth.tasksLoaded}</dd></dl>{officeState.sourceHealth.message && <p role="status">{officeState.sourceHealth.message} {campusMode === 'DEMO' ? 'Puedes cambiar manualmente a MOCK.' : 'La demostración está separada en Campus DEMO.'}</p>}</section>
            {campusMode === 'REAL' && <ExecutionObserverPanel state={state} />}
          </div>
        </div>
      </section>
      <nav className="hq-module-rail" aria-label="Secciones de Raxi HQ">
        {hqModules.map(item=><button key={item.id} type="button" aria-pressed={activeModule===item.id} aria-label={`Abrir ${item.label}`} onClick={()=>setActiveModule(item.id)}>
          <span aria-hidden="true" className="hq-module-symbol">{item.mark}</span><span className="hq-module-name">{item.label}</span>
        </button>)}
      </nav>
    </div>
  </main>;
}
