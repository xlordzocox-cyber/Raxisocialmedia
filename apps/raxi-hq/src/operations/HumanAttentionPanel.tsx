import type { HumanAttentionItem, HumanAttentionView } from './humanAttentionSelectors';

export function HumanAttentionPanel({view,onNavigate}:{view:HumanAttentionView;onNavigate:(item:HumanAttentionItem)=>void}){
  return <section className="human-attention" aria-label="Te toca — Atención humana">
    <h3>Te toca — Atención humana</h3><p>REAL · Consulta y navegación. Las decisiones permanecen en sus flujos originales.</p>
    {!view.available?<p role="status">No es posible confirmar los asuntos pendientes.</p>:<>
      <p role="status">{view.items.filter(i=>i.kind==='proposal').length} propuestas sin decisión registrada · {view.items.filter(i=>i.kind==='strategy').length} estrategias en revisión</p>
      {!view.items.length && !view.warnings.length && <p>Sin asuntos en la lectura canónica confirmada.</p>}
      {view.items.map(item=><article key={`${item.kind}:${item.id}`}>
        <h4>{item.title}</h4><strong>{item.kind==='proposal'?'Propuesta recibida · sin decisión registrada':'Strategy lista para revisión humana'}</strong>
        <dl><div><dt>ID</dt><dd>{item.id}</dd></div><div><dt>Origen declarado</dt><dd>{item.origin}</dd></div><div><dt>Fecha registrada</dt><dd>{item.date || 'No disponible'}</dd></div>
          {item.kind==='strategy'&&<><div><dt>Revisión</dt><dd>{item.revision}</dd></div><div><dt>Estado</dt><dd>IN_REVIEW</dd></div></>}
        </dl><button type="button" onClick={()=>onNavigate(item)}>{item.kind==='proposal'?'Ver propuesta':'Revisar estrategia'}</button>
      </article>)}
      {!!view.warnings.length&&<div role="status"><p>Referencias inconsistentes; no se selecciona una versión arbitraria.</p><ul>{view.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
    </>}
  </section>;
}
