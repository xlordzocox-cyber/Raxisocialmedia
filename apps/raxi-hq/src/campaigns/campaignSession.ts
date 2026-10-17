import type { OperationsInboxItem, Clock } from '../ideas/ideaCenterSession';
import { validateIdeaTimestamp } from '../ideas/ideaValidation';
import { validateMultilineText } from '../ideas/manualIdeaDraft';
import type { CampaignBriefInput, CampaignDecision, CampaignRecord, CampaignStatus } from './campaignContracts';
import { compareCampaignTimestamps, MAX_CAMPAIGNS, transitionCampaign, validateCampaignBrief, validateCampaignCollection, validateCampaignDecision, validateCampaignRecord } from './campaignValidation';

export type CampaignAuditAction = 'PROPOSAL_ACCEPTED' | 'PROPOSAL_REJECTED' | 'CAMPAIGN_CREATED' | 'CAMPAIGN_PLANNING_STARTED' | 'CAMPAIGN_BLOCKED' | 'CAMPAIGN_UNBLOCKED' | 'CAMPAIGN_CANCELED';
export interface CampaignAuditEvent { id: string; timestamp: string; action: CampaignAuditAction; ideaId?: string; campaignId?: string; actor: 'LUIS' }
export interface CampaignSession { campaigns: CampaignRecord[]; decisions: CampaignDecision[]; audit: CampaignAuditEvent[]; nextCampaignNumber: number }
export type CampaignAction =
  | { type: 'CREATE_CAMPAIGN'; ideaId: string; brief: CampaignBriefInput; at: string }
  | { type: 'REJECT_PROPOSAL'; ideaId: string; reason: string; at: string }
  | { type: 'TRANSITION_CAMPAIGN'; campaignId: string; to: CampaignStatus; at: string };
export type CampaignCommand = CampaignAction extends infer A ? A extends CampaignAction ? Omit<A, 'at'> : never : never;

export function createCampaignSession(): CampaignSession { return { campaigns: [], decisions: [], audit: [], nextCampaignNumber: 1 }; }
export function campaignDecision(state: CampaignSession, ideaId: string): CampaignDecision {
  return state.decisions.find(item => item.ideaId === ideaId) ?? { ideaId, status: 'PENDING' };
}
function appendAudit(state: CampaignSession, at: string, actions: readonly { action: CampaignAuditAction; ideaId?: string; campaignId?: string }[]): CampaignSession {
  if (state.audit.length + actions.length > 1000) throw new Error('Límite del registro de sesión alcanzado.');
  const events: CampaignAuditEvent[] = actions.map((item, index) => ({ id: `AUDIT-CAMPAIGN-${String(state.audit.length + index + 1).padStart(4, '0')}`,
    timestamp: at, actor: 'LUIS', ...item }));
  return { ...state, audit: [...state.audit, ...events] };
}
function handoffFor(handoffs: readonly OperationsInboxItem[], ideaId: string): OperationsInboxItem {
  const matches = handoffs.filter(item => item.handoff.ideaId === ideaId);
  if (matches.length !== 1) throw new Error('Propuesta no disponible en la bandeja.');
  return matches[0];
}
function nextId(state: CampaignSession): { id: string; next: number } {
  const used = new Set(state.campaigns.map(item => item.id));
  let number = state.nextCampaignNumber;
  while (used.has(`CAMPAIGN-${String(number).padStart(3, '0')}`)) number++;
  if (number > MAX_CAMPAIGNS) throw new Error('Límite de campañas alcanzado.');
  return { id: `CAMPAIGN-${String(number).padStart(3, '0')}`, next: number + 1 };
}
/** Pure, all-or-nothing session boundary. Handoffs remain untouched. */
export function reduceCampaignSession(state: CampaignSession, handoffs: readonly OperationsInboxItem[], action: CampaignAction): CampaignSession {
  const at = validateIdeaTimestamp(action.at);
  if (action.type === 'TRANSITION_CAMPAIGN') {
    const campaign = state.campaigns.find(item => item.id === action.campaignId);
    if (!campaign) throw new Error('Campaña inexistente.');
    const updated = transitionCampaign(campaign, action.to, at);
    const auditAction: Record<'PLANNING' | 'BLOCKED' | 'CANCELED', CampaignAuditAction> = {
      PLANNING: campaign.status === 'BLOCKED' ? 'CAMPAIGN_UNBLOCKED' : 'CAMPAIGN_PLANNING_STARTED',
      BLOCKED: 'CAMPAIGN_BLOCKED', CANCELED: 'CAMPAIGN_CANCELED',
    };
    const next = { ...state, campaigns: state.campaigns.map(item => item.id === campaign.id ? updated : item) };
    return appendAudit(next, at, [{ action: auditAction[action.to as keyof typeof auditAction], campaignId: campaign.id, ideaId: campaign.sourceIdeaId }]);
  }
  const item = handoffFor(handoffs, action.ideaId);
  const decision = campaignDecision(state, action.ideaId);
  if (decision.status !== 'PENDING' || state.campaigns.some(campaign => campaign.sourceIdeaId === action.ideaId)) throw new Error('Esta propuesta ya fue decidida.');
  if (compareCampaignTimestamps(item.handoff.sentAt, at) > 0) throw new Error('La decisión no puede preceder al handoff.');
  if (action.type === 'REJECT_PROPOSAL') {
    const reason = validateMultilineText(action.reason, 1500, 'Motivo de rechazo');
    const rejected = validateCampaignDecision({ ideaId: action.ideaId, status: 'REJECTED', decidedAt: at, reason });
    return appendAudit({ ...state, decisions: [...state.decisions, rejected] }, at, [{ action: 'PROPOSAL_REJECTED', ideaId: action.ideaId }]);
  }
  if (action.type !== 'CREATE_CAMPAIGN') throw new Error('Acción de campaña inválida.');
  if (state.campaigns.length >= MAX_CAMPAIGNS) throw new Error('Límite de campañas alcanzado.');
  const brief = validateCampaignBrief(action.brief);
  const generated = nextId(state);
  const campaign = validateCampaignRecord({ ...brief, id: generated.id, sourceIdeaId: action.ideaId,
    sourceHandoffSentAt: item.handoff.sentAt, provenance: item.provenance, status: 'DRAFT', createdAt: at, updatedAt: at });
  const accepted = validateCampaignDecision({ ideaId: action.ideaId, status: 'ACCEPTED', decidedAt: at, campaignId: campaign.id });
  // Validate the complete projection before publishing any part of it.
  const campaigns = validateCampaignCollection([...state.campaigns, campaign]);
  if (state.decisions.some(item => item.ideaId === accepted.ideaId)) throw new Error('Decisión duplicada.');
  const next = { ...state, campaigns, decisions: [...state.decisions, accepted], nextCampaignNumber: generated.next };
  return appendAudit(next, at, [{ action: 'PROPOSAL_ACCEPTED', ideaId: action.ideaId, campaignId: campaign.id },
    { action: 'CAMPAIGN_CREATED', ideaId: action.ideaId, campaignId: campaign.id }]);
}
export function dispatchCampaignAction(state: CampaignSession, handoffs: readonly OperationsInboxItem[], clock: Clock, command: CampaignCommand): CampaignSession {
  return reduceCampaignSession(state, handoffs, { ...command, at: validateIdeaTimestamp(clock()) } as CampaignAction);
}
