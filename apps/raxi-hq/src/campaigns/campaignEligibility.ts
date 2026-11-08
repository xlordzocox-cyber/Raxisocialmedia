import { confirmedCampaignSnapshot, type CampaignReadContext } from '../persistence/campaignReadContext';
import type { RealCampaignState } from '../persistence/realCampaignStore';
import type { CampaignSnapshot } from '../persistence/campaignCommands';
import type { CampaignRecord } from './campaignContracts';
import { currentStrategy } from './campaignSession';
import type { StrategyDeliverable } from './strategyContracts';
import { validateStrategyRevision } from './strategyValidation';
import { compareCampaignTimestamps } from './campaignValidation';

export interface CampaignEligibility {
  eligible: boolean;
  reason: string;
  revision?: number;
  deliverables: { deliverable: StrategyDeliverable; eligible: boolean }[];
}

/** Editorial projection for a future request. It creates no execution capability. */
export function campaignEligibility(state: RealCampaignState, context: CampaignReadContext) {
  const snapshot = confirmedCampaignSnapshot(state, context);
  const results = new Map<string, CampaignEligibility>();
  if (!snapshot) return results;
  for (const campaign of snapshot.session.campaigns) {
    results.set(campaign.id, evaluateCampaign(snapshot, campaign));
  }
  return results;
}

function evaluateCampaign(snapshot: CampaignSnapshot, campaign: CampaignRecord): CampaignEligibility {
  const blocked = (reason: string): CampaignEligibility => ({ eligible: false, reason, deliverables: [] });
  const { session } = snapshot;
  if (campaign.provenance !== 'REAL' || session.campaigns.filter(item => item.id === campaign.id).length !== 1) {
    return blocked('La identidad o procedencia REAL de la campaña es inconsistente.');
  }
  if (campaign.status !== 'PLANNING') return blocked(`La campaña está en ${campaign.status}. Se requiere PLANNING.`);
  const history = session.strategies.filter(item => item.campaignId === campaign.id);
  if (history.some((item, index) => item.revision !== index + 1)) return blocked('El historial de revisiones es ambiguo.');
  const current = currentStrategy(session, campaign.id);
  if (!current) return blocked('La campaña aún no tiene una revisión Strategy.');
  if (current.status !== 'APPROVED') return blocked(`La revisión vigente ${current.revision} está en ${current.status}. Se requiere APPROVED.`);

  let revision;
  try {
    revision = validateStrategyRevision(current, campaign);
  } catch {
    return blocked('La revisión vigente o su matriz de entregables es inválida.');
  }
  const approvals = snapshot.receipts.filter(({ command }) => command.action.type === 'APPROVE_STRATEGY' &&
    command.action.campaignId === campaign.id && command.action.revision === revision.revision);
  const receipt = approvals[0]?.command;
  const events = Array.isArray(session.audit) ? session.audit.filter(event => event?.action === 'STRATEGY_APPROVED' &&
    event.campaignId === campaign.id && event.revision === revision.revision) : [];
  if (!revision.approvedAt || compareCampaignTimestamps(revision.approvedAt, snapshot.serverTime) > 0 ||
      approvals.length !== 1 || receipt?.workspaceId !== snapshot.workspaceId || receipt.expectedVersion >= snapshot.version ||
      receipt.action.type !== 'APPROVE_STRATEGY' || receipt.action.confirmed !== true ||
      events.length !== 1 || events[0].actor !== 'LUIS' || events[0].timestamp !== revision.approvedAt) {
    return blocked('La aprobación editorial de esta revisión carece de un recibo y una auditoría coherentes.');
  }

  // First increment follows the documented public-photo pilot scope.
  const deliverables = revision.deliverables.map(deliverable => ({
    deliverable,
    eligible: deliverable.channel === 'INSTAGRAM_FEED' &&
      deliverable.format === 'PHOTO' && deliverable.contentLevel === 'PUBLIC_SOCIAL',
  }));
  const eligible = deliverables.some(item => item.eligible);
  return {
    eligible,
    reason: eligible ? 'La revisión vigente tiene un entregable dentro del alcance inicial.'
      : 'El alcance inicial admite únicamente fotos públicas de Instagram Feed.',
    revision: revision.revision,
    deliverables,
  };
}
