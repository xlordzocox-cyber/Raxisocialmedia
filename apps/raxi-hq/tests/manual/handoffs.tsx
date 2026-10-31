// Explicit local presentation fixtures; never a live source or operational store.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HandoffTimeline } from '../../src/office/ui/HandoffTimeline';
import { officeAgentView } from '../../src/office/ui/agentViewSelectors';
import { OfficeScene } from '../../src/office/OfficeScene';
import { mockAgents } from '../../src/adapters/mock/mockScenario';
import type { HQState } from '../../src/domain/hq';
import '../../src/design/tokens.css';
import '../../src/design/global.css';

const mode=new URLSearchParams(location.search).get('motion');
if(mode==='reduce'){
  const matchMedia=window.matchMedia.bind(window);
  window.matchMedia=query=>query==='(prefers-reduced-motion: reduce)'?Object.defineProperty(matchMedia(query),'matches',{value:true}):matchMedia(query);
}
function Lab(){
  const [scenario,setScenario]=useState('demo-empty');const [selected,setSelected]=useState('qa-sender');
  const [conflictingReceiver,setConflictingReceiver]=useState(false);
  const host=useRef<HTMLDivElement>(null),scene=useRef<OfficeScene|undefined>(undefined);
  const live=scenario.startsWith('live'),historical=scenario==='historical';
  const state:HQState={mode:historical?'HISTORICAL_REPLAY':live?'LIVE_READ_ONLY':'MOCK',mockMode:!live&&!historical,readOnly:true,selectedAgentId:selected,
    agents:historical?{}:{'qa-sender':{...mockAgents[0],id:'qa-sender',displayName:'Emisor sintético',zone:'WAR_ROOM'},'qa-receiver':{...mockAgents[1],id:'qa-receiver',displayName:'Receptor sintético',zone:'RESEARCH_LAB'}},tasks:{},campaigns:{},handoffs:[],memorySignals:[],
    events:scenario==='demo-empty'||historical?[]:[{id:'qa-handoff-synthetic',timestamp:'2000-01-01T00:00:00Z',type:'HANDOFF_SENT',actorId:'qa-sender',targetId:'qa-receiver',source:live?'munder':'aria',verified:true,label:'Fixture explícita, no ejecución real'}],
    sourceHealth:{source:historical?'codex':live?'munder':'mock',mode:historical?'HISTORICAL_REPLAY':live?'LIVE_READ_ONLY':'MOCK',connection:scenario==='live-offline'||historical?'DISCONNECTED':'CONNECTED',agentsLoaded:historical?0:2,tasksLoaded:0,eventsLoaded:scenario==='demo-empty'||historical?0:1}};
  if(scenario==='demo-handoff'){
    state.agents['qa-sender'].campaignId='qa-c1';state.agents['qa-receiver'].campaignId=conflictingReceiver?'qa-c2':'qa-c1';
    state.tasks['qa-task']={id:'qa-task',title:'Tarea sintética',status:'QUEUED',ownerAgentId:'qa-sender',campaignId:'qa-c1'};
    state.events[0].taskId='qa-task';state.sourceHealth.tasksLoaded=1;
  }
  useEffect(()=>{
    const current=new OfficeScene(host.current!,id=>setSelected(id));scene.current=current;
    return()=>{scene.current=undefined;current.destroy();};
  },[]);
  useEffect(()=>scene.current?.update(state));
  return <main><h1>P2B · laboratorio sintético de presentación</h1>
    <p role="note">TODOS LOS DATOS SON FIXTURES LOCALES. Los modos simulan contratos: no hay fuente LIVE, Auth, proveedores ni ejecución real.</p>
    {mode==='reduce'&&<p role="note">Movimiento reducido: preferencia simulada de QA; sin cambio de configuración del sistema.</p>}
    <label>Escenario sintético <select value={scenario} onChange={event=>setScenario(event.target.value)}>
      <option value="demo-empty">DEMO sin eventos</option><option value="demo-handoff">DEMO envío declarado</option><option value="live-verified">LIVE sintético verified:true</option><option value="live-offline">LIVE sintético desconectado</option><option value="historical">Histórico sin handoffs</option>
    </select></label>
    <label><input type="checkbox" checked={conflictingReceiver} onChange={event=>setConflictingReceiver(event.target.checked)}/>Receptor en otra campaña (fixture DEMO)</label>
    <section className="office"><div ref={host} className="canvas-host"/></section>
    <HandoffTimeline state={state} view={officeAgentView(state)}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Lab/></StrictMode>);
