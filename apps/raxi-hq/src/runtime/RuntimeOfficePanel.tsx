import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RuntimeOfficeStore, emptyRuntimeHQ, type RuntimeOfficeSink } from './runtimeOfficeStore';
import { OfficeScene } from '../office/OfficeScene';
const emptyState:ReturnType<RuntimeOfficeStore['getSnapshot']>={phase:'loading',hq:emptyRuntimeHQ(),tasks:[]};
// Optional, RLS-scoped roster read. Failure only hides idle profiles; it never invents activity.
async function readTeam(client:SupabaseClient,workspace:string):Promise<unknown[]|null>{
 try{if(typeof client.from!=='function')return null;const {data,error}=await client.from('raxi_agent_profiles').select('id,role,display_name,runtime_status').eq('workspace_id',workspace);return error||!Array.isArray(data)?null:data;}catch{return null;}
}
const noSubscribe=()=>()=>{};
const getEmpty=()=>emptyState;
export function RuntimeOfficePanel({client,owner,workspace,onRuntimeSnapshot,renderCanvas=true}:{client:SupabaseClient;owner:string;workspace:string;onRuntimeSnapshot?:RuntimeOfficeSink;renderCanvas?:boolean}){
 const [store,setStore]=useState<RuntimeOfficeStore|null>(null);
 const state=useSyncExternalStore(store?.subscribe??noSubscribe,store?.getSnapshot??getEmpty,store?.getSnapshot??getEmpty);const host=useRef<HTMLDivElement>(null);const scene=useRef<OfficeScene|null>(null);
 useEffect(()=>{const current=new RuntimeOfficeStore(async()=>{const {data,error}=await client.rpc('raxi_runtime_office',{p_workspace:workspace});if(error)throw Error(error.code==='PGRST202'?'SERVICE_NOT_DEPLOYED':'Read failed');const profiles=await readTeam(client,workspace);return profiles&&data&&typeof data==='object'?{...data,profiles}:data;},owner,workspace);
  setStore(current);void current.load();const poll=setInterval(()=>{void current.load();},5000);const expiry=setInterval(()=>current.expire(),1000);
  return()=>{clearInterval(poll);clearInterval(expiry);current.dispose();};},[client,owner,workspace]);
 const hasAgents=state.phase==='ready'&&Object.keys(state.hq.agents).length>0;
 // The primary office may consume this projection; no privileged state or write is shared.
 useEffect(()=>{onRuntimeSnapshot?.({owner,workspace},state.phase==='ready'&&state.hq.sourceHealth.connection==='CONNECTED'?state.hq:null);},[onRuntimeSnapshot,owner,workspace,state]);
 useEffect(()=>()=>onRuntimeSnapshot?.({owner,workspace},null),[onRuntimeSnapshot,owner,workspace]);
 useEffect(()=>{if(renderCanvas&&hasAgents&&host.current){try{scene.current=new OfficeScene(host.current,()=>{});}catch{/* Missing WebGL cannot create execution state. */}}
  return()=>{scene.current?.destroy();scene.current=null;};},[renderCanvas,hasAgents,store]);
 useEffect(()=>{if(state.phase==='ready')scene.current?.update(state.hq);},[state]);
 return <section className="source-health" aria-label="Runtime IA propio">
  <h2>Equipo de agentes</h2><p>Conexión propia · independiente de Munder · solo eventos confirmados</p>
  <p role="status">{state.phase==='unavailable'?'Runtime pendiente de despliegue autorizado. No hay agentes ejecutándose.':state.phase==='error'?'No se pudo confirmar el runtime. No se muestra actividad activa.':state.phase==='loading'?'Consultando estado confirmado…':`${Object.keys(state.hq.agents).length} agentes en el equipo · ${Object.values(state.hq.agents).filter(a=>!a.capabilities.includes('registered-profile')).length} agentes con eventos reales confirmados`}</p>
  {state.phase==='ready'&&Object.values(state.hq.agents).some(agent=>agent.status==='WAITING')&&
   <p>Despacho autorizado y registrado; la caminata es una representación visual. El proveedor todavía no está confirmado.</p>}
  <button disabled>Solicitar investigación · pendiente de habilitación y autorización de coste</button>
  {state.tasks.map(t=><article key={t.id}><p>{t.simulated?'SIMULACIÓN · no acredita IA real':'Tarea autorizada'} · {t.title} · {t.simulated?'fixture':t.status}</p>{t.result&&typeof t.result==='object'&&'summary' in t.result&&typeof t.result.summary==='string'?<p>{t.result.summary}</p>:null}</article>)}
  {renderCanvas&&hasAgents&&<div className="canvas-host" ref={host}/>}
 </section>;
}
