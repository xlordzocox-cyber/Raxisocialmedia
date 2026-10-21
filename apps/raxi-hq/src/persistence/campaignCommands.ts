import type { IdeaRecord } from '../ideas/ideaContracts';
import type { OperationsInboxItem } from '../ideas/ideaCenterSession';
import { createIdeaHandoff, transitionIdea, validateIdeaCollection, validateIdeaTimestamp } from '../ideas/ideaValidation';
import { createCampaignSession, reduceCampaignSession, type CampaignCommand, type CampaignSession } from '../campaigns/campaignSession';
import { validateCampaignCollection, validateCampaignDecision } from '../campaigns/campaignValidation';
import { validateStrategyRevision } from '../campaigns/strategyValidation';

export type IdeaCampaignCommand = { [T in 'REVIEW_IDEA' | 'APPROVE_IDEA' | 'HANDOFF_IDEA']: { type: T; ideaId: string; expectedUpdatedAt: string; confirmed: boolean } }['REVIEW_IDEA' | 'APPROVE_IDEA' | 'HANDOFF_IDEA'];
export type RealCampaignAction = CampaignCommand | IdeaCampaignCommand;
export interface CampaignOperation { workspaceId: string; operationId: string; expectedVersion: number; action: RealCampaignAction }
export interface CampaignSnapshot {
  workspaceId: string; ownerId: string; version: number; serverTime: string;
  ideas: IdeaRecord[]; handoffs: OperationsInboxItem[]; session: CampaignSession;
  receipts: { operationId: string; command: CampaignOperation }[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields: Record<RealCampaignAction['type'], string[]> = {
  REVIEW_IDEA: ['ideaId', 'expectedUpdatedAt', 'confirmed'], APPROVE_IDEA: ['ideaId', 'expectedUpdatedAt', 'confirmed'], HANDOFF_IDEA: ['ideaId', 'expectedUpdatedAt', 'confirmed'],
  CREATE_CAMPAIGN: ['ideaId', 'brief'], REJECT_PROPOSAL: ['ideaId', 'reason'], TRANSITION_CAMPAIGN: ['campaignId', 'to'],
  SAVE_STRATEGY: ['campaignId', 'input'], SUBMIT_STRATEGY: ['campaignId', 'revision'], SUBMIT_STRATEGY_WITH_INPUT: ['campaignId', 'revision', 'input'],
  REQUEST_STRATEGY_CHANGES: ['campaignId', 'revision', 'reason'], APPROVE_STRATEGY: ['campaignId', 'revision', 'confirmed'], START_STRATEGY_REVISION: ['campaignId', 'revision', 'confirmed', 'reason'],
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Objeto inválido.');
  return value as Record<string, unknown>;
}
export function sameValue(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, stable(v)])) : value;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
export function validateCampaignOperation(raw: unknown): CampaignOperation {
  const value = object(raw), action = object(value.action);
  if (Object.keys(value).some(k => !['workspaceId', 'operationId', 'expectedVersion', 'action'].includes(k)) ||
    !uuid.test(String(value.workspaceId)) || !uuid.test(String(value.operationId)) ||
    !Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 0 ||
    typeof action.type !== 'string' || !Object.hasOwn(fields, action.type) ||
    Object.keys(action).some(k => k !== 'type' && !fields[action.type as RealCampaignAction['type']].includes(k))) throw new Error('Comando no permitido.');
  return JSON.parse(JSON.stringify(value)) as CampaignOperation;
}
export function parseCampaignSnapshot(raw: unknown, owner: string, workspace: string): CampaignSnapshot {
  const value = object(raw) as unknown as CampaignSnapshot;
  if (value.ownerId !== owner || value.workspaceId !== workspace || !Number.isSafeInteger(value.version) || value.version < 0) throw new Error('Workspace o versión incompatible.');
  validateIdeaTimestamp(value.serverTime);
  const ideas = validateIdeaCollection(value.ideas);
  if (ideas.some(i => !i.id.startsWith('IDEA-REAL-') || i.source !== 'MANUAL_LUIS')) throw new Error('No se importan ideas DEMO.');
  const campaigns = validateCampaignCollection(value.session.campaigns);
  if (campaigns.some(c => c.provenance !== 'REAL' || !ideas.some(i => i.id === c.sourceIdeaId))) throw new Error('Procedencia de campaña inválida.');
  for (const s of value.session.strategies) { const c = campaigns.find(c => c.id === s.campaignId); if (!c) throw new Error('Strategy huérfana.'); validateStrategyRevision(s, c); }
  for (const d of value.session.decisions) validateCampaignDecision(d);
  if (!Array.isArray(value.receipts) || value.receipts.length > 1000 || new Set(value.receipts.map(r => r.operationId)).size !== value.receipts.length) throw new Error('Recibos inválidos.');
  for (const r of value.receipts) { const c = validateCampaignOperation(r.command); if (r.operationId !== c.operationId || c.workspaceId !== workspace) throw new Error('Recibo ajeno.'); }
  const handoffs: OperationsInboxItem[] = ideas.filter(i => i.status === 'SENT_TO_HQ').map(i => ({ handoff: createIdeaHandoff(i), provenance: 'REAL' }));
  if (!sameValue(handoffs, value.handoffs)) throw new Error('Handoff no canónico.');
  return { ...value, ideas, handoffs, session: { ...value.session, campaigns } };
}
export function emptyCampaignSnapshot(ownerId: string, workspaceId: string, ideas: IdeaRecord[] = []): CampaignSnapshot {
  return { ownerId, workspaceId, version: 0, serverTime: new Date().toISOString(), ideas, handoffs: [], session: createCampaignSession(), receipts: [] };
}
/** Executed on the server, never accepted as a client-supplied projection. */
export function applyCampaignOperation(snapshot: CampaignSnapshot, raw: unknown): CampaignSnapshot {
  const command = validateCampaignOperation(raw);
  if (command.workspaceId !== snapshot.workspaceId) throw new Error('Workspace ajeno.');
  const replay = snapshot.receipts.find(r => r.operationId === command.operationId);
  if (replay) { if (!sameValue(replay.command, command)) throw new Error('Conflicto de idempotencia.'); return snapshot; }
  if (snapshot.receipts.length >= 1000) throw new Error('Límite operativo de este incremento alcanzado.');
  if (command.expectedVersion !== snapshot.version) throw new Error('Versión obsoleta. Recarga antes de decidir.');
  const action = command.action, at = validateIdeaTimestamp(snapshot.serverTime);
  let ideas = snapshot.ideas, handoffs = snapshot.handoffs, session = snapshot.session;
  if (action.type === 'REVIEW_IDEA' || action.type === 'APPROVE_IDEA' || action.type === 'HANDOFF_IDEA') {
    const current = ideas.find(i => i.id === action.ideaId);
    if (!current || current.updatedAt !== action.expectedUpdatedAt || action.confirmed !== true) throw new Error('Confirmación o versión de idea inválida.');
    const status = action.type === 'REVIEW_IDEA' ? 'UNDER_REVIEW' : action.type === 'APPROVE_IDEA' ? 'APPROVED_FOR_HQ' : 'SENT_TO_HQ';
    const next = transitionIdea(current, status, at);
    ideas = ideas.map(i => i.id === next.id ? next : i);
    if (status === 'SENT_TO_HQ') handoffs = [...handoffs, { handoff: createIdeaHandoff(next), provenance: 'REAL' }];
  } else session = reduceCampaignSession(session, handoffs, { ...action, at });
  return { ...snapshot, version: snapshot.version + 1, ideas, handoffs, session, receipts: [...snapshot.receipts, { operationId: command.operationId, command }] };
}
