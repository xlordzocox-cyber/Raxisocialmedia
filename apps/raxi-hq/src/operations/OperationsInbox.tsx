import { useState } from 'react';
import type { OperationsInboxItem } from '../ideas/ideaCenterSession';
import { ideaChannelLabel, ideaPriorityLabel, ideaProvenanceLabel, ideaSourceLabel } from '../ideas/ideaPresentation';
import type { CampaignCommand, CampaignSession } from '../campaigns/campaignSession';
import { campaignDecision } from '../campaigns/campaignSession';
import { CampaignBriefForm } from '../campaigns/CampaignBriefForm';

export interface ProposalEvaluationState {
  ideaId?: string;
  step: 'review' | 'reject' | 'brief';
  reason: string;
  rejectConfirm: boolean;
}
export function startProposalEvaluation(ideaId: string): ProposalEvaluationState {
  return { ideaId, step: 'review', reason: '', rejectConfirm: false };
}
export function clearProposalEvaluation(): ProposalEvaluationState { return { ideaId: undefined, step: 'review', reason: '', rejectConfirm: false }; }

export function OperationsInbox({ id, handoffs, open, campaigns, onAction, onOpenCampaign, real = false }: {
  id: string; handoffs: readonly OperationsInboxItem[]; open: boolean; campaigns?: CampaignSession;
  onAction?: (action: CampaignCommand) => boolean | Promise<boolean>; onOpenCampaign?: (id: string) => void; real?: boolean;
}) {
  const [evaluation, setEvaluation] = useState<ProposalEvaluationState>(clearProposalEvaluation);
  const close = () => setEvaluation(clearProposalEvaluation());
  const startEvaluation = (ideaId: string) => setEvaluation(startProposalEvaluation(ideaId));
  return <section id={id} className="operations-inbox" role="region" aria-label="Bandeja de propuestas recibidas" hidden={!open}>
    <div className="operations-inbox-heading"><span className="campus-eyebrow">CENTRO DE OPERACIONES</span><h3>Bandeja de propuestas recibidas</h3><p>{real ? 'Handoffs persistidos. La conversión conserva la idea y requiere una decisión humana.' : 'Handoffs internos de esta sesión. Luis decide si una propuesta merece una campaña.'}</p></div>
    {handoffs.length === 0 ? <p className="operations-empty">Aún no hay propuestas recibidas.</p> : handoffs.map(({ handoff, provenance }) => {
      const decision = campaigns ? campaignDecision(campaigns, handoff.ideaId) : { status: 'PENDING' as const, campaignId: undefined, reason: undefined };
      const active = evaluation.ideaId === handoff.ideaId && decision.status === 'PENDING';
      return <article key={handoff.ideaId} className="operations-proposal">
        <div className="operations-proposal-top"><code>{handoff.ideaId}</code><span>PROPUESTA RECIBIDA</span><span className="operations-provenance" data-provenance={provenance}>{ideaProvenanceLabel[provenance]}</span></div>
        <h4>{handoff.title}</h4><p className="idea-multiline">{handoff.summary}</p><p className="idea-multiline"><strong>Motivo:</strong> {handoff.reason}</p>
        <dl><div><dt>Origen</dt><dd>{ideaSourceLabel[handoff.source]}</dd></div><div><dt>Prioridad</dt><dd>{ideaPriorityLabel[handoff.priority]}</dd></div><div><dt>Canales sugeridos</dt><dd>{handoff.suggestedChannels.map(channel => ideaChannelLabel[channel]).join(', ') || 'Sin canales'}</dd></div><div><dt>Afinidad / confianza</dt><dd>{real ? 'Pendiente de evaluación' : `${handoff.fitScore}% / ${handoff.confidenceScore}%`}</dd></div><div><dt>Recibida</dt><dd>{handoff.sentAt}</dd></div><div><dt>Referencias de evidencia</dt><dd>{handoff.evidenceRefs.join(', ') || 'Sin referencias'}</dd></div></dl>
        {decision.status === 'PENDING' ? <><span className="operations-pending">PENDIENTE DE DECISIÓN DEL HQ</span>{onAction && <div className="operations-actions"><button type="button" onClick={() => startEvaluation(handoff.ideaId)}>Evaluar propuesta</button></div>}</> :
          decision.status === 'ACCEPTED' ? <div className="operations-decision"><strong>CONVERTIDA EN CAMPAÑA</strong><code>{decision.campaignId}</code><button type="button" onClick={() => decision.campaignId && onOpenCampaign?.(decision.campaignId)}>Abrir campaña</button></div> :
            <div className="operations-decision"><strong>NO CONVERTIDA EN CAMPAÑA</strong><p className="idea-multiline">{decision.reason}</p></div>}
        {active && evaluation.step === 'review' && <div className="operations-evaluation"><h5>Evaluación humana · {handoff.ideaId}</h5><p>Revisa origen, provenance, prioridad, afinidad, confianza y evidencias antes de decidir.</p><div className="operations-actions"><button type="button" onClick={() => setEvaluation(current => ({ ...current, step: 'brief' }))}>Crear campaña</button><button type="button" onClick={() => setEvaluation(current => ({ ...current, step: 'reject' }))}>Rechazar propuesta</button><button type="button" onClick={close}>Cancelar</button></div></div>}
        {active && evaluation.step === 'reject' && <form className="operations-evaluation" onSubmit={async event => {
          event.preventDefault();
          if (!evaluation.rejectConfirm) { setEvaluation(current => ({ ...current, rejectConfirm: true })); return; }
          if (await onAction?.({ type: 'REJECT_PROPOSAL', ideaId: handoff.ideaId, reason: evaluation.reason })) close();
        }}><h5>Rechazar propuesta</h5><label>Motivo de rechazo de Luis<textarea required maxLength={1500} rows={4} value={evaluation.reason} onChange={event => setEvaluation(current => ({ ...current, reason: event.target.value, rejectConfirm: false }))} /></label>{evaluation.rejectConfirm && <p className="campaign-confirm">Confirmar rechazo: no se creará una campaña.</p>}<div className="operations-actions"><button type="submit">{evaluation.rejectConfirm ? 'Confirmar rechazo' : 'Revisar rechazo'}</button><button type="button" onClick={close}>Cancelar</button></div></form>}
        {active && evaluation.step === 'brief' && <CampaignBriefForm real={real} handoff={handoff} onCreate={async brief => {
          const ok = await onAction?.({ type: 'CREATE_CAMPAIGN', ideaId: handoff.ideaId, brief }) ?? false;
          if (ok) close();
          return ok;
        }} onCancel={close} />}
      </article>;
    })}
    <p className="idea-scope-note">{real ? 'Las decisiones se confirman mediante el servicio autenticado y quedan auditadas en Supabase.' : 'Las decisiones y campañas de esta fase viven solo durante esta sesión. No se envían a servicios externos.'}</p>
  </section>;
}
