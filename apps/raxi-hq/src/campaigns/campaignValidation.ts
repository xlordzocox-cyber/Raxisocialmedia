import { IDEA_CHANNELS, IDEA_PRIORITIES, type IdeaChannel, type IdeaPriority } from '../ideas/ideaContracts';
import { validateIdeaTimestamp } from '../ideas/ideaValidation';
import { validateMultilineText, validateSingleLineText } from '../ideas/manualIdeaDraft';
import { CAMPAIGN_CONTENT_LEVELS, CAMPAIGN_STATUSES, type CampaignBriefInput, type CampaignContentLevel, type CampaignDecision, type CampaignRecord, type CampaignStatus } from './campaignContracts';

// Bound before reading individual records. This is an intentionally small session UI.
export const MAX_CAMPAIGNS = 100;
const MAX_CHANNELS = IDEA_CHANNELS.length;
const MAX_LEVELS = CAMPAIGN_CONTENT_LEVELS.length;
const MAX_ID = 128;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Registro de campaña inválido.');
  return value as Record<string, unknown>;
}
function own(value: Record<string, unknown>, key: string): unknown { return Object.hasOwn(value, key) ? value[key] : undefined; }
function optionalText(value: unknown, max: number, label: string): string | undefined {
  return value === undefined ? undefined : validateMultilineText(value, max, label);
}
function safeId(value: unknown): string {
  const id = validateSingleLineText(value, MAX_ID, 'ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) || Object.hasOwn(Object.prototype, id)) throw new Error('ID de campaña inválido.');
  return id;
}
function campaignId(value: unknown): string {
  const id = safeId(value);
  if (!/^CAMPAIGN-\d{3}$/.test(id)) throw new Error('ID de campaña inválido.');
  return id;
}
function bounded(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error('Colección de campaña inválida.');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('Colección de campaña inválida.');
  if (length > max) throw new Error('Límite de colección de campaña excedido.');
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    if (value.length !== length) throw new Error('Colección de campaña mutable.');
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Colección de campaña dispersa o mutable.');
    result.push(descriptor.value);
  }
  if (value.length !== length) throw new Error('Colección de campaña mutable.');
  return result;
}
function members<T extends string>(value: unknown, max: number, allowed: readonly T[], label: string): T[] {
  const items = bounded(value, max);
  if (!items.length) throw new Error(`${label}: elige al menos uno.`);
  const clean = items.map(item => {
    if (typeof item !== 'string' || !allowed.includes(item as T)) throw new Error(`${label} inválidos.`);
    return item as T;
  });
  if (new Set(clean).size !== clean.length) throw new Error(`${label} duplicados.`);
  return clean;
}
function priority(value: unknown): IdeaPriority {
  if (typeof value !== 'string' || !IDEA_PRIORITIES.includes(value as IdeaPriority)) throw new Error('Prioridad inválida.');
  return value as IdeaPriority;
}
export function compareCampaignTimestamps(left: string, right: string): number {
  const seconds = (value: string) => Date.parse(value.replace(/\.\d+(?=Z|[+-]\d\d:\d\d$)/, ''));
  const delta = seconds(left) - seconds(right);
  if (delta) return Math.sign(delta);
  const fraction = (value: string) => /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1] ?? '';
  const a = fraction(left), b = fraction(right), width = Math.max(a.length, b.length);
  return a.padEnd(width, '0') < b.padEnd(width, '0') ? -1 : a.padEnd(width, '0') > b.padEnd(width, '0') ? 1 : 0;
}
export function validateCampaignBrief(value: unknown): CampaignBriefInput {
  const raw = record(value);
  return {
    title: validateSingleLineText(own(raw, 'title'), 120, 'Título'),
    objective: validateMultilineText(own(raw, 'objective'), 1500, 'Objetivo'),
    priority: priority(own(raw, 'priority')),
    channels: members<IdeaChannel>(own(raw, 'channels'), MAX_CHANNELS, IDEA_CHANNELS, 'Canales'),
    contentLevels: members<CampaignContentLevel>(own(raw, 'contentLevels'), MAX_LEVELS, CAMPAIGN_CONTENT_LEVELS, 'Niveles de contenido'),
    keyMessage: validateMultilineText(own(raw, 'keyMessage'), 1500, 'Mensaje clave'),
    cta: optionalText(own(raw, 'cta'), 500, 'CTA'),
    notes: optionalText(own(raw, 'notes'), 2000, 'Notas'),
  };
}
export function validateCampaignDecision(value: unknown): CampaignDecision {
  const raw = record(value);
  const ideaId = safeId(own(raw, 'ideaId'));
  const status = own(raw, 'status');
  const decidedAt = own(raw, 'decidedAt');
  const reason = own(raw, 'reason');
  const campaign = own(raw, 'campaignId');
  if (status === 'PENDING' && (decidedAt !== undefined || reason !== undefined || campaign !== undefined)) throw new Error('Decisión pendiente inválida.');
  if (status === 'ACCEPTED' && (decidedAt === undefined || campaign === undefined || reason !== undefined)) throw new Error('Decisión aceptada inválida.');
  if (status === 'REJECTED' && (decidedAt === undefined || campaign !== undefined || reason === undefined)) throw new Error('Decisión rechazada inválida.');
  if (status !== 'PENDING' && status !== 'ACCEPTED' && status !== 'REJECTED') throw new Error('Estado de decisión inválido.');
  return { ideaId, status, decidedAt: decidedAt === undefined ? undefined : validateIdeaTimestamp(decidedAt),
    reason: reason === undefined ? undefined : validateMultilineText(reason, 1500, 'Motivo de rechazo'),
    campaignId: campaign === undefined ? undefined : campaignId(campaign) };
}
export function validateCampaignRecord(value: unknown): CampaignRecord {
  const raw = record(value);
  const brief = validateCampaignBrief(raw);
  const status = own(raw, 'status');
  const provenance = own(raw, 'provenance');
  if (typeof status !== 'string' || !CAMPAIGN_STATUSES.includes(status as CampaignStatus)) throw new Error('Estado de campaña inválido.');
  if (provenance !== 'MOCK' && provenance !== 'MOCK_SESSION_MODIFIED' && provenance !== 'LOCAL_SESSION') throw new Error('Provenance inválida.');
  const result: CampaignRecord = { ...brief, id: campaignId(own(raw, 'id')), sourceIdeaId: safeId(own(raw, 'sourceIdeaId')),
    sourceHandoffSentAt: validateIdeaTimestamp(own(raw, 'sourceHandoffSentAt')), provenance, status: status as CampaignStatus,
    createdAt: validateIdeaTimestamp(own(raw, 'createdAt')), updatedAt: validateIdeaTimestamp(own(raw, 'updatedAt')) };
  if (compareCampaignTimestamps(result.sourceHandoffSentAt, result.createdAt) > 0 || compareCampaignTimestamps(result.createdAt, result.updatedAt) > 0) throw new Error('Cronología de campaña inválida.');
  return result;
}
export function validateCampaignCollection(value: unknown): CampaignRecord[] {
  const records = bounded(value, MAX_CAMPAIGNS).map(validateCampaignRecord);
  if (new Set(records.map(item => item.id)).size !== records.length || new Set(records.map(item => item.sourceIdeaId)).size !== records.length) throw new Error('Campaña duplicada.');
  return records;
}
export function transitionCampaign(record: CampaignRecord, next: CampaignStatus, at: string): CampaignRecord {
  const allowed: Record<CampaignStatus, readonly CampaignStatus[]> = { DRAFT: ['PLANNING', 'CANCELED'], PLANNING: ['BLOCKED', 'CANCELED'], BLOCKED: ['PLANNING', 'CANCELED'], CANCELED: [] };
  if (!allowed[record.status].includes(next)) throw new Error('Transición de campaña inválida.');
  const timestamp = validateIdeaTimestamp(at);
  if (compareCampaignTimestamps(record.updatedAt, timestamp) > 0) throw new Error('Cronología de campaña inválida.');
  return validateCampaignRecord({ ...record, status: next, updatedAt: timestamp });
}
