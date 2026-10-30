// Local visual harness, excluded from the production entrypoint. Auth/repositories are TEST DOUBLES.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import App from '../../src/App';
import { AuthStore } from '../../src/auth/authStore';
import { AuthProvider } from '../../src/auth/AuthProvider';
import { ProtectedRoute } from '../../src/auth/AuthRoutes';
import '../../src/design/tokens.css';
import '../../src/design/global.css';
import '../../src/campus/campus.css';
import { AgentInspector } from '../../src/office/ui/AgentInspector';
import { officeAgentView } from '../../src/office/ui/agentViewSelectors';
import type { HQState } from '../../src/domain/hq';
import { mockAgents } from '../../src/adapters/mock/mockScenario';

/** Isolated inspector QA, never admitted to HQStore or connected to a repository. */
function TaskLinksQa() {
  const [scenario,setScenario]=useState('owner');
  const agent={...mockAgents[0],id:'qa-agent',displayName:'Agente QA sintético',currentTaskId:'qa-task',campaignId:'qa-campaign'};
  const task={id:'qa-task',title:'Tarea QA sintética',status:'QUEUED',ownerAgentId:scenario==='owner'?'qa-other':'qa-agent',campaignId:scenario==='campaign'?'qa-other-campaign':scenario==='incomplete'?undefined:'qa-campaign'};
  const state:HQState={agents:{[agent.id]:agent},tasks:scenario==='missing'?{}:{[task.id]:task},campaigns:{},events:[],handoffs:[],memorySignals:[],selectedAgentId:agent.id,mode:'MOCK',mockMode:true,readOnly:true,sourceHealth:{source:'mock',mode:'MOCK',connection:'CONNECTED',agentsLoaded:1,tasksLoaded:scenario==='missing'?0:1,eventsLoaded:0}};
  return <main><h1>Inspector · casos límite sintéticos</h1><p role="note">ENSAYO LOCAL MOCK · datos sintéticos · sin Auth, fuentes externas ni cambios operativos.</p>
    <label>Caso de vínculo de tarea <select value={scenario} onChange={event=>setScenario(event.target.value)}>
      <option value="owner">Propietario contradictorio</option><option value="campaign">Campaña contradictoria</option><option value="incomplete">Campaña incompleta</option><option value="missing">Tarea ausente</option><option value="matched">Metadatos coincidentes</option>
    </select></label><AgentInspector view={officeAgentView(state)}/></main>;
}
// Opt-in browser QA fixture only. Does not change OS/browser preferences or production code.
const reducedMotionFixture = new URLSearchParams(window.location.search).get('motion') === 'reduce';
if (reducedMotionFixture) {
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = query => {
    const result = matchMedia(query);
    return query === '(prefers-reduced-motion: reduce)'
      ? Object.defineProperty(result, 'matches', { value: true }) : result;
  };
}
const auth = new AuthStore({
  getUser: async () => ({ data: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as User }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({ error: null }),
} as unknown as SupabaseClient['auth']);
const repository = () => ({
  findWorkspace: async () => null,
  createWorkspace: async () => { throw new Error('TEST ONLY: escritura bloqueada'); },
  listIdeas: async () => [],
  createIdea: async () => { throw new Error('TEST ONLY: escritura bloqueada'); },
});
createRoot(document.getElementById('root')!).render(<StrictMode>
  {new URLSearchParams(window.location.search).get('taskLinks') === '1' ? <TaskLinksQa/> : <>
  <p role="note">ENSAYO LOCAL: Auth y repositorios simulados. La captura de Codex es histórica auténtica. No prueba Auth alojado ni actividad en vivo.</p>
  {reducedMotionFixture && <p role="note">MOVIMIENTO REDUCIDO · preferencia simulada exclusivamente para QA local.</p>}
  <AuthProvider store={auth}><MemoryRouter><Routes><Route element={<ProtectedRoute/>}><Route path="/" element={<App ideaRepository={repository}/>}/></Route></Routes></MemoryRouter></AuthProvider>
  </>}
</StrictMode>);
