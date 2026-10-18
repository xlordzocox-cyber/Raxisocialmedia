import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import catalog from '../../../content/asset-library/ASSET_CATALOG.json';
import type { CampaignRecord } from '../src/campaigns/campaignContracts';
import { createCampaignSession, type CampaignSession } from '../src/campaigns/campaignSession';
import type { CampaignStrategyRevision } from '../src/campaigns/strategyContracts';
import { AriaProductionPanel } from '../src/production/AriaProductionPanel';
import { applyAriaPilotFailure, applyAriaPilotReceipt, authorizeAriaPilot, createSerialAriaImports, importCurrentAriaManifest, isAriaPilotOrderCurrent, isAriaPilotOrderCurrentInSession, PILOT_SOURCE_ASSET_IDS, pilotJobId, pilotPollDecision, prepareAriaPilot, reconcileAriaPilotFailure, reconcileAriaPilotOrder, reconcileAriaPilotReceipt, recordAriaPilotReview, requireCurrentAriaPilotOrder, validateAriaPilotFailure, validateAriaPilotOrder, validateAriaPilotReceipt, type AriaPilotOutcome } from '../src/production/ariaPilot';
import { createPilotImageSelection, inspectPilotImageFile, inspectionMatchesReceipt, type PilotImageFile, type PilotImageInspection } from '../src/production/pilotImage';

const campaign: CampaignRecord = { id: 'CAMPAIGN-001', sourceIdeaId: 'IDEA-001', sourceHandoffSentAt: '2026-10-17T00:00:00Z',
  provenance: 'LOCAL_SESSION', status: 'PLANNING', title: 'Player Select: Raxi Edition', objective: 'Participación pública',
  priority: 'HIGH', channels: ['INSTAGRAM_FEED', 'FANVIEW_FEED'], contentLevels: ['PUBLIC_SOCIAL', 'FANVIEW_FEED'],
  keyMessage: 'Elige tu main', createdAt: '2026-10-17T00:00:01Z', updatedAt: '2026-10-17T00:00:02Z' };
const strategy: CampaignStrategyRevision = { campaignId: campaign.id, revision: 1, status: 'APPROVED', author: 'LUIS',
  createdAt: '2026-10-17T00:00:03Z', updatedAt: '2026-10-17T00:00:05Z', approvedAt: '2026-10-17T00:00:05Z', approvedBy: 'LUIS',
  audience: 'Adultos con interés gamer', audienceNeed: 'Participar en la selección', creativeConcept: 'Player Select',
  narrativeApproach: 'Selección de un personaje', visualDirection: 'Retrato gamer original', toneOfVoice: 'Juguetón',
  desiredAudienceResponse: 'Comentario', successCriteria: 'Comentarios por alcance', deliverables: [
    { id: 'STRATEGY-ITEM-001', channel: 'INSTAGRAM_FEED', contentLevel: 'PUBLIC_SOCIAL', format: 'PHOTO', quantity: 1, purpose: 'Portada', creativeAngle: 'Selección de personaje' },
    { id: 'STRATEGY-ITEM-002', channel: 'FANVIEW_FEED', contentLevel: 'FANVIEW_FEED', format: 'PHOTO', quantity: 1, purpose: 'Privado', creativeAngle: 'Exclusivo' },
  ] };
const scene = 'Raxi adulta en un retrato de personaje gamer original, luz cian y lila, vestuario público no explícito.';
const preparedAt = '2026-10-17T00:00:06Z';
const approvedAt = '2026-10-17T00:00:07Z';
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0];
const fixtureDigest = createHash('sha256').update(Uint8Array.from(png)).digest('hex');
test('pilot reference IDs remain public and approved in the canonical catalog', () => {
  for (const assetId of PILOT_SOURCE_ASSET_IDS) {
    const asset = catalog.find(item => item.asset_id === assetId);
    assert.equal(asset?.category, 'approved');
    assert.equal(asset?.content_level, 'public');
    assert.ok(asset?.recommended_platforms.includes('Instagram'));
  }
});
function prepared() { return prepareAriaPilot(campaign, strategy, 'STRATEGY-ITEM-001', scene, ['B-BLUE-DUELIST'], preparedAt); }
function authorized() { return authorizeAriaPilot(prepared(), approvedAt); }
function receipt() { return { schemaVersion: 1, jobId: pilotJobId(campaign.id, 1, 'STRATEGY-ITEM-001'), provider: 'ARIA_STUDIO', executor: 'CODEX_MCP', model: 'gptimg',
  ariaImageId: 'aria-image-123', requestedAt: '2026-10-17T00:00:08Z', completedAt: '2026-10-17T00:00:09Z', state: 'SUCCEEDED',
  imageUrl: 'https://example.org/temporary-image.jpg', imageSha256: fixtureDigest, priceUsd: 0.039 }; }
