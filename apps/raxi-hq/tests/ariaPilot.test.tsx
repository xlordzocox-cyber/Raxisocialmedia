import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import catalog from '../../../content/asset-library/ASSET_CATALOG.json';
import type { CampaignRecord } from '../src/campaigns/campaignContracts';
import type { CampaignStrategyRevision } from '../src/campaigns/strategyContracts';
import { AriaProductionPanel } from '../src/production/AriaProductionPanel';
import { applyAriaPilotFailure, applyAriaPilotReceipt, authorizeAriaPilot, createSerialAriaImports, isAriaPilotOrderCurrent, PILOT_SOURCE_ASSET_IDS, pilotJobId, pilotPollDecision, prepareAriaPilot, reconcileAriaPilotFailure, reconcileAriaPilotOrder, reconcileAriaPilotReceipt, recordAriaPilotReview, validateAriaPilotFailure, validateAriaPilotOrder, validateAriaPilotReceipt, type AriaPilotOutcome } from '../src/production/ariaPilot';
import { inspectPilotImageFile, type PilotImageFile } from '../src/production/pilotImage';

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
  imageUrl: 'https://example.org/temporary-image.jpg', priceUsd: 0.039 }; }

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
  assert.throws(() => recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Bien', false), /Inspección/);
  assert.throws(() => recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', '', true), /texto|text|Observaciones/i);
  assert.throws(() => recordAriaPilotReview(result, undefined, 'HUMAN_APPROVE', '2026-10-17T00:00:10Z'), /QA visual PASS/);
  const qa = recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:00:10Z', 'Rostro, manos, vestuario y luz revisados.', true);
  assert.throws(() => recordAriaPilotReview(result, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z'), /Imagen verificada/);
  const approved = recordAriaPilotReview(result, qa, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z', undefined, true);
  assert.equal(approved.humanDecision, 'APPROVED');
  assert.equal(approved.decidedBy, 'LUIS');
  assert.throws(() => recordAriaPilotReview(result, approved, 'QA_FAIL', '2026-10-17T00:00:12Z', 'Cambio', true), /ya registrada/);
});
test('QA failure can be rejected, and time ordering prevents premature decisions', () => {
  const result = validateAriaPilotReceipt(receipt(), authorized());
  assert.throws(() => recordAriaPilotReview(result, undefined, 'QA_FAIL', '2026-10-17T00:00:08Z', 'Error visible', true), /anterior/);
  const failed = recordAriaPilotReview(result, undefined, 'QA_FAIL', '2026-10-17T00:00:10Z', 'Manos incoherentes', true);
  assert.throws(() => recordAriaPilotReview(result, failed, 'HUMAN_APPROVE', '2026-10-17T00:00:11Z'), /QA visual PASS/);
  assert.equal(recordAriaPilotReview(result, failed, 'HUMAN_REJECT', '2026-10-17T00:00:11Z').humanDecision, 'REJECTED');
  assert.throws(() => recordAriaPilotReview(result, failed, 'HUMAN_REJECT', '2026-10-17T00:00:09Z'), /anterior a QA/);
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
  const review = recordAriaPilotReview(result, undefined, 'QA_PASS', '2026-10-17T00:03:10Z', 'Verificado en Aria y píxeles inspeccionados.', true);
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
    failure={unidentified} receipt={validateAriaPilotReceipt(receipt(), order, unidentified)} onOrder={() => {}} onReceipt={() => {}} />);
  assert.match(html, /Comprueba el ID directamente en Aria/);
});
test('production UI clearly gates unapproved work and never pretends the Office is executing', () => {
  const empty = renderToStaticMarkup(<AriaProductionPanel campaign={campaign} strategy={{ ...strategy, status: 'DRAFT', approvedAt: undefined, approvedBy: undefined }} onOrder={() => {}} onReceipt={() => {}} />);
  assert.match(empty, /Se requiere una Strategy APPROVED/);
  const html = renderToStaticMarkup(<AriaProductionPanel campaign={campaign} strategy={strategy} order={prepared()} onOrder={() => {}} onReceipt={() => {}} />);
  assert.match(html, /HANDOFF CONTROLADO/);
  assert.match(html, /No se ha generado ninguna imagen/);
  assert.match(html, /confirmar el precio en Codex/);
});

function imageFixture(type: string, bytes: number[], size = bytes.length): PilotImageFile {
  return { type, size, slice: () => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer }) };
}
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0];
test('QA image gate rejects invalid bytes, MIME, empty files, decode errors and invisible pixels', async () => {
  const visible = async () => ({ width: 100, height: 100, visiblePixels: true });
  await assert.rejects(inspectPilotImageFile(imageFixture('text/plain', png), visible), /PNG, JPEG o WebP/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png, 0), visible), /PNG, JPEG o WebP/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', [1, 2, 3]), visible), /formato/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), async () => { throw new Error('decoder'); }), /decodificar/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), async () => ({ width: 100, height: 100, visiblePixels: false })), /píxeles/);
  await assert.rejects(inspectPilotImageFile(imageFixture('image/png', png), async () => ({ width: 0, height: 1, visiblePixels: true })), /píxeles/);
  assert.deepEqual(await inspectPilotImageFile(imageFixture('image/png', png), visible), await visible());
});
test('QA image gate waits for decoding rather than accepting an object URL alone', async () => {
  let finish!: (value: { width: number; height: number; visiblePixels: boolean }) => void;
  const pending = inspectPilotImageFile(imageFixture('image/png', png), () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish({ width: 2, height: 2, visiblePixels: true });
  await pending;
  assert.equal(settled, true);
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
  const qa = recordAriaPilotReview(outcome.receipt!, undefined, 'QA_PASS', '2026-10-17T00:03:10Z', 'Inspección visual.', true);
  outcome = { ...outcome, review: qa };
  const reviewed = structuredClone(outcome);
  assert.throws(() => applyAriaPilotFailure(outcome, failure, order), /resultado o revisión/);
  assert.throws(() => applyAriaPilotReceipt(outcome, receipt(), order), /ya están registrados/);
  assert.deepEqual(outcome, reviewed);
});
