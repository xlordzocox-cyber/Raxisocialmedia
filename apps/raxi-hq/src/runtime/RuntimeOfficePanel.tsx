import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RuntimeOfficeStore, emptyRuntimeHQ } from './runtimeOfficeStore';
import { OfficeScene } from '../office/OfficeScene';
const emptyState:ReturnType<RuntimeOfficeStore['getSnapshot']>={phase:'loading',hq:emptyRuntimeHQ(),tasks:[]};
const noSubscribe=()=>()=>{};
const getEmpty=()=>emptyState;
export function RuntimeOfficePanel({client,owner,workspace}:{client:SupabaseClient;owner:string;workspace:string}){
 const [store,setStore]=useState<RuntimeOfficeStore|null>(null);
 const state=useSyncExternalStore(store?.subscribe??noSubscribe,store?.getSnapshot??getEmpty,store?.getSnapshot??getEmpty);const host=useRef<HTMLDivElement>(null);const scene=useRef<OfficeScene|null>(null);
 useEffect(()=>{const current=new RuntimeOfficeStore(async()=>{const {data,error}=await client.rpc('raxi_runtime_office',{p_workspace:workspace});if(error)throw Error(error.code==='PGRST202'?'SERVICE_NOT_DEPLOYED':'Read failed');return data;},owner,workspace);
  setStore(current);void current.load();const poll=setInterval(()=>{void current.load();},5000);const expiry=setInterval(()=>current.expire(),1000);
  return()=>{clearInterval(poll);clearInterval(expiry);current.dispose();};},[client,owner,workspace]);
 const hasAgents=state.phase==='ready'&&Object.keys(state.hq.agents).length>0;
 useEffect(()=>{if(hasAgents&&host.current){try{scene.current=new OfficeScene(host.current,()=>{});}catch{/* Missing WebGL cannot create execution state. */}}
  return()=>{scene.current?.destroy();scene.current=null;};},[hasAgents,store]);
 useEffect(()=>{if(state.phase==='ready')scene.current?.update(state.hq);},[state]);
 return <section className="source-health" aria-label="Runtime IA propio">
  <h2>Director IA e Investigador</h2><p>Conexión propia · independiente de Munder · solo eventos confirmados</p>
  <p role="status">{state.phase==='unavailable'?'Runtime pendiente de despliegue autorizado. No hay agentes ejecutándose.':state.phase==='error'?'No se pudo confirmar el runtime. No se muestra actividad activa.':state.phase==='loading'?'Consultando estado confirmado…':`${Object.keys(state.hq.agents).length} agentes con eventos reales confirmados`}</p>
  <button disabled>Solicitar investigación · pendiente de habilitación y autorización de coste</button>
  {state.tasks.map(t=><article key={t.id}><p>{t.simulated?'SIMULACIÓN · no acredita IA real':'Tarea autorizada'} · {t.title} · {t.simulated?'fixture':t.status}</p>{t.result&&typeof t.result==='object'&&'summary' in t.result&&typeof t.result.summary==='string'?<p>{t.result.summary}</p>:null}</article>)}
  {hasAgents&&<div className="canvas-host" ref={host}/>}
 </section>;
}
