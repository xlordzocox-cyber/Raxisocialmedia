import type { CampaignRecord } from '../campaigns/campaignContracts';
import type { CampaignStrategyRevision, StrategyDeliverable } from '../campaigns/strategyContracts';
import { validateCampaignRecord, compareCampaignTimestamps } from '../campaigns/campaignValidation';
import { validateStrategyRevision } from '../campaigns/strategyValidation';
import { validateIdeaTimestamp } from '../ideas/ideaValidation';
import { validateMultilineText } from '../ideas/manualIdeaDraft';
import { inspectionMatchesReceipt, validPilotSha256, type PilotImageInspection } from './pilotImage';

/** A bounded, local handoff. It never calls Aria or treats imported data as authenticated. */
export const PILOT_PROVIDER = 'ARIA_STUDIO' as const;
export const PILOT_EXECUTOR = 'CODEX_MCP' as const;
export const PILOT_MODEL = 'gptimg' as const;
export const PILOT_QUALITY = 'std' as const;
export const PILOT_PRICE_CEILING_USD = 0.039;
export const MAX_PILOT_JOBS = 1;
export const PILOT_TIMEOUT_MS = 180_000;
// Player Select's public reference set, checked against the canonical catalog by tests.
// Avoid bundling the full catalog (including unrelated document IDs) into the browser.
export const PILOT_SOURCE_ASSET_IDS = ['A-FOREST-ROGUE', 'B-BLUE-DUELIST', 'C-DUAL-PISTOLS', 'D-RED-ADVENTURER', 'E-BLACK-MOON'] as const;
const approvedAssetIds = new Set<string>(PILOT_SOURCE_ASSET_IDS);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface AriaPilotOrder {
  schemaVersion: 1;
  jobId: string;
  campaign: CampaignRecord;
  strategy: CampaignStrategyRevision;
  deliverableId: string;
  sourceAssetIds: string[];
  provider: typeof PILOT_PROVIDER;
  executor: typeof PILOT_EXECUTOR;
  characterId: 'raxi-vox';
  model: typeof PILOT_MODEL;
  quality: typeof PILOT_QUALITY;
  aspectRatio: '3:4';
  priceCeilingUsd: typeof PILOT_PRICE_CEILING_USD;
  requestedCount: 1;
  scene: string;
  preparedAt: string;
  executionApproval: { status: 'PENDING' } | { status: 'APPROVED'; actor: 'LUIS'; at: string };
  state: 'AWAITING_APPROVAL' | 'QUEUED';
}

export interface AriaPilotReceipt {
  schemaVersion: 1;
  jobId: string;
  provider: typeof PILOT_PROVIDER;
  executor: typeof PILOT_EXECUTOR;
  model: typeof PILOT_MODEL;
  ariaImageId: string;
  requestedAt: string;
  completedAt: string;
  state: 'SUCCEEDED';
  /** Temporary provider URL; never catalogued as a durable asset. */
  imageUrl: string;
  /** SHA-256 of the exact provider file bytes obtained by Codex; absent means QA is blocked. */
  imageSha256?: string;
  priceUsd: number;
}

export interface AriaPilotFailure {
  schemaVersion: 1;
  jobId: string;
  provider: typeof PILOT_PROVIDER;
  executor: typeof PILOT_EXECUTOR;
  model: typeof PILOT_MODEL;
  state: 'FAILED' | 'TIMED_OUT';
  at: string;
  errorCode: 'PROVIDER_ERROR' | 'MCP_ERROR' | 'TIMEOUT' | 'NO_IMAGE';
  ariaImageId?: string;
}

export interface AriaPilotReview {
  schemaVersion: 1;
  jobId: string;
  ariaImageId: string;
  imageSha256: string;
  qaStatus: 'VISUAL_REVIEW_REQUIRED' | 'PASS' | 'FAIL';
  qaNotes?: string;
  reviewedAt?: string;
  humanDecision: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedAt?: string;
  decidedBy?: 'LUIS';
}

