import type { HQState } from '../../domain/hq';
import type { OfficeAgentView } from './agentViewSelectors';
import { handoffSnapshot } from '../handoffPolicy';

export function HandoffTimeline({state,view}:{state:HQState;view:OfficeAgentView}) {
  const {rows,message}=handoffSnapshot(state);
  return <section className="handoff-timeline" aria-label="Historial de entregas declaradas">
    <h2>Entregas · trazabilidad de declaraciones</h2><p className="handoff-context">{view.modeLabel} · {view.source} · {view.connection}</p>
    <p>Solo lectura. No se certifica una entrega real ni se correlacionan envíos y recepciones.</p>
    {(message||!rows.length)&&<p role="status">{message||'No hay declaraciones de entrega en el snapshot.'}</p>}
    <div className="handoff-list">{rows.map(row=><article key={row.event.id} aria-label={`Declaración ${row.event.id}`}>
      <h3>{row.duplicate?'ID repetido · versión sin conciliar':row.event.type}</h3><code>{row.event.id}</code>
      <p className="handoff-evidence">{row.evidence}</p>
      {!row.duplicate&&<><p>{row.meaning}</p><details><summary>Ver trazabilidad de declaración</summary><dl>
        <dt>Fecha y hora declaradas · no acredita ejecución</dt><dd><time dateTime={row.event.timestamp}>{row.event.timestamp}</time></dd>
        <dt>Fuente declarada</dt><dd>{row.event.source}</dd><dt>Modo</dt><dd>{view.modeLabel}</dd>
        <dt>Emisor declarado</dt><dd>{row.event.actorId??'No declarado'} · {row.actor?.displayName??'Referencia no confirmada'}</dd>
        <dt>Receptor declarado</dt><dd>{row.event.targetId??'No declarado'} · {row.target?.displayName??'Referencia no confirmada'}</dd>
        <dt>ID de tarea</dt><dd>{row.event.taskId??'No declarado'}</dd><dt>ID de asset</dt><dd>{row.event.assetId??'No declarado'}</dd>
        <dt>Campo verified recibido</dt><dd>{String(row.event.verified)} · {state.mode==='MOCK'?'dato de simulación':'no constituye evidencia independiente'}</dd>
      </dl></details></>}
      {row.warnings.length>0&&<ul aria-label="Metadatos faltantes o inconsistentes">{row.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
    </article>)}</div>
  </section>;
}
