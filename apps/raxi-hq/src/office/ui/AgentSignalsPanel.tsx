import {useEffect,useRef} from 'react';
import type { HQState } from '../../domain/hq';
import { agentSignalsView, type AgentSignal } from './agentSignalsSelectors';

export function AgentSignalsPanel({state,scope,getState,onInspect}:{state:HQState;scope:string;getState:()=>HQState;onInspect:(id:string)=>void}){
  const view=agentSignalsView(state);
  const presented=useRef({state,scope});presented.current={state,scope};
  const active=useRef(false);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const inspect=(row:AgentSignal)=>{
    if(!active.current || !row.inspectId || presented.current.scope!==scope || presented.current.state!==state || getState()!==state)return;
    const fresh=agentSignalsView(getState());
    if(!fresh.available || ![...fresh.current,...fresh.history].some(item=>item.key===row.key && item.inspectId===row.inspectId))return;
    onInspect(row.inspectId);
  };
  const render=(row:AgentSignal)=><article key={row.key} aria-label={`${row.category} ${row.id}`}>
    <h4>{row.category}</h4><code>{row.original}</code><dl>
      <div><dt>ID del registro</dt><dd>{row.id}</dd></div><div><dt>Agente declarado</dt><dd>{row.agentId??'No declarado'}{row.agentName?` · ${row.agentName}`:''}</dd></div>
      {row.targetId&&<div><dt>Receptor declarado</dt><dd>{row.targetId}</dd></div>}
      <div><dt>Tarea declarada</dt><dd>{row.taskId??'No declarada'}</dd></div><div><dt>Campaña declarada</dt><dd>{row.campaignId??'No declarada'}</dd></div>
      {row.assetId&&<div><dt>Asset declarado</dt><dd>{row.assetId}</dd></div>}
      <div><dt>Fuente y modo</dt><dd>{row.source} · {state.mode}</dd></div><div><dt>Timestamp declarado disponible</dt><dd>{row.timestamp??'No informado por la fuente'}</dd></div>
      {row.verified!==undefined&&<div><dt>verified recibido · no es prueba independiente</dt><dd>{String(row.verified)}</dd></div>}
    </dl><p>{view.provenance}. No acredita incidente vigente, aprobación humana ni permiso para actuar.</p>
    {!!row.warnings.length&&<ul aria-label="Referencias no conciliadas">{row.warnings.map((w,index)=><li key={index}>{w}</li>)}</ul>}
    {row.inspectId&&<button type="button" onClick={()=>inspect(row)}>Inspeccionar agente · {row.inspectId}</button>}
  </article>;
  return <section className="agent-signals" aria-label="Avisos y bloqueos · Oficina">
    <h2>Avisos y bloqueos · Oficina</h2><p>{state.mode} · {state.sourceHealth.source} · {state.sourceHealth.connection}</p><p>{view.provenance}</p>
    <p>Solo consulta. Un requisito declarado no acredita una aprobación humana pendiente. No se cierran ni correlacionan señales automáticamente.</p>
    {!view.available?<p role="status">{view.message}</p>:<>
      <h3>Estados declarados en el snapshot</h3>{view.current.length?view.current.map(render):<p>Sin señales de estas categorías en el snapshot disponible.</p>}
      <h3>Historial de señales declaradas</h3><p>Eventos pasados: no demuestran que un problema siga activo. QA_PASS y APPROVAL_GRANTED no certifican una aprobación humana autenticada.</p>
      {view.history.length?view.history.map(render):<p>Sin eventos de estas categorías en el historial disponible.</p>}
      {!!view.warnings.length&&<div role="status"><h3>Advertencias de referencias</h3><ul>{view.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
    </>}
  </section>;
}
