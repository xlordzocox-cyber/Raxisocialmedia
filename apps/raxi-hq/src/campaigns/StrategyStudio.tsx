import { useEffect, useState } from 'react';
import type { CampaignRecord } from './campaignContracts';
import { currentStrategy, type CampaignCommand, type CampaignSession } from './campaignSession';
import type { CampaignStrategyRevision } from './strategyContracts';
import { strategyStatusLabel } from './strategyPresentation';
import { StrategyForm } from './StrategyForm';

type PendingAction = 'APPROVE' | 'CHANGES' | 'REVISION';
export interface PendingStrategyConfirmation { campaignId: string; revision: number; action: PendingAction }
export function confirmationForStrategy(pending: PendingStrategyConfirmation | undefined, campaignId: string, revision: number): PendingStrategyConfirmation | undefined {
  return pending?.campaignId === campaignId && pending.revision === revision ? pending : undefined;
}
export function StrategyStudio({ campaign, session, onAction }: {
  campaign: CampaignRecord; session: CampaignSession; onAction: (action: CampaignCommand) => boolean;
}) {
  const current = currentStrategy(session, campaign.id);
  const history = session.strategies.filter(item => item.campaignId === campaign.id);
  const [pending, setPending] = useState<PendingStrategyConfirmation>();
  const [reason, setReason] = useState('');
  useEffect(() => { setPending(undefined); setReason(''); }, [campaign.id, campaign.status, current?.revision]);
  const active = confirmationForStrategy(pending, campaign.id, current?.revision ?? 0);
  const writable = campaign.status === 'PLANNING';
  const propose = (action: PendingAction) => { setPending({ campaignId: campaign.id, revision: current?.revision ?? 0, action }); setReason(''); };
  const confirm = () => {
    if (!active || !current) return;
    let command: CampaignCommand;
    if (active.action === 'APPROVE') command = { type: 'APPROVE_STRATEGY', campaignId: active.campaignId, revision: active.revision, confirmed: true };
    else if (active.action === 'CHANGES') command = { type: 'REQUEST_STRATEGY_CHANGES', campaignId: active.campaignId, revision: active.revision, reason };
    else command = { type: 'START_STRATEGY_REVISION', campaignId: active.campaignId, revision: active.revision, confirmed: true, reason: reason || undefined };
    if (onAction(command)) { setPending(undefined); setReason(''); }
  };
  return <section className="strategy-studio" aria-label="Strategy Studio">
    <div className="strategy-heading"><div><span className="campus-eyebrow">STRATEGY STUDIO · LOCAL · SESIÓN</span><h5>Estrategia editorial</h5></div><strong>{current ? `${strategyStatusLabel[current.status]} · revisión ${current.revision}` : 'No iniciada'}</strong></div>
    <p>El Campaign Brief anterior permanece como referencia de solo lectura. Planning es el estado de la campaña; aprobar Strategy requiere una decisión humana distinta.</p>
    {!writable && <p role="status">Campaña {campaign.status}: estrategia en modo lectura. Reanuda planificación para actuar.</p>}
    {writable && (!current || current.status === 'DRAFT') && <StrategyForm key={`${campaign.id}-${current?.revision ?? 0}`} campaign={campaign} revision={current} onSave={input => onAction({ type: 'SAVE_STRATEGY', campaignId: campaign.id, input })} onSubmitReview={current?.status === 'DRAFT' ? input => onAction({ type: 'SUBMIT_STRATEGY_WITH_INPUT', campaignId: campaign.id, revision: current.revision, input }) : undefined} />}
    {writable && current?.status === 'IN_REVIEW' && <div className="strategy-actions"><button type="button" onClick={() => propose('CHANGES')}>Solicitar cambios</button><button type="button" onClick={() => propose('APPROVE')}>Aprobar estrategia</button></div>}
    {writable && (current?.status === 'CHANGES_REQUESTED' || current?.status === 'APPROVED') && <div className="strategy-actions"><button type="button" onClick={() => propose('REVISION')}>Iniciar nueva revisión</button></div>}
    {active && writable && <div className="strategy-confirm" role="group" aria-label="Confirmación de Strategy">
      <p>{active.action === 'APPROVE' ? 'Confirmar aprobación humana de esta revisión. Quedará como evidencia histórica.' : active.action === 'CHANGES' ? 'Explica qué debe cambiar antes de una nueva revisión.' : 'La nueva revisión será DRAFT y requerirá otra aprobación.'}</p>
      {(active.action === 'CHANGES' || active.action === 'REVISION') && <label>Motivo {active.action === 'CHANGES' || current?.status === 'APPROVED' ? 'obligatorio' : 'opcional'}<textarea maxLength={1500} value={reason} onChange={event => setReason(event.target.value)} /></label>}
      <div className="strategy-actions"><button type="button" disabled={(active.action === 'CHANGES' || current?.status === 'APPROVED') && !reason.trim()} onClick={confirm}>Confirmar</button><button type="button" onClick={() => { setPending(undefined); setReason(''); }}>Volver</button></div>
    </div>}
    {current && <div className="strategy-history"><h6>Historial de revisiones</h6>{history.map((revision: CampaignStrategyRevision) => <article key={revision.revision}><strong>Revisión {revision.revision} · {strategyStatusLabel[revision.status]}</strong><span>Autor: {revision.author} · creada {revision.createdAt} · actualizada {revision.updatedAt}</span>{revision.approvedAt && <span>Aprobada por {revision.approvedBy} · {revision.approvedAt}</span>}{revision.changeReason && <p className="idea-multiline">Motivo: {revision.changeReason}</p>}<details open={current.revision === revision.revision && current.status === 'IN_REVIEW'}><summary>Ver propuesta y matriz</summary><dl className="strategy-review-facts"><div><dt>Audiencia</dt><dd>{revision.audience}</dd></div><div><dt>Necesidad</dt><dd>{revision.audienceNeed}</dd></div><div><dt>Concepto</dt><dd>{revision.creativeConcept}</dd></div><div><dt>Narrativa</dt><dd>{revision.narrativeApproach}</dd></div><div><dt>Dirección visual</dt><dd>{revision.visualDirection}</dd></div><div><dt>Tono de voz</dt><dd>{revision.toneOfVoice}</dd></div><div><dt>Respuesta deseada</dt><dd>{revision.desiredAudienceResponse}</dd></div><div><dt>Criterios de éxito</dt><dd>{revision.successCriteria}</dd></div>{revision.notes && <div><dt>Notas</dt><dd>{revision.notes}</dd></div>}</dl><ul>{revision.deliverables.map(row => <li key={row.id}>{row.channel} · {row.contentLevel} · {row.format} × {row.quantity}: {row.purpose} — {row.creativeAngle}</li>)}</ul></details></article>)}</div>}
  </section>;
}
