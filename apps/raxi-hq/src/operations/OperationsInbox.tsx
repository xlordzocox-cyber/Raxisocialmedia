import type { IdeaHandoffToHQ } from '../ideas/ideaContracts';
import { ideaChannelLabel, ideaPriorityLabel, ideaSourceLabel } from '../ideas/ideaPresentation';

export function OperationsInbox({ id, handoffs, open }: { id: string; handoffs: readonly IdeaHandoffToHQ[]; open: boolean }) {
  return <section id={id} className="operations-inbox" role="region" aria-label="Bandeja de propuestas recibidas" hidden={!open}>
    <div className="operations-inbox-heading"><span className="campus-eyebrow">CENTRO DE OPERACIONES</span><h3>Bandeja de propuestas recibidas</h3><p>Handoffs internos de esta sesión. El HQ decide si una propuesta merece una campaña.</p></div>
    {handoffs.length === 0 ? <p className="operations-empty">Aún no hay propuestas recibidas.</p> : handoffs.map(item => <article key={item.ideaId} className="operations-proposal">
      <div className="operations-proposal-top"><code>{item.ideaId}</code><span>PROPUESTA RECIBIDA</span></div>
      <h4>{item.title}</h4><p>{item.summary}</p><p><strong>Motivo:</strong> {item.reason}</p>
      <dl><div><dt>Origen</dt><dd>{ideaSourceLabel[item.source]}</dd></div><div><dt>Prioridad</dt><dd>{ideaPriorityLabel[item.priority]}</dd></div><div><dt>Canales sugeridos</dt><dd>{item.suggestedChannels.map(channel => ideaChannelLabel[channel]).join(', ') || 'Sin canales'}</dd></div><div><dt>Afinidad / confianza</dt><dd>{item.fitScore}% / {item.confidenceScore}%</dd></div><div><dt>Recibida</dt><dd>{item.sentAt}</dd></div>{item.evidenceRefs.length > 0 && <div><dt>Referencias de evidencia</dt><dd>{item.evidenceRefs.join(', ')}</dd></div>}</dl>
      <span className="operations-pending">PENDIENTE DE DECISIÓN DEL HQ</span>
    </article>)}
    <p className="idea-scope-note">Siguiente etapa futura: evaluar conversión a campaña.</p>
  </section>;
}
