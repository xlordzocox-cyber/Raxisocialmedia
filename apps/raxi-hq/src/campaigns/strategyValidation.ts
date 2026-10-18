import { IDEA_CHANNELS, type IdeaChannel } from '../ideas/ideaContracts';
import { validateIdeaTimestamp } from '../ideas/ideaValidation';
import { validateMultilineText } from '../ideas/manualIdeaDraft';
import { CAMPAIGN_CONTENT_LEVELS, type CampaignContentLevel, type CampaignRecord } from './campaignContracts';
import { compareCampaignTimestamps } from './campaignValidation';
import { STRATEGY_FORMATS, STRATEGY_STATUSES, type CampaignStrategyInput, type CampaignStrategyRevision, type StrategyDeliverable, type StrategyFormat, type StrategyStatus } from './strategyContracts';

export const MAX_STRATEGY_REVISIONS = 10;
export const MAX_STRATEGY_ROWS = 12;
export const MAX_STRATEGY_DELIVERABLES = 30;
const MAX_STRATEGY_TEXT = 1500;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Estrategia inválida.');
  return value as Record<string, unknown>;
}
function own(value: Record<string, unknown>, key: string): unknown { return Object.hasOwn(value, key) ? value[key] : undefined; }
function bounded(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw new Error('Matriz inválida.');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('Matriz inválida.');
  if (length > maximum) throw new Error('Límite de filas de estrategia excedido.');
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    if (value.length !== length) throw new Error('Matriz mutable.');
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Matriz dispersa o mutable.');
    result.push(descriptor.value);
  }
  if (value.length !== length) throw new Error('Matriz mutable.');
  return result;
}
function member<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} inválido.`);
  return value as T;
}
function deliverable(value: unknown, campaign: CampaignRecord): StrategyDeliverable {
  const raw = record(value);
  const id = own(raw, 'id');
  if (typeof id !== 'string' || !/^STRATEGY-ITEM-\d{3}$/.test(id)) throw new Error('ID de entregable inválido.');
  const channel = member<IdeaChannel>(own(raw, 'channel'), IDEA_CHANNELS, 'Canal');
  const contentLevel = member<CampaignContentLevel>(own(raw, 'contentLevel'), CAMPAIGN_CONTENT_LEVELS, 'Nivel editorial');
  const format = member<StrategyFormat>(own(raw, 'format'), STRATEGY_FORMATS, 'Formato');
  const quantity = own(raw, 'quantity');
  if (!campaign.channels.includes(channel) || !campaign.contentLevels.includes(contentLevel)) throw new Error('Canal o nivel no autorizado por el brief.');
  const allowed: Record<IdeaChannel, readonly CampaignContentLevel[]> = {
    INSTAGRAM_FEED: ['PUBLIC_SOCIAL', 'TEASER'], INSTAGRAM_REEL: ['PUBLIC_SOCIAL', 'TEASER'],
    INSTAGRAM_STORY: ['PUBLIC_SOCIAL', 'TEASER'], TEASER: ['TEASER'],
    FANVIEW_FEED: ['FANVIEW_FEED'], FANVIEW_CHAT: ['FANVIEW_CHAT'],
  };
  if (!allowed[channel].includes(contentLevel)) throw new Error('Nivel privado incompatible con el canal.');
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_STRATEGY_DELIVERABLES) throw new Error('Cantidad de entregables inválida.');
  return { id, channel, contentLevel, format, quantity,
    purpose: validateMultilineText(own(raw, 'purpose'), 500, 'Propósito'),
    creativeAngle: validateMultilineText(own(raw, 'creativeAngle'), 500, 'Enfoque creativo') };
}

export function validateCampaignStrategyInput(value: unknown, campaign: CampaignRecord): CampaignStrategyInput {
  const raw = record(value);
  const rows = bounded(own(raw, 'deliverables'), MAX_STRATEGY_ROWS).map(item => deliverable(item, campaign));
  if (rows.length === 0) throw new Error('Añade al menos un entregable planificado.');
  if (new Set(rows.map(item => item.id)).size !== rows.length) throw new Error('Entregable duplicado.');
  if (rows.reduce((total, item) => total + item.quantity, 0) > MAX_STRATEGY_DELIVERABLES) throw new Error('Límite total de 30 entregables excedido.');
  const notes = own(raw, 'notes');
  return {
    audience: validateMultilineText(own(raw, 'audience'), MAX_STRATEGY_TEXT, 'Audiencia'),
    audienceNeed: validateMultilineText(own(raw, 'audienceNeed'), MAX_STRATEGY_TEXT, 'Necesidad de audiencia'),
    creativeConcept: validateMultilineText(own(raw, 'creativeConcept'), MAX_STRATEGY_TEXT, 'Concepto creativo'),
    narrativeApproach: validateMultilineText(own(raw, 'narrativeApproach'), MAX_STRATEGY_TEXT, 'Narrativa'),
    visualDirection: validateMultilineText(own(raw, 'visualDirection'), MAX_STRATEGY_TEXT, 'Dirección visual'),
    toneOfVoice: validateMultilineText(own(raw, 'toneOfVoice'), MAX_STRATEGY_TEXT, 'Tono de voz'),
    desiredAudienceResponse: validateMultilineText(own(raw, 'desiredAudienceResponse'), MAX_STRATEGY_TEXT, 'Respuesta deseada'),
    successCriteria: validateMultilineText(own(raw, 'successCriteria'), MAX_STRATEGY_TEXT, 'Criterios de éxito'),
    deliverables: rows, notes: notes === undefined ? undefined : validateMultilineText(notes, 2000, 'Notas'),
  };
}

export function validateStrategyRevision(value: unknown, campaign: CampaignRecord): CampaignStrategyRevision {
  const raw = record(value);
  const input = validateCampaignStrategyInput(raw, campaign);
  const campaignId = own(raw, 'campaignId');
  const revision = own(raw, 'revision');
  const status = member<StrategyStatus>(own(raw, 'status'), STRATEGY_STATUSES, 'Estado de estrategia');
  if (campaignId !== campaign.id || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1 || revision > MAX_STRATEGY_REVISIONS || own(raw, 'author') !== 'LUIS') throw new Error('Revisión de estrategia inválida.');
  const createdAt = validateIdeaTimestamp(own(raw, 'createdAt'));
  const updatedAt = validateIdeaTimestamp(own(raw, 'updatedAt'));
  const approvedAtRaw = own(raw, 'approvedAt');
  const approvedByRaw = own(raw, 'approvedBy');
  const approvedAt = approvedAtRaw === undefined ? undefined : validateIdeaTimestamp(approvedAtRaw);
  const revisionReasonRaw = own(raw, 'revisionReason');
  const revisionReason = revisionReasonRaw === undefined ? undefined : validateMultilineText(revisionReasonRaw, 1500, 'Motivo de apertura de revisión');
  const reasonRaw = own(raw, 'changeReason');
  const changeReason = reasonRaw === undefined ? undefined : validateMultilineText(reasonRaw, 1500, 'Motivo de cambios');
  if (compareCampaignTimestamps(createdAt, updatedAt) > 0 ||
      (status === 'APPROVED') !== (approvedAt !== undefined && approvedByRaw === 'LUIS') ||
      (approvedAt !== undefined && (compareCampaignTimestamps(createdAt, approvedAt) > 0 || compareCampaignTimestamps(approvedAt, updatedAt) > 0)) ||
      (status !== 'APPROVED' && approvedByRaw !== undefined) ||
      (status === 'CHANGES_REQUESTED' && changeReason === undefined)) throw new Error('Metadata de estrategia incoherente.');
  return { ...input, campaignId, revision, status, createdAt, updatedAt, author: 'LUIS',
    approvedAt, approvedBy: approvedByRaw as 'LUIS' | undefined, revisionReason, changeReason };
}