export interface AriaPilotOutcome {
  failure?: AriaPilotFailure;
  receipt?: AriaPilotReceipt;
  review?: AriaPilotReview;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} inválido.`);
  return value as Record<string, unknown>;
}
function own(value: Record<string, unknown>, key: string): unknown { return Object.hasOwn(value, key) ? value[key] : undefined; }
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !idPattern.test(value) || Object.hasOwn(Object.prototype, value)) throw new Error(`${label} inválido.`);
  return value;
}
function assetIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error('Referencias de assets inválidas.');
  const length = value.length;
  const result: string[] = [];
  for (let i = 0; i < length; i++) {
    if (value.length !== length) throw new Error('Referencias mutables.');
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Referencias dispersas o mutables.');
    const item = id(descriptor.value, 'Asset ID');
    if (!approvedAssetIds.has(item) || result.includes(item)) throw new Error('Asset ID fuera del set público aprobado para el piloto o duplicado.');
    result.push(item);
  }
  if (value.length !== length) throw new Error('Referencias mutables.');
  return result;
}
function eligible(campaign: CampaignRecord, strategy: CampaignStrategyRevision, deliverableId: string): StrategyDeliverable {
  if (campaign.status !== 'PLANNING' || campaign.provenance !== 'LOCAL_SESSION' || strategy.status !== 'APPROVED' || strategy.approvedBy !== 'LUIS' ||
    strategy.campaignId !== campaign.id || !strategy.approvedAt) throw new Error('Strategy aprobada y campaña en planificación requeridas.');
  const row = strategy.deliverables.find(item => item.id === deliverableId);
  if (!row || row.format !== 'PHOTO' || row.channel !== 'INSTAGRAM_FEED' || row.contentLevel !== 'PUBLIC_SOCIAL' || row.quantity < 1) {
    throw new Error('Entregable PHOTO de Instagram público no disponible en esta campaña.');
  }
  return row;
}
export function pilotJobId(campaignId: string, revision: number, deliverableId: string): string {
  return `ARIA-${campaignId}-R${revision}-${deliverableId}`;
}
export function prepareAriaPilot(campaignValue: unknown, strategyValue: unknown, deliverableId: string, scene: unknown, sources: unknown, at: string): AriaPilotOrder {
  const campaign = validateCampaignRecord(campaignValue);
  const strategy = validateStrategyRevision(strategyValue, campaign);
  eligible(campaign, strategy, id(deliverableId, 'Entregable'));
  const preparedAt = validateIdeaTimestamp(at);
  if (compareCampaignTimestamps(strategy.approvedAt!, preparedAt) > 0) throw new Error('La orden precede a la aprobación de Strategy.');
  return { schemaVersion: 1, jobId: pilotJobId(campaign.id, strategy.revision, deliverableId), campaign, strategy,
    deliverableId, sourceAssetIds: assetIds(sources), provider: PILOT_PROVIDER, executor: PILOT_EXECUTOR,
    characterId: 'raxi-vox', model: PILOT_MODEL, quality: PILOT_QUALITY, aspectRatio: '3:4', priceCeilingUsd: PILOT_PRICE_CEILING_USD, requestedCount: 1,
    scene: validateMultilineText(scene, 1500, 'Fotografía solicitada'), preparedAt,
    executionApproval: { status: 'PENDING' }, state: 'AWAITING_APPROVAL' };
}
export function validateAriaPilotOrder(value: unknown): AriaPilotOrder {
  const raw = object(value, 'Orden');
  const campaign = validateCampaignRecord(own(raw, 'campaign'));
  const strategy = validateStrategyRevision(own(raw, 'strategy'), campaign);
  const deliverableId = id(own(raw, 'deliverableId'), 'Entregable');
  const prepared = prepareAriaPilot(campaign, strategy, deliverableId, own(raw, 'scene'), own(raw, 'sourceAssetIds'), String(own(raw, 'preparedAt')));
  if (own(raw, 'schemaVersion') !== 1 || own(raw, 'jobId') !== prepared.jobId || own(raw, 'provider') !== PILOT_PROVIDER ||
      own(raw, 'executor') !== PILOT_EXECUTOR || own(raw, 'characterId') !== 'raxi-vox' || own(raw, 'model') !== PILOT_MODEL ||
      own(raw, 'quality') !== PILOT_QUALITY || own(raw, 'aspectRatio') !== '3:4' || own(raw, 'priceCeilingUsd') !== PILOT_PRICE_CEILING_USD || own(raw, 'requestedCount') !== 1) throw new Error('Metadata de orden inválida.');
  const approval = object(own(raw, 'executionApproval'), 'Aprobación');
  const status = own(approval, 'status');
  if (status === 'PENDING' && own(raw, 'state') === 'AWAITING_APPROVAL') return prepared;
  if (status !== 'APPROVED' || own(approval, 'actor') !== 'LUIS' || own(raw, 'state') !== 'QUEUED') throw new Error('Aprobación de ejecución inválida.');
  const approvedAt = validateIdeaTimestamp(own(approval, 'at'));
  if (compareCampaignTimestamps(prepared.preparedAt, approvedAt) > 0) throw new Error('Aprobación de ejecución anterior a la orden.');
  return { ...prepared, executionApproval: { status: 'APPROVED', actor: 'LUIS', at: approvedAt }, state: 'QUEUED' };
}
export function authorizeAriaPilot(value: AriaPilotOrder, at: string): AriaPilotOrder {
  const order = validateAriaPilotOrder(value);
  if (order.executionApproval.status !== 'PENDING') throw new Error('Trabajo ya autorizado; no volver a ejecutar.');
  return validateAriaPilotOrder({ ...order, executionApproval: { status: 'APPROVED', actor: 'LUIS', at }, state: 'QUEUED' });
}

/** One job per pilot session; repeats are harmless, but approval cannot be reset. */
export function reconcileAriaPilotOrder(existing: AriaPilotOrder | undefined, incoming: AriaPilotOrder): AriaPilotOrder {
  const next = validateAriaPilotOrder(incoming);
  if (!existing) return next;
  const prior = validateAriaPilotOrder(existing);
  if (prior.jobId !== next.jobId || JSON.stringify({ ...prior, executionApproval: undefined, state: undefined }) !==
      JSON.stringify({ ...next, executionApproval: undefined, state: undefined })) throw new Error('Piloto limitado a una orden inmutable por sesión.');
  if (JSON.stringify(prior) === JSON.stringify(next)) return prior;
  if (prior.executionApproval.status === 'PENDING' && next.executionApproval.status === 'APPROVED') return next;
  throw new Error('No se puede reemplazar una aprobación existente.');
}

export function isAriaPilotOrderCurrent(order: AriaPilotOrder, campaign: CampaignRecord, strategy?: CampaignStrategyRevision): boolean {
  return campaign.id === order.campaign.id && campaign.status === 'PLANNING' &&
    strategy?.status === 'APPROVED' && strategy.revision === order.strategy.revision && strategy.updatedAt === order.strategy.updatedAt;
}
export function validateAriaPilotReceipt(value: unknown, orderValue: unknown, failureValue?: unknown): AriaPilotReceipt {
  const order = validateAriaPilotOrder(orderValue);
  if (order.executionApproval.status !== 'APPROVED') throw new Error('Ejecución sin aprobación humana.');
  const raw = object(value, 'Resultado');
  if (own(raw, 'schemaVersion') !== 1 || own(raw, 'jobId') !== order.jobId || own(raw, 'provider') !== PILOT_PROVIDER ||
      own(raw, 'executor') !== PILOT_EXECUTOR || own(raw, 'model') !== order.model || own(raw, 'state') !== 'SUCCEEDED') throw new Error('Provenance de resultado inválida.');
  const ariaImageId = id(own(raw, 'ariaImageId'), 'ID Aria');
  if (failureValue !== undefined) {
    const failure = validateAriaPilotFailure(failureValue, order);
    if (failure.ariaImageId && failure.ariaImageId !== ariaImageId) throw new Error('El ID Aria no coincide con el fallo reconciliado.');
  }
  const requestedAt = validateIdeaTimestamp(own(raw, 'requestedAt'));
  const completedAt = validateIdeaTimestamp(own(raw, 'completedAt'));
  if (compareCampaignTimestamps((order.executionApproval as { at: string }).at, requestedAt) > 0 || compareCampaignTimestamps(requestedAt, completedAt) > 0) throw new Error('Cronología de resultado inválida.');
  const imageUrl = own(raw, 'imageUrl');
  if (typeof imageUrl !== 'string' || imageUrl.length > 2048 || /[\u0000-\u0020\u007f]/.test(imageUrl) || !/^https:\/\//.test(imageUrl)) throw new Error('Resultado sin imagen accesible.');
  try {
    const parsed = new URL(imageUrl);
    const host = parsed.hostname.toLowerCase();
    if (parsed.username || parsed.password || host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || host === '[::1]' ||
        /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) throw new Error();
  }
  catch { throw new Error('URL de resultado inválida.'); }
  const priceUsd = own(raw, 'priceUsd');
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > order.priceCeilingUsd) throw new Error('Precio de resultado fuera del límite autorizado.');
  const digest = own(raw, 'imageSha256');
  if (digest !== undefined && !validPilotSha256(digest)) throw new Error('Huella SHA-256 de resultado inválida.');
  return { schemaVersion: 1, jobId: order.jobId, provider: PILOT_PROVIDER, executor: PILOT_EXECUTOR, model: order.model,
    ariaImageId, requestedAt, completedAt, state: 'SUCCEEDED', imageUrl, imageSha256: digest, priceUsd };
}

export function validateAriaPilotFailure(value: unknown, orderValue: unknown): AriaPilotFailure {
  const order = validateAriaPilotOrder(orderValue);
  if (order.executionApproval.status !== 'APPROVED') throw new Error('Ejecución sin aprobación humana.');
  const raw = object(value, 'Fallo');
  if (own(raw, 'schemaVersion') !== 1 || own(raw, 'jobId') !== order.jobId || own(raw, 'provider') !== PILOT_PROVIDER ||
      own(raw, 'executor') !== PILOT_EXECUTOR || own(raw, 'model') !== order.model) throw new Error('Provenance de fallo inválida.');
  const state = own(raw, 'state');
  const errorCode = own(raw, 'errorCode');
  if ((state !== 'FAILED' && state !== 'TIMED_OUT') ||
      !['PROVIDER_ERROR', 'MCP_ERROR', 'TIMEOUT', 'NO_IMAGE'].includes(String(errorCode)) ||
      (state === 'TIMED_OUT') !== (errorCode === 'TIMEOUT')) throw new Error('Estado de fallo inválido.');
  const at = validateIdeaTimestamp(own(raw, 'at'));
  if (compareCampaignTimestamps(order.executionApproval.at, at) > 0) throw new Error('Fallo anterior a autorización.');
  const ariaImageId = own(raw, 'ariaImageId');
  return { schemaVersion: 1, jobId: order.jobId, provider: PILOT_PROVIDER, executor: PILOT_EXECUTOR, model: PILOT_MODEL,
    state, at, errorCode: errorCode as AriaPilotFailure['errorCode'],
    ariaImageId: ariaImageId === undefined ? undefined : id(ariaImageId, 'ID Aria') };
}

/** Preserve a known provider ID while allowing a later failure to identify an ambiguous job. */
export function reconcileAriaPilotFailure(existing: AriaPilotFailure | undefined, incoming: unknown, order: AriaPilotOrder): AriaPilotFailure {
  const next = validateAriaPilotFailure(incoming, order);
  if (!existing) return next;
  const prior = validateAriaPilotFailure(existing, order);
  if (prior.ariaImageId && prior.ariaImageId !== next.ariaImageId) throw new Error('No se puede sustituir el ID Aria del fallo registrado.');
  if (compareCampaignTimestamps(prior.at, next.at) > 0) throw new Error('Un fallo posterior no puede retroceder en el tiempo.');
  return next;
}

/** Imported manifests cannot replace an existing result or its QA decision. */
export function reconcileAriaPilotReceipt(existing: AriaPilotReceipt | undefined, incoming: unknown, order: AriaPilotOrder,
  failure?: AriaPilotFailure, review?: AriaPilotReview): AriaPilotReceipt {
  if (existing || review) throw new Error('El resultado o su revisión ya están registrados.');
  return validateAriaPilotReceipt(incoming, order, failure);
}

export function applyAriaPilotFailure(outcome: AriaPilotOutcome, incoming: unknown, order: AriaPilotOrder): AriaPilotOutcome {
  if (outcome.receipt || outcome.review) throw new Error('No se puede cambiar un trabajo con resultado o revisión.');
  return { ...outcome, failure: reconcileAriaPilotFailure(outcome.failure, incoming, order) };
}

export function applyAriaPilotReceipt(outcome: AriaPilotOutcome, incoming: unknown, order: AriaPilotOrder): AriaPilotOutcome {
  return { ...outcome, receipt: reconcileAriaPilotReceipt(outcome.receipt, incoming, order, outcome.failure, outcome.review) };
}

/** File reads run in selection order; one rejection must not strand later imports. */
export function createSerialAriaImports() {
  let tail: Promise<unknown> = Promise.resolve();
  return (task: () => Promise<void>): Promise<void> => {
    const current = tail.then(task);
    tail = current.catch(() => undefined);
    return current;
  };
}

export function recordAriaPilotReview(receipt: AriaPilotReceipt, previous: AriaPilotReview | undefined,
  action: 'QA_PASS' | 'QA_FAIL' | 'HUMAN_APPROVE' | 'HUMAN_REJECT', at: string, notes?: string, inspection?: PilotImageInspection): AriaPilotReview {
  const time = validateIdeaTimestamp(at);
  if (compareCampaignTimestamps(receipt.completedAt, time) > 0) throw new Error('Revisión anterior al resultado.');
  if (!validPilotSha256(receipt.imageSha256) || !inspectionMatchesReceipt(inspection, receipt))
    throw new Error('Imagen verificada y vinculada al recibo requerida antes de QA o decisión.');
  const prior = previous ?? { schemaVersion: 1 as const, jobId: receipt.jobId, ariaImageId: receipt.ariaImageId, imageSha256: receipt.imageSha256,
    qaStatus: 'VISUAL_REVIEW_REQUIRED' as const, humanDecision: 'PENDING' as const };
  if (prior.jobId !== receipt.jobId || prior.ariaImageId !== receipt.ariaImageId || prior.imageSha256 !== receipt.imageSha256) throw new Error('Revisión de otro trabajo o imagen.');
  if (prior.humanDecision !== 'PENDING') throw new Error('Decisión humana ya registrada.');
  if (action === 'QA_PASS' || action === 'QA_FAIL') {
    const qaNotes = validateMultilineText(notes, 1500, 'Observaciones de Calidad');
    return { ...prior, qaStatus: action === 'QA_PASS' ? 'PASS' : 'FAIL', qaNotes, reviewedAt: time };
  }
  if (action === 'HUMAN_APPROVE' && prior.qaStatus !== 'PASS') throw new Error('QA visual PASS requerido antes de aprobar.');
  if (action === 'HUMAN_REJECT' && prior.qaStatus === 'VISUAL_REVIEW_REQUIRED') throw new Error('QA visual requerido antes de decidir.');
  if (prior.reviewedAt && compareCampaignTimestamps(prior.reviewedAt, time) > 0) throw new Error('Decisión anterior a QA.');
  return { ...prior, humanDecision: action === 'HUMAN_APPROVE' ? 'APPROVED' : 'REJECTED', decidedAt: time, decidedBy: 'LUIS' };
}

/** Explicit timestamps let the Codex handoff operator stop polling without a hidden clock. */
export function pilotPollDecision(startedAt: string, observedAt: string): 'CONTINUE' | 'TIMED_OUT' {
  const start = validateIdeaTimestamp(startedAt);
  const observed = validateIdeaTimestamp(observedAt);
  if (compareCampaignTimestamps(start, observed) > 0) throw new Error('Lectura anterior al inicio.');
  return Date.parse(observed) - Date.parse(start) >= PILOT_TIMEOUT_MS ? 'TIMED_OUT' : 'CONTINUE';
}