function inspected(result = receipt()): PilotImageInspection {
  return { jobId: result.jobId, ariaImageId: result.ariaImageId, sha256: result.imageSha256,
    width: 100, height: 100, visiblePixels: true, previewLoaded: true };
}

test('only an approved Strategy and its own public Instagram PHOTO can prepare one job', () => {
  const job = prepared();
  assert.equal(job.requestedCount, 1);
  assert.equal(job.provider, 'ARIA_STUDIO');
  assert.equal(job.strategy.status, 'APPROVED');
  assert.equal(job.executionApproval.status, 'PENDING');
  assert.throws(() => prepareAriaPilot(campaign, { ...strategy, status: 'DRAFT', approvedAt: undefined, approvedBy: undefined }, 'STRATEGY-ITEM-001', scene, [], preparedAt), /aprobada/);
  assert.throws(() => prepareAriaPilot(campaign, { ...strategy, status: 'IN_REVIEW', approvedAt: undefined, approvedBy: undefined }, 'STRATEGY-ITEM-001', scene, [], preparedAt), /aprobada/);
  assert.throws(() => prepareAriaPilot(campaign, strategy, 'STRATEGY-ITEM-999', scene, [], preparedAt), /Entregable/);
  assert.throws(() => prepareAriaPilot(campaign, strategy, 'STRATEGY-ITEM-002', scene, [], preparedAt), /Instagram público/);
  assert.throws(() => prepareAriaPilot({ ...campaign, status: 'BLOCKED' }, strategy, 'STRATEGY-ITEM-001', scene, [], preparedAt), /aprobada/);
  assert.throws(() => prepareAriaPilot({ ...campaign, provenance: 'MOCK' }, strategy, 'STRATEGY-ITEM-001', scene, [], preparedAt), /aprobada/);
});
test('snapshot and job ID are deterministic; no generation approval is inferred from Strategy', () => {
  assert.deepEqual(prepared(), prepared());
  assert.equal(prepared().jobId, 'ARIA-CAMPAIGN-001-R1-STRATEGY-ITEM-001');
  assert.throws(() => validateAriaPilotReceipt(receipt(), prepared()), /aprobación/);
  assert.throws(() => authorizeAriaPilot(authorized(), approvedAt), /ya autorizado/);
  assert.throws(() => authorizeAriaPilot(prepared(), '2026-10-17T00:00:04Z'), /anterior/);
});
test('one pilot job is idempotent and an authorized order cannot be reset or replaced', () => {
  const pending = prepared(), approved = authorized();
  assert.deepEqual(reconcileAriaPilotOrder(undefined, pending), pending);
  assert.deepEqual(reconcileAriaPilotOrder(pending, pending), pending);
  assert.deepEqual(reconcileAriaPilotOrder(pending, approved), approved);
  assert.throws(() => reconcileAriaPilotOrder(approved, pending), /reemplazar/);
  assert.throws(() => reconcileAriaPilotOrder(approved, { ...approved, scene: 'Otra escena' }), /inmutable/);
});
test('a canceled campaign or newer Strategy invalidates export of the session order', () => {
  const order = authorized();
  assert.equal(isAriaPilotOrderCurrent(order, campaign, strategy), true);
  assert.equal(isAriaPilotOrderCurrent(order, { ...campaign, status: 'CANCELED' }, strategy), false);
  assert.equal(isAriaPilotOrderCurrent(order, campaign, { ...strategy, revision: 2 }), false);
  assert.equal(isAriaPilotOrderCurrent(order, campaign, undefined), false);
  assert.equal(isAriaPilotOrderCurrent(order, { ...campaign, updatedAt: '2026-10-17T00:00:10Z' }, strategy), false);
});

