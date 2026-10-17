import { useState } from 'react';
import type { OperationsInboxItem } from '../ideas/ideaCenterSession';
import { ideaChannelLabel, ideaPriorityLabel, ideaProvenanceLabel, ideaSourceLabel } from '../ideas/ideaPresentation';
import type { CampaignCommand, CampaignSession } from '../campaigns/campaignSession';
import { campaignDecision } from '../campaigns/campaignSession';
import { CampaignBriefForm } from '../campaigns/CampaignBriefForm';

export function OperationsInbox({ id, handoffs, open, campaigns, onAction, onOpenCampaign }: {
  id: string; handoffs: readonly OperationsInboxItem[]; open: boolean; campaigns?: CampaignSession;
  onAction?: (action: CampaignCommand) => boolean; onOpenCampaign?: (id: string) => void;
}) {
  const [evaluating, setEvaluating] = useState<string>();
  const [step, setStep] = useState<'review' | 'reject' | 'brief'>('review');
  const [reason, setReason] = useState('');
  const [rejectConfirm, setRejectConfirm] = useState(false);
  const close = () => { setEvaluating(undefined); setStep('review'); setReason(''); setRejectConfirm(false); };
  return <section id={id} className="operations-inbox" role="region" aria-label="Bandeja de propuestas recibidas" hidden={!open}>
    <div className="operations-inbox-heading"><span className="campus-eyebrow">CENTRO DE OPERACIONES</span><h3>Bandeja de propuestas recibidas</h3><p>Handoffs internos de esta sesión. Luis decide si una propuesta merece una campaña.</p></div>
    {handoffs.length === 0 ? <p className="operations-empty">Aún no hay propuestas recibidas.</p> : handoffs.map(({ handoff, provenance }) => {
      const decision = campaigns ? campaignDecision(campaigns, handoff.ideaId) : { status: 'PENDING' as const, campaignId: undefined, reason: undefined };
      const active = evaluating === handoff.ideaId && decision.status === 'PENDING';
      return <article key={handoff.ideaId} className="operations-proposal">
        <div className="operations-proposal-top"><code>{handoff.ideaId}</code><span>PROPUESTA RECIBIDA</span><span className="operations-provenance" data-provenance={provenance}>{ideaProvenanceLabel[provenance]}</span></div>
        <h4>{handoff.title}</h4><p className="idea-multiline">{handoff.summary}</p><p className="idea-multiline"><strong>Motivo:</strong> {handoff.reason}</p>
        <dl><div><dt>Origen</dt><dd>{ideaSourceLabel[handoff.source]}</dd></div><div><dt>Prioridad</dt><dd>{ideaPriorityLabel[handoff.priority]}</dd></div><div><dt>Canales sugeridos</dt><dd>{handoff.suggestedChannels.map(channel => ideaChannelLabel[channel]).join(', ') || 'Sin canales'}</dd></div><div><dt>Afinidad / confianza</dt><dd>{handoff.fitScore}% / {handoff.confidenceScore}%</dd></div><div><dt>Recibida</dt><dd>{handoff.sentAt}</dd></div><div><dt>Referencias de evidencia</dt><dd>{handoff.evidenceRefs.join(', ') || 'Sin referencias'}</dd></div></dl>
        {decision.status === 'PENDING' ? <><span className="operations-pending">PENDIENTE DE DECISIÓN DEL HQ</span>{onAction && <div className="operations-actions"><button type="button" onClick={() => { setEvaluating(handoff.ideaId); setStep('review'); }}>Evaluar propuesta</button></div>}</> :
          decision.status === 'ACCEPTED' ? <div className="operations-decision"><strong>CONVERTIDA EN CAMPAÑA</strong><code>{decision.campaignId}</code><button type="button" onClick={() => decision.campaignId && onOpenCampaign?.(decision.campaignId)}>Abrir campaña</button></div> :
            <div className="operations-decision"><strong>NO CONVERTIDA EN CAMPAÑA</strong><p className="idea-multiline">{decision.reason}</p></div>}
        {active && step === 'review' && <div className="operations-evaluation"><h5>Evaluación humana · {handoff.ideaId}</h5><p>Revisa origen, provenance, prioridad, afinidad, confianza y evidencias antes de decidir.</p><div className="operations-actions"><button type="button" onClick={() => setStep('brief')}>Crear campaña</button><button type="button" onClick={() => setStep('reject')}>Rechazar propuesta</button><button type="button" onClick={close}>Cancelar</button></div></div>}
        {active && step === 'reject' && <form className="operations-evaluation" onSubmit={event => {
          event.preventDefault();
          if (!rejectConfirm) { setRejectConfirm(true); return; }
          if (onAction?.({ type: 'REJECT_PROPOSAL', ideaId: handoff.ideaId, reason })) close();
        }}><h5>Rechazar propuesta</h5><label>Motivo de rechazo de Luis<textarea required maxLength={1500} rows={4} value={reason} onChange={event => { setReason(event.target.value); setRejectConfirm(false); }} /></label>{rejectConfirm && <p className="campaign-confirm">Confirmar rechazo: no se creará una campaña.</p>}<div className="operations-actions"><button type="submit">{rejectConfirm ? 'Confirmar rechazo' : 'Revisar rechazo'}</button><button type="button" onClick={close}>Cancelar</button></div></form>}
        {active && step === 'brief' && <CampaignBriefForm handoff={handoff} onCreate={brief => {
          const ok = onAction?.({ type: 'CREATE_CAMPAIGN', ideaId: handoff.ideaId, brief }) ?? false;
          if (ok) close();
          return ok;
        }} onCancel={close} />}
      </article>;
    })}
    <p className="idea-scope-note">Las decisiones y campañas de esta fase viven solo durante esta sesión. No se envían a servicios externos.</p>
  </section>;
}
