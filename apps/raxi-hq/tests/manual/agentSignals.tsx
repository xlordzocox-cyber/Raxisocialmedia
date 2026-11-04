// Local presentation fixtures, not a source, Auth session or agent execution.
import {StrictMode,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {AgentSignalsPanel} from '../../src/office/ui/AgentSignalsPanel';
import {AgentInspector} from '../../src/office/ui/AgentInspector';
import {officeAgentView} from '../../src/office/ui/agentViewSelectors';
import {signalsFixture,signalEvent} from '../agentSignalsFixture';
import '../../src/design/tokens.css';import '../../src/design/global.css';
function Lab(){
  const [scenario,setScenario]=useState('demo'),[selected,select]=useState('b'),[clearCurrent,setClear]=useState(false);
  const mode=scenario==='demo'?'MOCK':scenario==='historical'?'HISTORICAL_REPLAY':'LIVE_READ_ONLY';
  const state=signalsFixture(mode);state.selectedAgentId=selected;
  state.events=[signalEvent({type:'QA_FAIL'}),signalEvent({id:'signal-context',type:'QA_PASS'})];
  if(scenario==='offline')state.sourceHealth.connection='DISCONNECTED';if(scenario==='degraded')state.sourceHealth.connection='DEGRADED';
  if(clearCurrent){state.agents.a.status='IDLE';state.tasks.t.status='COMPLETED';}
  const current=useRef(state);current.current=state;
  return <main><h1>P3B · laboratorio sintético de avisos</h1><p role="note">TODOS LOS DATOS SON FIXTURES LOCALES. LIVE e histórico son escenarios de prueba; no hay fuente conectada, Auth, tareas ni ejecución real.</p>
    <label>Escenario <select value={scenario} onChange={e=>setScenario(e.target.value)}><option value="demo">DEMO/MOCK</option><option value="live">LIVE sintético · verified:true</option><option value="offline">LIVE desconectado</option><option value="degraded">LIVE degradado</option><option value="historical">Histórico · sin atribución Raxi</option></select></label>
    <label><input type="checkbox" checked={clearCurrent} onChange={e=>setClear(e.target.checked)}/>Retirar condiciones actuales · conservar historial</label>
    <AgentSignalsPanel state={state} scope="synthetic-only" getState={()=>current.current} onInspect={select}/>
    <AgentInspector view={officeAgentView(state)}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Lab/></StrictMode>);