test('a pending manifest read rejects canceled, blocked, revised or deselected work without changing history', async () => {
  const order = authorized();
  const other = { ...campaign, id: 'CAMPAIGN-002' };
  const initial: CampaignSession = { ...createCampaignSession(), campaigns: [campaign, other], strategies: [strategy] };
  const scenarios: { name: string; session: CampaignSession; selectedId: string }[] = [
    { name: 'canceled', session: { ...initial, campaigns: [{ ...campaign, status: 'CANCELED' }, other] }, selectedId: campaign.id },
    { name: 'blocked', session: { ...initial, campaigns: [{ ...campaign, status: 'BLOCKED' }, other] }, selectedId: campaign.id },
    { name: 'new revision', session: { ...initial, strategies: [...initial.strategies, { ...strategy, revision: 2 }] }, selectedId: campaign.id },
    { name: 'other selection', session: initial, selectedId: other.id },
  ];
  for (const scenario of scenarios) {
    let liveSession = initial;
    let selectedId = campaign.id;
    let outcome: AriaPilotOutcome = {};
    let resolveText!: (value: string) => void;
    const text = new Promise<string>(resolve => { resolveText = resolve; });
    const stillCurrent = () => isAriaPilotOrderCurrentInSession(order, liveSession, selectedId);
    const pending = importCurrentAriaManifest({ size: 500, text: () => text }, order, stillCurrent,
      value => { requireCurrentAriaPilotOrder(order, order, liveSession, selectedId); outcome = applyAriaPilotReceipt(outcome, value, order); },
      value => { requireCurrentAriaPilotOrder(order, order, liveSession, selectedId); outcome = applyAriaPilotFailure(outcome, value, order); });
    liveSession = scenario.session;
    selectedId = scenario.selectedId;
    resolveText(JSON.stringify(receipt()));
    await assert.rejects(pending, /obsoleta/, scenario.name);
    assert.deepEqual(outcome, {}, scenario.name);
  }
});

test('an unchanged session imports successfully, while callbacks reject an obsolete order before outcome updates', async () => {
  const order = authorized();
  const session: CampaignSession = { ...createCampaignSession(), campaigns: [campaign], strategies: [strategy] };
  let outcome: AriaPilotOutcome = {};
  let resolveText!: (value: string) => void;
  const text = new Promise<string>(resolve => { resolveText = resolve; });
  const pending = importCurrentAriaManifest({ size: 500, text: () => text }, order,
    () => isAriaPilotOrderCurrentInSession(order, session, campaign.id),
    value => { requireCurrentAriaPilotOrder(order, order, session, campaign.id); outcome = applyAriaPilotReceipt(outcome, value, order); },
    () => { throw new Error('Unexpected failure manifest'); });
  resolveText(JSON.stringify(receipt()));
  await pending;
  assert.equal(outcome.receipt?.ariaImageId, receipt().ariaImageId);
  const before = structuredClone(outcome);
  assert.throws(() => requireCurrentAriaPilotOrder(order, { ...order }, session, campaign.id), /obsoleta/);
  assert.throws(() => requireCurrentAriaPilotOrder(order, order, { ...session, campaigns: [{ ...campaign, status: 'BLOCKED' }] }, campaign.id), /obsoleta/);
  assert.deepEqual(outcome, before);
});

