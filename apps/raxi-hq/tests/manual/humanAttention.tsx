// Explicit synthetic repositories. No Auth, RPC, provider or operational execution.
import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RealCampaignCenter} from '../../src/persistence/RealCampaignCenter';
import {RealCampaignStore} from '../../src/persistence/realCampaignStore';
import {RealIdeaStore} from '../../src/persistence/realIdeaStore';
import {emptyCampaignSnapshot} from '../../src/persistence/campaignCommands';
import {attentionFixture,attentionOwner as owner,attentionWorkspace as workspace} from '../humanAttentionFixture';
import '../../src/design/tokens.css';import '../../src/design/global.css';import '../../src/campus/campus.css';
function Example({scenario}:{scenario:string}){
  const [{ideas,store}]=useState(()=>({
    ideas:new RealIdeaStore({findWorkspace:async()=>({id:workspace,ownerId:owner,name:'raxi-hq'}),listIdeas:async()=>[],createWorkspace:async()=>{throw Error('Escritura no permitida');},createIdea:async()=>{throw Error('Escritura no permitida');}},owner),
    store:new RealCampaignStore({read:async()=>{
      if(scenario==='loading')return new Promise(()=>{});
      if(scenario==='unavailable')throw Error('SERVICE_NOT_DEPLOYED');if(scenario==='error')throw Error('Error sintético de lectura');
      return scenario==='empty'?emptyCampaignSnapshot(owner,workspace):attentionFixture();
    },execute:async()=>{throw Error('ENSAYO SINTÉTICO: operación sin confirmación');}},owner,workspace),
  }));
  useEffect(()=>{void(async()=>{await ideas.load();await store.load();if(scenario==='pending')await store.execute({type:'REJECT_PROPOSAL',ideaId:attentionFixture().ideas[0].id,reason:'Fixture incierta'});})();},[ideas,store,scenario]);
  return <RealCampaignCenter store={store} ideas={ideas}/>;
}
function Lab(){const [scenario,setScenario]=useState('ready');return <main>
  <h1>P3A · laboratorio sintético «Te toca»</h1><p role="note">FIXTURES LOCALES. Auth, repositorios y asuntos son sintéticos; no hay conexión ni escritura Supabase, proveedores o ejecución real.</p>
  <label>Escenario <select value={scenario} onChange={e=>setScenario(e.target.value)}>{['ready','empty','unavailable','loading','error','pending'].map(s=><option key={s} value={s}>{s}</option>)}</select></label>
  <Example key={scenario} scenario={scenario}/>
</main>;}
createRoot(document.getElementById('root')!).render(<StrictMode><Lab/></StrictMode>);
