import { useEffect, useState } from 'react';
import type { CampaignStatus } from './campaignContracts';
import type { CampaignCommand, CampaignSession } from './campaignSession';
import { campaignStatusLabel, contentLevelLabel } from './campaignPresentation';
import { ideaChannelLabel, ideaPriorityLabel, ideaProvenanceLabel } from '../ideas/ideaPresentation';

const futureStages = ['Strategy', 'Assets', 'Copy', 'QA', 'Planner', 'Publishing', 'Analytics'];
export interface PendingCampaignTransition { campaignId: string; to: CampaignStatus }
/** A confirmation belongs only to the campaign that initiated it. */
export function pendingTransitionForSelection(pending: PendingCampaignTransition | undefined, selectedId: string | undefined): PendingCampaignTransition | undefined {
  return pending?.campaignId === selectedId ? pending : undefined;
}
export function CampaignWorkspace({ id, session, open, selectedId, onSelect, onAction }: {
  id: string; session: CampaignSession; open: boolean; selectedId?: string;
  onSelect: (id: string) => void; onAction: (action: CampaignCommand) => boolean;
}) {
  const [pendingTransition, setPendingTransition] = useState<PendingCampaignTransition>();
  useEffect(() => { setPendingTransition(undefined); }, [selectedId]);
  const selected = session.campaigns.find(item => item.id === selectedId) ?? session.campaigns[0];
  const activeTransition = pendingTransitionForSelection(pendingTransition, selectedId ?? selected?.id);
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
        <div className="campaign-stage-map"><h5>Etapas del workspace</h5><span className="campaign-stage-available">Brief · Disponible</span>{futureStages.map(stage => <span key={stage} aria-disabled="true">{stage} · PRÓXIMAMENTE</span>)}</div>
        {options[selected.status].length > 0 && <div className="campaign-status-actions"><h5>Estado interno</h5>{options[selected.status].map(next => <button key={next} type="button" onClick={() => setPendingTransition({ campaignId: selected.id, to: next })}>{next === 'PLANNING' && selected.status === 'BLOCKED' ? 'Reanudar planificación' : next === 'PLANNING' ? 'Iniciar planificación' : next === 'BLOCKED' ? 'Bloquear' : 'Cancelar campaña'}</button>)}
          {activeTransition && <div className="campaign-confirm"><p>Confirmar cambio a {campaignStatusLabel[activeTransition.to]}.</p><button type="button" onClick={() => { if (onAction({ type: 'TRANSITION_CAMPAIGN', campaignId: activeTransition.campaignId, to: activeTransition.to })) setPendingTransition(undefined); }}>Confirmar estado</button><button type="button" onClick={() => setPendingTransition(undefined)}>Volver</button></div>}</div>}
      </article>}
    </div>
  </section>;
}