test('a pending failure cannot replace history after a campaign changes, and prior QA stays read-only', async () => {
  const order = authorized();
  const initial: CampaignSession = { ...createCampaignSession(), campaigns: [campaign], strategies: [strategy] };
  let liveSession = initial;
  const knownFailure = validateAriaPilotFailure({ schemaVersion: 1, jobId: order.jobId, provider: 'ARIA_STUDIO',
    executor: 'CODEX_MCP', model: 'gptimg', state: 'TIMED_OUT', at: '2026-10-17T00:03:08Z',
    errorCode: 'TIMEOUT', ariaImageId: 'aria-image-123' }, order);
  let outcome: AriaPilotOutcome = { failure: knownFailure };
  const before = structuredClone(outcome);
  let resolveText!: (value: string) => void;
  const text = new Promise<string>(resolve => { resolveText = resolve; });
  const pending = importCurrentAriaManifest({ size: 500, text: () => text }, order,
    () => isAriaPilotOrderCurrentInSession(order, liveSession, campaign.id),
    value => { requireCurrentAriaPilotOrder(order, order, liveSession, campaign.id); outcome = applyAriaPilotReceipt(outcome, value, order); },
    value => { requireCurrentAriaPilotOrder(order, order, liveSession, campaign.id); outcome = applyAriaPilotFailure(outcome, value, order); });
  liveSession = { ...initial, campaigns: [{ ...campaign, status: 'BLOCKED' }] };
  resolveText(JSON.stringify({ ...knownFailure, ariaImageId: 'another-image' }));
  await assert.rejects(pending, /obsoleta/);
  assert.deepEqual(outcome, before);

  const priorReceipt = validateAriaPilotReceipt(receipt(), order);
  const priorReview = recordAriaPilotReview(priorReceipt, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Inspeccionada.', inspected());
  const html = renderToStaticMarkup(<AriaProductionPanel campaign={{ ...campaign, status: 'BLOCKED' }} strategy={strategy}
    order={order} receipt={priorReceipt} review={priorReview} onOrder={() => {}} onReceipt={() => {}}
    isOrderCurrent={() => false} />);
  assert.match(html, /Esta orden quedó obsoleta/);
  assert.match(html, /Calidad: PASS/);
  assert.match(html, /Luis: aprobar fotografía/);
  assert.match(html, /disabled=""[^>]*>Luis: aprobar fotografía/);
  assert.match(html, /Cargar copia local para inspección visual<input[^>]*disabled=""/);
  assert.throws(() => requireCurrentAriaPilotOrder(order, order, liveSession, campaign.id), /obsoleta/);
});
test('portable order rejects forged provider, model, quantity, strategy and assets', () => {
  assert.deepEqual(validateAriaPilotOrder(authorized()), authorized());
  for (const patch of [{ provider: 'OTHER' }, { executor: 'WEB' }, { model: 'seedream' }, { requestedCount: 20 }, { characterId: 'aria' }, { priceCeilingUsd: 3 }])
    assert.throws(() => validateAriaPilotOrder({ ...authorized(), ...patch }), /inválida/);
  assert.throws(() => prepareAriaPilot(campaign, strategy, 'STRATEGY-ITEM-001', scene, ['UNKNOWN'], preparedAt), /Asset ID/);
  assert.throws(() => prepareAriaPilot(campaign, strategy, 'STRATEGY-ITEM-001', scene, ['B-BLUE-DUELIST', 'B-BLUE-DUELIST'], preparedAt), /duplicado/);
  assert.throws(() => prepareAriaPilot(campaign, { ...strategy, campaignId: 'CAMPAIGN-002' }, 'STRATEGY-ITEM-001', scene, [], preparedAt), /Revisión/);
});
test('only a matching, chronological real-result manifest with an image is accepted', () => {
  const valid = validateAriaPilotReceipt(receipt(), authorized());
  assert.equal(valid.ariaImageId, 'aria-image-123');
  assert.equal(valid.priceUsd, 0.039);
  for (const patch of [{ jobId: 'OTHER' }, { provider: 'OTHER' }, { model: 'seedream' }, { ariaImageId: '../bad' },
    { imageUrl: '' }, { imageUrl: 'http://example.org/image.jpg' }, { imageUrl: 'https://localhost/image.jpg' }, { priceUsd: 0.04 },
    { requestedAt: '2026-10-17T00:00:04Z' }, { completedAt: '2026-10-17T00:00:07Z' }])
    assert.throws(() => validateAriaPilotReceipt({ ...receipt(), ...patch }, authorized()));
});
test('invalid result can be corrected without mutating the order or accepting a partial image', () => {
  const order = authorized();
  const before = JSON.stringify(order);
  assert.throws(() => validateAriaPilotReceipt({ ...receipt(), imageUrl: undefined }, order), /sin imagen/);
  assert.equal(JSON.stringify(order), before);
  assert.equal(validateAriaPilotReceipt(receipt(), order).state, 'SUCCEEDED');
});
test('QA needs inspected pixels and notes; human approval needs QA PASS', () => {
  const result = validateAriaPilotReceipt(receipt(), authorized());
  assert.throws(() => recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Bien'), /Imagen verificada/);
  assert.throws(() => recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', '', inspected()), /texto|text|Observaciones/i);
  assert.throws(() => recordAriaPilotReview(result, undefined, 'HUMAN_APPROVE', '2026-10-17T00:00:10Z', undefined, inspected()), /QA visual PASS/);
  const qa = recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Rostro, manos, vestuario y luz revisados.', inspected());
  assert.equal(qa.imageSha256, fixtureDigest);
  assert.throws(() => recordAriaPilotReview(result, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z'), /Imagen verificada/);
  const approved = recordAriaPilotReview(result, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z', undefined, inspected());
  assert.equal(approved.humanDecision, 'APPROVED');
  assert.equal(approved.decidedBy, 'LUIS');
  assert.throws(() => recordAriaPilotReview(result, approved, 'QA_FAIL', '2026-10-17T00:00:12Z', 'Cambio', inspected()), /ya registrada/);
});
test('QA failure can be rejected, and time ordering prevents premature decisions', () => {
  const result = validateAriaPilotReceipt(receipt(), authorized());
  assert.throws(() => recordAriaPilotReview(result, undefined, 'QA_FAIL', '2026-10-17T00:00:08Z', 'Error visible', inspected()), /anterior/);
  const failed = recordAriaPilotReview(result, undefined, 'QA_FAIL', '2026-10-17T00:00:10Z', 'Manos incoherentes', inspected());
  assert.throws(() => recordAriaPilotReview(result, failed, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z', undefined, inspected()), /QA visual PASS/);
  assert.equal(recordAriaPilotReview(result, failed, 'HUMAN_REJECT', '2026-10-17T00:00:11Z', undefined, inspected()).humanDecision, 'REJECTED');
  assert.throws(() => recordAriaPilotReview(result, failed, 'HUMAN_REJECT', '2026-10-17T00:00:09Z', undefined, inspected()), /anterior a QA/);
});
test('polling stops at an explicit three-minute deadline without Date.now or automatic retry', () => {
  assert.equal(pilotPollDecision('2026-10-17T00:00:00Z', '2026-10-17T00:02:59Z'), 'CONTINUE');
  assert.equal(pilotPollDecision('2026-10-17T00:00:00Z', '2026-10-17T00:03:00Z'), 'TIMED_OUT');
  assert.throws(() => pilotPollDecision('2026-10-17T00:00:01Z', '2026-10-17T00:00:00Z'), /anterior/);
});
test('safe failure report records no partial image and can reconcile a later real receipt', () => {
  const order = authorized();
  const failure = validateAriaPilotFailure({ schemaVersion: 1, jobId: order.jobId, provider: 'ARIA_STUDIO', executor: 'CODEX_MCP',
    model: 'gptimg', state: 'TIMED_OUT', at: '2026-10-17T00:03:08Z', errorCode: 'TIMEOUT', ariaImageId: 'aria-image-123' }, order);
  assert.equal(failure.state, 'TIMED_OUT');
  assert.equal(failure.ariaImageId, 'aria-image-123');
  assert.equal(validateAriaPilotReceipt(receipt(), order, failure).ariaImageId, failure.ariaImageId);
  assert.throws(() => validateAriaPilotReceipt({ ...receipt(), ariaImageId: 'aria-image-other' }, order, failure), /no coincide/);
  const withoutImageId = validateAriaPilotFailure({ ...failure, ariaImageId: undefined }, order);
  assert.equal(validateAriaPilotReceipt(receipt(), order, withoutImageId).ariaImageId, 'aria-image-123');
  assert.throws(() => validateAriaPilotFailure({ ...failure, provider: 'OTHER' }, order), /Provenance/);
  assert.throws(() => validateAriaPilotFailure({ ...failure, errorCode: 'MCP_ERROR' }, order), /Estado/);
});
test('reconciliation keeps the known Aria ID and never mutates order, failure or QA on mismatch', () => {
  const order = authorized();
  const failure = validateAriaPilotFailure({ schemaVersion: 1, jobId: order.jobId, provider: 'ARIA_STUDIO', executor: 'CODEX_MCP',
    model: 'gptimg', state: 'TIMED_OUT', at: '2026-10-17T00:03:08Z', errorCode: 'TIMEOUT', ariaImageId: 'aria-image-123' }, order);
  const priorState = JSON.stringify({ order, failure });
  for (const ariaImageId of ['aria-image-other', undefined])
    assert.throws(() => reconcileAriaPilotFailure(failure, { ...failure, ariaImageId }, order), /sustituir/);
  assert.throws(() => reconcileAriaPilotReceipt(undefined, { ...receipt(), ariaImageId: 'aria-image-other' }, order, failure), /no coincide/);
  assert.throws(() => reconcileAriaPilotReceipt(undefined, { ...receipt(), jobId: 'different-job' }, order, failure), /Provenance/);
  assert.equal(JSON.stringify({ order, failure }), priorState);
  const result = reconcileAriaPilotReceipt(undefined, receipt(), order, failure);
  assert.equal(result.ariaImageId, 'aria-image-123');
  const review = recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:03:10Z', 'Verificado en Aria y píxeles inspeccionados.', inspected());
  const reviewedState = JSON.stringify({ order, failure, result, review });
  assert.throws(() => reconcileAriaPilotReceipt(result, { ...receipt(), ariaImageId: 'aria-image-other' }, order, failure, review), /ya están registrados/);
  assert.equal(JSON.stringify({ order, failure, result, review }), reviewedState);
});
test('an unidentified failure may gain an ID, but never lose it; manual Aria verification remains required', () => {
  const order = authorized();
  const unidentified = validateAriaPilotFailure({ schemaVersion: 1, jobId: order.jobId, provider: 'ARIA_STUDIO', executor: 'CODEX_MCP',
    model: 'gptimg', state: 'TIMED_OUT', at: '2026-10-17T00:03:08Z', errorCode: 'TIMEOUT' }, order);
  assert.equal(unidentified.ariaImageId, undefined);
  assert.equal(reconcileAriaPilotReceipt(undefined, receipt(), order, unidentified).ariaImageId, 'aria-image-123');
  const identified = reconcileAriaPilotFailure(unidentified, { ...unidentified, ariaImageId: 'aria-image-123' }, order);
  assert.equal(identified.ariaImageId, 'aria-image-123');
  assert.equal(unidentified.ariaImageId, undefined);
  assert.throws(() => reconcileAriaPilotFailure(identified, unidentified, order), /sustituir/);
  assert.throws(() => reconcileAriaPilotFailure(identified, { ...identified, at: '2026-10-17T00:03:07Z' }, order), /retroceder/);
  const html = renderToStaticMarkup(<AriaProductionPanel campaign={campaign} strategy={strategy} order={order}
    failure={unidentified} receipt={validateAriaPilotReceipt(receipt(), order, unidentified)} onOrder={() => {}} onReceipt={() => {}} isOrderCurrent={() => true} />);
  assert.match(html, /coteja ID e imagen directamente con la ejecución real en Aria/);
});
test('production UI clearly gates unapproved work and never pretends the Office is executing', () => {
  const empty = renderToStaticMarkup(<AriaProductionPanel campaign={campaign} strategy={{ ...strategy, status: 'DRAFT', approvedAt: undefined, approvedBy: undefined }} onOrder={() => {}} onReceipt={() => {}} isOrderCurrent={() => true} />);
  assert.match(empty, /Se requiere una Strategy APPROVED/);
  const html = renderToStaticMarkup(<AriaProductionPanel campaign={campaign} strategy={strategy} order={prepared()} onOrder={() => {}} onReceipt={() => {}} isOrderCurrent={() => true} />);
  assert.match(html, /HANDOFF CONTROLADO/);
  assert.match(html, /No se ha generado ninguna imagen/);
  assert.match(html, /confirmar el precio en Codex/);
});

function imageFixture(type: string, bytes: number[], size = bytes.length): PilotImageFile {
  return { type, size, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}
test('QA image gate rejects invalid bytes, MIME, empty files, decode errors and invisible pixels', async () => {
  const visible = async () => ({ width: 100, height: 100, visiblePixels: true });
  const expected = receipt();
  await assert.rejects(inspectPilotImageFile(imageFixture('text/plain', png), expected, visible), /PNG, JPEG o WebP/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png, 0), expected, visible), /PNG, JPEG o WebP/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', [1, 2, 3]), expected, visible), /formato/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), expected, async () => { throw new Error('decoder'); }), /decodificar/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), expected, async () => ({ width: 100, height: 100, visiblePixels: false })), /píxeles/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), expected, async () => ({ width: 0, height: 1, visiblePixels: true })), /píxeles/);
  assert.deepEqual(await inspectPilotImageFile(imageFixture('image/png', png), expected, visible),
    { ...await visible(), jobId: expected.jobId, ariaImageId: expected.ariaImageId, sha256: fixtureDigest, previewLoaded: false });
});
test('QA image gate waits for decoding rather than accepting an object URL alone', async () => {
  let finish!: (value: { width: number; height: number; visiblePixels: boolean }) => void;
  let entered!: () => void;
  const decoding = new Promise<void>(resolve => { entered = resolve; });
  const pending = inspectPilotImageFile(imageFixture('image/png', png), receipt(), () => new Promise(resolve => { finish = resolve; entered(); }));
  await decoding;
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish({ width: 2, height: 2, visiblePixels: true });
  await pending;
  assert.equal(settled, true);
});
test('a decoded local image is accepted only when its full-byte SHA-256 matches the receipt', async () => {
  const bytesB = [...png, 66];
  const receiptA = validateAriaPilotReceipt(receipt(), authorized());
  const visible = async () => ({ width: 4, height: 4, visiblePixels: true });
  const imageA = await inspectPilotImageFile(imageFixture('image/png', png), receiptA, visible);
  assert.equal(imageA.sha256, fixtureDigest);
  assert.equal(inspectionMatchesReceipt(imageA, receiptA), false);
  assert.equal(inspectionMatchesReceipt({ ...imageA, previewLoaded: true }, receiptA), true);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', bytesB), receiptA, visible), /huella.*no coincide/);
  assert.equal(inspectionMatchesReceipt({ ...imageA, previewLoaded: true }, { ...receiptA, ariaImageId: 'another-image' }), false);
});
test('missing, malformed and altered receipt digests never enable QA', async () => {
  const order = authorized();
  for (const imageSha256 of ['abc', fixtureDigest.toUpperCase(), '0'.repeat(63), 4])
    assert.throws(() => validateAriaPilotReceipt({ ...receipt(), imageSha256 }, order), /Huella SHA-256/);
  const missing = validateAriaPilotReceipt({ ...receipt(), imageSha256: undefined }, order);
  assert.equal(missing.imageSha256, undefined);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), missing, async () => ({ width: 2, height: 2, visiblePixels: true })), /no contiene una huella/);
  assert.throws(() => recordAriaPilotReview(missing, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Bien', inspected()), /Imagen verificada/);
  const altered = validateAriaPilotReceipt({ ...receipt(), imageSha256: '0'.repeat(64) }, order);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), altered, async () => ({ width: 2, height: 2, visiblePixels: true })), /huella.*no coincide/);
});
test('a QA record and human decision stay bound to job, Aria ID and inspected digest', () => {
  const result = validateAriaPilotReceipt(receipt(), authorized());
  const verified = inspected();
  for (const changed of [{ ...verified, sha256: '0'.repeat(64) }, { ...verified, ariaImageId: 'another-image' },
    { ...verified, jobId: 'another-job' }, { ...verified, previewLoaded: false }, { ...verified, width: 0 }])
    assert.throws(() => recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Bien', changed), /Imagen verificada/);
  const qa = recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Bien', verified);
  assert.deepEqual({ jobId: qa.jobId, ariaImageId: qa.ariaImageId, imageSha256: qa.imageSha256 },
    { jobId: result.jobId, ariaImageId: result.ariaImageId, imageSha256: fixtureDigest });
  assert.throws(() => recordAriaPilotReview(result, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z'), /Imagen verificada/);
  assert.throws(() => recordAriaPilotReview({ ...result, jobId: 'other-revision' }, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z', undefined, verified), /Imagen verificada/);
  assert.throws(() => recordAriaPilotReview({ ...result, imageSha256: '0'.repeat(64) }, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z', undefined,
    { ...verified, sha256: '0'.repeat(64) }), /Revisión de otro trabajo o imagen/);
  assert.equal(recordAriaPilotReview(result, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z', undefined, verified).humanDecision, 'APPROVED');
});
test('switching files during hashing or decoding ignores stale successes and failures', async () => {
  const visible = async () => ({ width: 2, height: 2, visiblePixels: true });
  const bytesB = [...png, 66];
  const receiptB = { ...receipt(), imageSha256: createHash('sha256').update(Uint8Array.from(bytesB)).digest('hex') };
  const selection = createPilotImageSelection();
  let finishHash!: (value: ArrayBuffer) => void;
  const slowHash: PilotImageFile = { type: 'image/png', size: png.length, arrayBuffer: () => new Promise(resolve => { finishHash = resolve; }) };
  const first = selection.inspect(slowHash, receipt(), visible);
  const second = await selection.inspect(imageFixture('image/png', bytesB), receiptB, visible);
  assert.equal(second?.sha256, receiptB.imageSha256);
  finishHash(Uint8Array.from(png).buffer);
  assert.equal(await first, undefined);
  assert.equal(inspectionMatchesReceipt({ ...second!, previewLoaded: true }, receipt()), false);

  let finishDecode!: (value: { width: number; height: number; visiblePixels: boolean }) => void;
  let entered!: () => void;
  const decoding = new Promise<void>(resolve => { entered = resolve; });
  const oldDecode = selection.inspect(imageFixture('image/png', png), receipt(), () => new Promise(resolve => { finishDecode = resolve; entered(); }));
  await decoding;
  selection.invalidate();
  finishDecode({ width: 2, height: 2, visiblePixels: true });
  assert.equal(await oldDecode, undefined);
  assert.equal(await selection.inspect(imageFixture('image/png', bytesB), receiptB, visible).then(value => value?.sha256), receiptB.imageSha256);
});
test('serial imports reconcile against current outcome in selection order, even when reads resolve out of order', async () => {
  const order = authorized();
  const failure = { schemaVersion: 1, jobId: order.jobId, provider: 'ARIA_STUDIO', executor: 'CODEX_MCP', model: 'gptimg',
    state: 'TIMED_OUT', at: '2026-10-17T00:03:08Z', errorCode: 'TIMEOUT', ariaImageId: 'aria-image-123' };
  for (const reversed of [false, true]) {
    let outcome: AriaPilotOutcome = {};
    const enqueue = createSerialAriaImports();
    let release!: () => void;
    const first = enqueue(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      outcome = reversed ? applyAriaPilotReceipt(outcome, receipt(), order) : applyAriaPilotFailure(outcome, failure, order);
    });
    const second = enqueue(async () => {
      outcome = reversed ? applyAriaPilotFailure(outcome, { ...failure, ariaImageId: 'aria-image-other' }, order)
        : applyAriaPilotReceipt(outcome, { ...receipt(), ariaImageId: 'aria-image-other' }, order);
    });
    await Promise.resolve();
    assert.deepEqual(outcome, {});
    release();
    await first;
    await assert.rejects(second);
    assert.equal(reversed ? outcome.receipt?.ariaImageId : outcome.failure?.ariaImageId, 'aria-image-123');
    assert.equal(reversed ? outcome.failure : outcome.receipt, undefined);
  }
});
test('invalid second import cannot erase failure, result or QA; valid reconciliation remains possible', async () => {
  const order = authorized();
  const failure = validateAriaPilotFailure({ schemaVersion: 1, jobId: order.jobId, provider: 'ARIA_STUDIO', executor: 'CODEX_MCP',
    model: 'gptimg', state: 'TIMED_OUT', at: '2026-10-17T00:03:08Z', errorCode: 'TIMEOUT', ariaImageId: 'aria-image-123' }, order);
  let outcome: AriaPilotOutcome = applyAriaPilotFailure({}, failure, order);
  const prior = structuredClone(outcome);
  assert.throws(() => applyAriaPilotFailure(outcome, { ...failure, ariaImageId: undefined }, order), /sustituir/);
  assert.throws(() => applyAriaPilotFailure(outcome, { ...failure, ariaImageId: 'aria-image-other' }, order), /sustituir/);
  assert.throws(() => applyAriaPilotReceipt(outcome, { ...receipt(), ariaImageId: 'aria-image-other' }, order), /no coincide/);
  assert.deepEqual(outcome, prior);
  outcome = applyAriaPilotReceipt(outcome, receipt(), order);
  const qa = recordAriaPilotReview(outcome.receipt!, undefined, 'QA_PASS', '2026-10-17T00:03:10Z', 'Inspección visual.', inspected());
  outcome = { ...outcome, review: qa };
  const reviewed = structuredClone(outcome);
  assert.throws(() => applyAriaPilotFailure(outcome, failure, order), /resultado o revisión/);
  assert.throws(() => applyAriaPilotReceipt(outcome, receipt(), order), /ya están registrados/);
  assert.deepEqual(outcome, reviewed);
});
