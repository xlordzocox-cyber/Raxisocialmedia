import type { OperationsInboxItem } from '../ideas/ideaCenterSession';
import { ideaChannelLabel, ideaPriorityLabel, ideaProvenanceLabel, ideaSourceLabel } from '../ideas/ideaPresentation';

export function OperationsInbox({ id, handoffs, open }: { id: string; handoffs: readonly OperationsInboxItem[]; open: boolean }) {
  return <section id={id} className="operations-inbox" role="region" aria-label="Bandeja de propuestas recibidas" hidden={!open}>
    <div className="operations-inbox-heading"><span className="campus-eyebrow">CENTRO DE OPERACIONES</span><h3>Bandeja de propuestas recibidas</h3><p>Handoffs internos de esta sesión. El HQ decide si una propuesta merece una campaña.</p></div>
    {handoffs.length === 0 ? <p className="operations-empty">Aún no hay propuestas recibidas.</p> : handoffs.map(({ handoff, provenance }) => <article key={handoff.ideaId} className="operations-proposal">
      <div className="operations-proposal-top"><code>{handoff.ideaId}</code><span>PROPUESTA RECIBIDA</span><span className="operations-provenance" data-provenance={provenance}>{ideaProvenanceLabel[provenance]}</span></div>
      <h4>{handoff.title}</h4><p>{handoff.summary}</p><p><strong>Motivo:</strong> {handoff.reason}</p>
      <dl><div><dt>Origen</dt><dd>{ideaSourceLabel[handoff.source]}</dd></div><div><dt>Prioridad</dt><dd>{ideaPriorityLabel[handoff.priority]}</dd></div><div><dt>Canales sugeridos</dt><dd>{handoff.suggestedChannels.map(channel => ideaChannelLabel[channel]).join(', ') || 'Sin canales'}</dd></div><div><dt>Afinidad / confianza</dt><dd>{handoff.fitScore}% / {handoff.confidenceScore}%</dd></div><div><dt>Recibida</dt><dd>{handoff.sentAt}</dd></div>{handoff.evidenceRefs.length > 0 && <div><dt>Referencias de evidencia</dt><dd>{handoff.evidenceRefs.join(', ')}</dd></div>}</dl>
      <span className="operations-pending">PENDIENTE DE DECISIÓN DEL HQ</span>
    </article>)}
    <p className="idea-scope-note">Siguiente etapa futura: evaluar conversión a campaña.</p>
  </section>;
}
