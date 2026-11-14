import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readAuthConfig } from '../auth/config';
import { checkHostedRuntimeAuth, type RuntimeAuthChecks } from './runtimeAuthDiagnostics';
import { RuntimeOfficeStore, emptyRuntimeHQ, type RuntimeOfficeSink } from './runtimeOfficeStore';
import { OfficeScene } from '../office/OfficeScene';
const emptyState:ReturnType<RuntimeOfficeStore['getSnapshot']>={phase:'loading',hq:emptyRuntimeHQ(),tasks:[]};
const noSubscribe=()=>()=>{};
const getEmpty=()=>emptyState;
export function RuntimeOfficePanel({client,owner,workspace,onRuntimeSnapshot,renderCanvas=true}:{client:SupabaseClient;owner:string;workspace:string;onRuntimeSnapshot?:RuntimeOfficeSink;renderCanvas?:boolean}){
 const [store,setStore]=useState<RuntimeOfficeStore|null>(null);
 const [authCheck,setAuthCheck]=useState<{phase:'idle'|'running'|'complete'|'blocked';result?:RuntimeAuthChecks}>({phase:'idle'});
 const authGeneration=useRef(0);
 useEffect(()=>{authGeneration.current++;setAuthCheck({phase:'idle'});return()=>{authGeneration.current++;};},[owner,workspace]);
 const runReadOnlyAuthCheck=async()=>{
  if(authCheck.phase==='running')return;
  const generation=++authGeneration.current;
  // This command is intentionally STAGING ONLY and runs only on user click.
  const config=readAuthConfig(import.meta.env);
  if(!config||config.url!=='https://zvhxjindgyvtasstfjut.supabase.co') {
   setAuthCheck({phase:'blocked'});return;
  }
  setAuthCheck({phase:'running'});
  try {
   // Explicit stateless client: no local session, cookies or refresh tokens.
   const anonymous=createClient(config.url,config.key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   });
   const result=await checkHostedRuntimeAuth(client,anonymous,owner,workspace,crypto.randomUUID());
   if(authGeneration.current===generation)setAuthCheck({phase:'complete',result});
  } catch {
   if(authGeneration.current===generation)setAuthCheck({phase:'blocked'});
  }
 };

 const state=useSyncExternalStore(store?.subscribe??noSubscribe,store?.getSnapshot??getEmpty,store?.getSnapshot??getEmpty);const host=useRef<HTMLDivElement>(null);const scene=useRef<OfficeScene|null>(null);
 useEffect(()=>{const current=new RuntimeOfficeStore(async()=>{const {data,error}=await client.rpc('raxi_runtime_office',{p_workspace:workspace});if(error)throw Error(error.code==='PGRST202'?'SERVICE_NOT_DEPLOYED':'Read failed');return data;},owner,workspace);
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
  <h2>Director IA e Investigador</h2><p>Conexión propia · independiente de Munder · solo eventos confirmados</p>
  <p role="status">{state.phase==='unavailable'?'Runtime pendiente de despliegue autorizado. No hay agentes ejecutándose.':state.phase==='error'?'No se pudo confirmar el runtime. No se muestra actividad activa.':state.phase==='loading'?'Consultando estado confirmado…':`${Object.keys(state.hq.agents).length} agentes con eventos reales confirmados`}</p>
  {state.phase==='ready'&&Object.values(state.hq.agents).some(agent=>agent.status==='WAITING')&&
   <p>Despacho autorizado y registrado; la caminata es una representación visual. El proveedor todavía no está confirmado.</p>}
  <button disabled>Solicitar investigación · pendiente de habilitación y autorización de coste</button>
  <section aria-label="Diagnóstico de permisos Auth" className="runtime-auth-diagnostic">
   <h3>Comprobar acceso real · solo lectura</h3>
   <p>Usa tu sesión actual; no copia tokens ni crea tareas. Las pruebas de otro usuario real y de revocación siguen pendientes.</p>
   <button type="button" disabled={state.phase!=='ready'||authCheck.phase==='running'} onClick={()=>void runReadOnlyAuthCheck()}>Verificar permisos de staging</button>
   {authCheck.phase==='running'&&<p role="status">Consultando Auth y RPC de staging sin modificar datos…</p>}
   {authCheck.phase==='blocked'&&<p role="alert">Verificación no realizada: entorno distinto de staging o fallo de consulta.</p>}
   {authCheck.phase==='complete'&&authCheck.result&&<div role="status" aria-live="polite">
    <p>Diagnóstico de lectura (PASS no autoriza ejecutar agentes):</p>
    <ul>{([
     ['Sesión Auth existente',authCheck.result.user],
     ['RPC del workspace propio',authCheck.result.ownerWorkspace],
     ['Workspace aleatorio no autorizado',authCheck.result.unknownWorkspace],
     ['Cliente anónimo sin permiso',authCheck.result.anonymous],
     ['Segunda cuenta real',authCheck.result.secondRealUser],
     ['Revocación de sesión real',authCheck.result.sessionRevocation],
    ] as const).map(([label,check])=><li key={label}>{label}: {check==='PASS'?'Correcto':check==='FAIL'?'No validado':'Pendiente'}</li>)}</ul>
    <p>Un workspace aleatorio no demuestra aislamiento entre dos usuarios reales. No se ha cerrado ninguna sesión.</p>
   </div>}
  </section>
  {state.tasks.map(t=><article key={t.id}><p>{t.simulated?'SIMULACIÓN · no acredita IA real':'Tarea autorizada'} · {t.title} · {t.simulated?'fixture':t.status}</p>{t.result&&typeof t.result==='object'&&'summary' in t.result&&typeof t.result.summary==='string'?<p>{t.result.summary}</p>:null}</article>)}
  {renderCanvas&&hasAgents&&<div className="canvas-host" ref={host}/>}
 </section>;
}
