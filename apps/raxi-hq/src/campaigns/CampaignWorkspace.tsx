import { useEffect, useRef, useState } from 'react';
import type { CampaignStatus } from './campaignContracts';
import type { CampaignCommand, CampaignSession } from './campaignSession';
import { currentStrategy } from './campaignSession';
import type { CampaignStrategyInput } from './strategyContracts';
import { campaignStatusLabel, contentLevelLabel } from './campaignPresentation';
import { ideaChannelLabel, ideaPriorityLabel, ideaProvenanceLabel } from '../ideas/ideaPresentation';
import { StrategyStudio } from './StrategyStudio';
import { AriaProductionPanel } from '../production/AriaProductionPanel';
import { applyAriaPilotFailure, applyAriaPilotReceipt, isAriaPilotOrderCurrentInSession, reconcileAriaPilotOrder, requireCurrentAriaPilotOrder, type AriaPilotOrder, type AriaPilotOutcome } from '../production/ariaPilot';

const futureStages = ['Assets', 'Copy', 'QA', 'Planner', 'Publishing', 'Analytics'];
export interface PendingCampaignTransition { campaignId: string; to: CampaignStatus }
/** A confirmation belongs only to the campaign that initiated it. */
export function pendingTransitionForSelection(pending: PendingCampaignTransition | undefined, selectedId: string | undefined): PendingCampaignTransition | undefined {
  return pending?.campaignId === selectedId ? pending : undefined;
}
export function strategyDraftKey(campaignId: string, revision: number): string { return `${campaignId}:${revision}`; }
export function withoutStrategyDraft(drafts: Readonly<Record<string, CampaignStrategyInput>>, key: string): Record<string, CampaignStrategyInput> {
  const next = { ...drafts };
  delete next[key];
  return next;
}
export function CampaignWorkspace({ id, session, getSession, open, selectedId, getSelectedId, onSelect, onAction }: {
  id: string; session: CampaignSession; getSession: () => CampaignSession; open: boolean; selectedId?: string;
  getSelectedId: () => string | undefined;
  onSelect: (id: string) => void; onAction: (action: CampaignCommand) => boolean;
}) {
  const [pendingTransition, setPendingTransition] = useState<PendingCampaignTransition>();
  // Form edits live only in this mounted workspace, separate from canonical revisions and audit.
  const [strategyDrafts, setStrategyDrafts] = useState<Record<string, CampaignStrategyInput>>({});
  const [formReset, setFormReset] = useState(0);
  const [pilotOrder, setPilotOrder] = useState<AriaPilotOrder>();
  const pilotOrderRef = useRef<AriaPilotOrder | undefined>(undefined);
  const [pilotOutcome, setPilotOutcome] = useState<AriaPilotOutcome>({});
  const pilotOutcomeRef = useRef(pilotOutcome);
  const pilotOrderIsCurrent = (value: AriaPilotOrder) => pilotOrderRef.current === value &&
    isAriaPilotOrderCurrentInSession(value, getSession(), getSelectedId());
  const updatePilotOutcome = (change: (current: AriaPilotOutcome) => AriaPilotOutcome) => {
    const next = change(pilotOutcomeRef.current);
    pilotOutcomeRef.current = next;
    setPilotOutcome(next);
  };
  useEffect(() => { setPendingTransition(undefined); }, [selectedId]);
  const selected = session.campaigns.find(item => item.id === selectedId) ?? session.campaigns[0];
  const activeTransition = pendingTransitionForSelection(pendingTransition, selectedId ?? selected?.id);
  const selectedDraftKey = selected && strategyDraftKey(selected.id, currentStrategy(session, selected.id)?.revision ?? 1);
  const selectedDraft = selectedDraftKey ? strategyDrafts[selectedDraftKey] : undefined;
  const transitionDraft = activeTransition && (activeTransition.to === 'BLOCKED' || activeTransition.to === 'CANCELED') &&
    strategyDrafts[strategyDraftKey(activeTransition.campaignId, currentStrategy(session, activeTransition.campaignId)?.revision ?? 1)];
  const counts = { DRAFT: 0, PLANNING: 0, BLOCKED: 0, CANCELED: 0 };
  for (const item of session.campaigns) counts[item.status]++;
  const options: Record<CampaignStatus, CampaignStatus[]> = { DRAFT: ['PLANNING', 'CANCELED'], PLANNING: ['BLOCKED', 'CANCELED'], BLOCKED: ['PLANNING', 'CANCELED'], CANCELED: [] };
  return <section id={id} className="campaign-workspace" aria-label="Campaign Workspace" hidden={!open}>
    <div className="campaign-workspace-heading"><div><span className="campus-eyebrow">CENTRO DE OPERACIONES · WRITE_INTERNAL</span><h3>Campaign Workspace</h3><p>Campaign Brief y decisiones internas de Luis.</p></div><strong>{session.campaigns.length} Campaigns</strong></div>
    <p className="campaign-session-warning">LOCAL · SESIÓN · Las campañas creadas en esta fase viven solo durante esta sesión.</p>
    <div className="campaign-metrics">{(['DRAFT', 'PLANNING', 'BLOCKED', 'CANCELED'] as const).map(status => <div key={status}><strong>{counts[status]}</strong><span>{campaignStatusLabel[status]}</span></div>)}</div>
    <div className="campaign-workspace-body"><div className="campaign-list" aria-label="Campañas de esta sesión">{session.campaigns.length === 0 ? <p>Aún no hay campañas. Evalúa una propuesta en la bandeja.</p> : session.campaigns.map(item => <button type="button" key={item.id} aria-pressed={selected?.id === item.id} onClick={() => { onSelect(item.id); setPendingTransition(undefined); }}><code>{item.id}</code><strong>{item.title}</strong><span>{campaignStatusLabel[item.status]} · {ideaProvenanceLabel[item.provenance]}</span></button>)}</div>
      {selected && <article className="campaign-detail"><div className="operations-proposal-top"><code>{selected.id}</code><span className="operations-provenance" data-provenance={selected.provenance}>{ideaProvenanceLabel[selected.provenance]}</span></div><h4>{selected.title}</h4><p className="campaign-status">{campaignStatusLabel[selected.status]}</p>
        <dl><div><dt>Objetivo</dt><dd className="idea-multiline">{selected.objective}</dd></div><div><dt>Origen Idea ID</dt><dd>{selected.sourceIdeaId}</dd></div><div><dt>Handoff recibido</dt><dd>{selected.sourceHandoffSentAt}</dd></div><div><dt>Provenance</dt><dd>{ideaProvenanceLabel[selected.provenance]}</dd></div><div><dt>Prioridad</dt><dd>{ideaPriorityLabel[selected.priority]}</dd></div><div><dt>Canales</dt><dd>{selected.channels.map(channel => ideaChannelLabel[channel]).join(', ')}</dd></div><div><dt>Niveles de contenido</dt><dd>{selected.contentLevels.map(level => contentLevelLabel[level]).join(', ')}</dd></div><div><dt>Mensaje clave</dt><dd className="idea-multiline">{selected.keyMessage}</dd></div><div><dt>CTA</dt><dd className="idea-multiline">{selected.cta ?? '—'}</dd></div><div><dt>Notas</dt><dd className="idea-multiline">{selected.notes ?? '—'}</dd></div><div><dt>Creada</dt><dd>{selected.createdAt}</dd></div><div><dt>Actualizada</dt><dd>{selected.updatedAt}</dd></div></dl>
        <div className="campaign-stage-map"><h5>Etapas del workspace</h5><span className="campaign-stage-available">Brief · Disponible</span><span className="campaign-stage-available">Strategy · Disponible</span>{futureStages.map(stage => <span key={stage} aria-disabled="true">{stage} · PRÓXIMAMENTE</span>)}</div>
        {options[selected.status].length > 0 && <div className="campaign-status-actions"><h5>Estado interno</h5>{options[selected.status].map(next => <button key={next} type="button" onClick={() => setPendingTransition({ campaignId: selected.id, to: next })}>{next === 'PLANNING' && selected.status === 'BLOCKED' ? 'Reanudar planificación' : next === 'PLANNING' ? 'Iniciar planificación' : next === 'BLOCKED' ? 'Bloquear' : 'Cancelar campaña'}</button>)}
          {activeTransition && <div className="campaign-confirm"><p>Confirmar cambio de {activeTransition.campaignId} a {campaignStatusLabel[activeTransition.to]}.</p>{transitionDraft && <p role="alert">CAMBIOS SIN GUARDAR · LOCAL · SESIÓN. {activeTransition.to === 'CANCELED' ? 'La cancelación es terminal: la edición dejará de estar disponible y el borrador solo permanecerá en esta sesión.' : 'El borrador se conservará y volverá a estar disponible al reanudar planificación.'}</p>}<button type="button" onClick={() => { if (onAction({ type: 'TRANSITION_CAMPAIGN', campaignId: activeTransition.campaignId, to: activeTransition.to })) setPendingTransition(undefined); }}>{transitionDraft ? activeTransition.to === 'CANCELED' ? 'Confirmar cancelación con cambios sin guardar' : 'Confirmar bloqueo con cambios sin guardar' : 'Confirmar estado'}</button><button type="button" onClick={() => setPendingTransition(undefined)}>Volver</button></div>}</div>}
      </article>}
    </div>
    {selected && <StrategyStudio key={selected.id} campaign={selected} session={session} onAction={onAction}
      draft={selectedDraft} formReset={formReset}
      onDraftChange={input => { if (selectedDraftKey) setStrategyDrafts(current => ({ ...current, [selectedDraftKey]: input })); }}
      onClearDraft={() => { if (selectedDraftKey) setStrategyDrafts(current => withoutStrategyDraft(current, selectedDraftKey)); }}
      onDiscardDraft={() => { if (selectedDraftKey) setStrategyDrafts(current => withoutStrategyDraft(current, selectedDraftKey)); setFormReset(current => current + 1); }} />}
    {selected && <AriaProductionPanel key={`production-${selected.id}`} campaign={selected}
      strategy={currentStrategy(session, selected.id)} order={pilotOrder?.campaign.id === selected.id ? pilotOrder : undefined}
      receipt={pilotOutcome.receipt?.jobId === pilotOrder?.jobId && pilotOrder?.campaign.id === selected.id ? pilotOutcome.receipt : undefined}
      failure={pilotOutcome.failure?.jobId === pilotOrder?.jobId && pilotOrder?.campaign.id === selected.id ? pilotOutcome.failure : undefined}
      review={pilotOutcome.review?.jobId === pilotOrder?.jobId && pilotOrder?.campaign.id === selected.id ? pilotOutcome.review : undefined}
      isOrderCurrent={pilotOrderIsCurrent}
      onOrder={value => { const next = reconcileAriaPilotOrder(pilotOrderRef.current, value); pilotOrderRef.current = next; setPilotOrder(next); }}
      onReceipt={(value, expected) => updatePilotOutcome(current => {
        requireCurrentAriaPilotOrder(expected, pilotOrderRef.current, getSession(), getSelectedId());
        return applyAriaPilotReceipt(current, value, expected);
      })}
      onFailure={(value, expected) => updatePilotOutcome(current => {
        requireCurrentAriaPilotOrder(expected, pilotOrderRef.current, getSession(), getSelectedId());
        return applyAriaPilotFailure(current, value, expected);
      })}
      onReview={(value, expected) => updatePilotOutcome(current => {
        requireCurrentAriaPilotOrder(expected, pilotOrderRef.current, getSession(), getSelectedId());
        if (!value && current.review && current.review.humanDecision !== 'PENDING') throw new Error('La decisión humana ya está registrada.');
        return { ...current, review: value };
      })} />}
  </section>;
}
