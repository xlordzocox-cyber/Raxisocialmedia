import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadMockIdeaCenter } from '../src/ideas/mockIdeas';
import { createIdeaCenterSession, reduceIdeaCenterSession } from '../src/ideas/ideaCenterSession';
import { createCampaignSession, currentStrategy, dispatchCampaignAction, reduceCampaignSession, type CampaignSession } from '../src/campaigns/campaignSession';
import type { CampaignBriefInput } from '../src/campaigns/campaignContracts';
import type { CampaignStrategyInput } from '../src/campaigns/strategyContracts';
import { MAX_STRATEGY_REVISIONS, validateCampaignStrategyInput, validateStrategyRevision } from '../src/campaigns/strategyValidation';
import { confirmationForStrategy } from '../src/campaigns/StrategyStudio';
import { CampaignWorkspace } from '../src/campaigns/CampaignWorkspace';

const t0 = '2026-10-17T00:00:00Z';
const t1 = '2026-10-17T00:00:01Z';
const t2 = '2026-10-17T00:00:02Z';
const t3 = '2026-10-17T00:00:03Z';
const t4 = '2026-10-17T00:00:04Z';
const t5 = '2026-10-17T00:00:05Z';
const t6 = '2026-10-17T00:00:06Z';
const brief: CampaignBriefInput = { title: 'Raxi gamer', objective: 'Comunidad', priority: 'HIGH',
  channels: ['INSTAGRAM_REEL', 'FANVIEW_FEED'], contentLevels: ['PUBLIC_SOCIAL', 'FANVIEW_FEED'], keyMessage: 'Noche gamer' };
const input: CampaignStrategyInput = { audience: 'Personas adultas interesadas en gaming', audienceNeed: 'Conexión con una historia',
  creativeConcept: 'Noche arcade', narrativeApproach: 'Llegada, partida y cierre', visualDirection: 'Luz cian y lila',
  toneOfVoice: 'Natural y juguetón', desiredAudienceResponse: 'Conversación', successCriteria: 'Revisar respuesta cualitativa',
  deliverables: [{ id: 'STRATEGY-ITEM-001', channel: 'INSTAGRAM_REEL', contentLevel: 'PUBLIC_SOCIAL', format: 'SHORT_VIDEO', quantity: 2,
    purpose: 'Descubrimiento', creativeAngle: 'Una partida inesperada' }] };
function fixture() {
  const sent = reduceIdeaCenterSession(createIdeaCenterSession(loadMockIdeaCenter().ideas), { type: 'SEND_TO_HQ', ideaId: 'IDEA-APPROVED-001', at: t0 });
  const handoffs = sent.handoffs;
  const created = reduceCampaignSession(createCampaignSession(), handoffs, { type: 'CREATE_CAMPAIGN', ideaId: 'IDEA-APPROVED-001', brief, at: t0 });
  const planning = reduceCampaignSession(created, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'PLANNING', at: t1 });
  return { handoffs, created, planning };
}
function save(state = fixture().planning, at = t2, value = input) {
  return reduceCampaignSession(state, fixture().handoffs, { type: 'SAVE_STRATEGY', campaignId: 'CAMPAIGN-001', input: value, at });
}
function submit(state = save(), at = t3) {
  return reduceCampaignSession(state, fixture().handoffs, { type: 'SUBMIT_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 1, at });
}
function approve(state = submit(), at = t4) {
  return reduceCampaignSession(state, fixture().handoffs, { type: 'APPROVE_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 1, confirmed: true, at });
}

test('absence derives NOT_STARTED; CampaignStatus stays independent from strategy approval', () => {
  const { planning } = fixture();
  assert.equal(currentStrategy(planning, 'CAMPAIGN-001'), undefined);
  assert.equal(planning.campaigns[0].status, 'PLANNING');
  assert.equal(approve().campaigns[0].status, 'PLANNING');
});
test('strategy creation requires existing PLANNING campaign and preserves provenance', () => {
  const { created, planning, handoffs } = fixture();
  assert.throws(() => reduceCampaignSession(created, handoffs, { type: 'SAVE_STRATEGY', campaignId: 'CAMPAIGN-001', input, at: t2 }), /planificación/);
  assert.throws(() => reduceCampaignSession(planning, handoffs, { type: 'SAVE_STRATEGY', campaignId: 'CAMPAIGN-999', input, at: t2 }), /inexistente/);
  const saved = save();
  assert.equal(saved.strategies.length, 1);
  assert.equal(saved.strategies[0].status, 'DRAFT');
  assert.equal(saved.strategies[0].revision, 1);
  assert.equal(saved.campaigns[0].provenance, planning.campaigns[0].provenance);
  assert.equal(saved.audit.at(-1)?.action, 'STRATEGY_CREATED');
});
test('BLOCKED and CANCELED campaigns are read-only at reducer boundary', () => {
  const { handoffs, planning } = fixture();
  const blocked = reduceCampaignSession(planning, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'BLOCKED', at: t2 });
  const canceled = reduceCampaignSession(planning, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'CANCELED', at: t2 });
  for (const state of [blocked, canceled]) assert.throws(() => reduceCampaignSession(state, handoffs, { type: 'SAVE_STRATEGY', campaignId: 'CAMPAIGN-001', input, at: t3 }), /planificación/);
  assert.deepEqual(blocked.strategies, []);
  assert.deepEqual(canceled.strategies, []);
});
test('strategy input requires all narrative fields and a deliverable', () => {
  const campaign = fixture().planning.campaigns[0];
  assert.throws(() => validateCampaignStrategyInput({ ...input, audience: '' }, campaign));
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: [] }, campaign));
  assert.equal(validateCampaignStrategyInput(input, campaign).creativeConcept, input.creativeConcept);
});
test('matrix rejects channels outside brief and private levels on public channels', () => {
  const campaign = fixture().planning.campaigns[0];
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: [{ ...input.deliverables[0], channel: 'INSTAGRAM_STORY' }] }, campaign), /autorizado/);
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: [{ ...input.deliverables[0], contentLevel: 'FANVIEW_FEED' }] }, campaign), /incompatible/);
  assert.equal(validateCampaignStrategyInput({ ...input, deliverables: [{ ...input.deliverables[0], channel: 'FANVIEW_FEED', contentLevel: 'FANVIEW_FEED' }] }, campaign).deliverables.length, 1);
});
test('matrix validates integer quantities, total cap, row cap and duplicate IDs', () => {
  const campaign = fixture().planning.campaigns[0];
  for (const quantity of [0, 31, 1.5, NaN]) assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: [{ ...input.deliverables[0], quantity }] }, campaign));
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: [{ ...input.deliverables[0], quantity: 20 }, { ...input.deliverables[0], id: 'STRATEGY-ITEM-002', quantity: 11 }] }, campaign), /total/);
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: [input.deliverables[0], input.deliverables[0]] }, campaign), /duplicado/);
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: Array.from({ length: 13 }, (_, i) => ({ ...input.deliverables[0], id: `STRATEGY-ITEM-${String(i + 1).padStart(3, '0')}` })) }, campaign), /Límite/);
});
test('matrix rejects sparse, inherited, accessor and mutating collections before mapping', () => {
  const campaign = fixture().planning.campaigns[0];
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: Array(1) }, campaign));
  const inherited = Array(1); Object.setPrototypeOf(inherited, { 0: input.deliverables[0] });
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: inherited }, campaign));
  const accessor = [input.deliverables[0]];
  Object.defineProperty(accessor, 0, { get() { accessor.push(input.deliverables[0]); return input.deliverables[0]; } });
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: accessor }, campaign));
  const falseLength = new Proxy([input.deliverables[0]], { get(target, key, receiver) { return key === 'length' ? -1 : Reflect.get(target, key, receiver); } });
  assert.throws(() => validateCampaignStrategyInput({ ...input, deliverables: falseLength }, campaign));
});
test('brief without a compatible channel-level pair explains why Strategy cannot start', () => {
  const { planning } = fixture();
  const incompatible: CampaignSession = { ...planning, campaigns: [{ ...planning.campaigns[0], channels: ['INSTAGRAM_REEL'], contentLevels: ['FANVIEW_CHAT'] }] };
  const html = renderToStaticMarkup(<CampaignWorkspace id="workspace" session={incompatible} open selectedId="CAMPAIGN-001" onSelect={() => {}} onAction={() => true} />);
  assert.match(html, /no tiene una combinación compatible/);
  assert.throws(() => validateCampaignStrategyInput(input, incompatible.campaigns[0]), /autorizado/);
});
test('save is atomic and edits only DRAFT', () => {
  const initial = save();
  assert.throws(() => save(initial, t3, { ...input, successCriteria: '' }));
  assert.equal(initial.strategies[0].successCriteria, input.successCriteria);
  const updated = save(initial, t3, { ...input, creativeConcept: 'Otra idea' });
  assert.equal(updated.strategies.length, 1);
  assert.equal(updated.strategies[0].creativeConcept, 'Otra idea');
  assert.equal(updated.audit.at(-1)?.action, 'STRATEGY_UPDATED');
  assert.throws(() => save(submit(), t4), /borrador/);
});
test('submit requires DRAFT and current revision; duplicate action is rejected', () => {
  const state = submit();
  assert.equal(currentStrategy(state, 'CAMPAIGN-001')?.status, 'IN_REVIEW');
  assert.throws(() => reduceCampaignSession(state, fixture().handoffs, { type: 'SUBMIT_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 1, at: t4 }));
  assert.throws(() => reduceCampaignSession(state, fixture().handoffs, { type: 'APPROVE_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 2, confirmed: true, at: t4 }), /obsoleta/);
});
test('approval requires human confirmation, IN_REVIEW and records immutable evidence', () => {
  const state = submit();
  assert.throws(() => reduceCampaignSession(state, fixture().handoffs, { type: 'APPROVE_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 1, confirmed: false, at: t4 }), /explícita/);
  const approved = approve(state);
  const revision = approved.strategies[0];
  assert.equal(revision.status, 'APPROVED');
  assert.equal(revision.approvedAt, t4);
  assert.equal(revision.approvedBy, 'LUIS');
  assert.ok(Object.isFrozen(revision) && Object.isFrozen(revision.deliverables) && Object.isFrozen(revision.deliverables[0]));
  assert.equal(approved.audit.at(-1)?.action, 'STRATEGY_APPROVED');
  assert.throws(() => save(approved, t5), /borrador/);
});
test('changes require a reason, then controlled new DRAFT revision', () => {
  const state = submit();
  assert.throws(() => reduceCampaignSession(state, fixture().handoffs, { type: 'REQUEST_STRATEGY_CHANGES', campaignId: 'CAMPAIGN-001', revision: 1, reason: '', at: t4 }));
  const changed = reduceCampaignSession(state, fixture().handoffs, { type: 'REQUEST_STRATEGY_CHANGES', campaignId: 'CAMPAIGN-001', revision: 1, reason: 'Revisar\nla historia', at: t4 });
  assert.equal(changed.strategies[0].status, 'CHANGES_REQUESTED');
  assert.equal(changed.strategies[0].changeReason, 'Revisar\nla historia');
  const next = reduceCampaignSession(changed, fixture().handoffs, { type: 'START_STRATEGY_REVISION', campaignId: 'CAMPAIGN-001', revision: 1, confirmed: true, at: t5 });
  assert.deepEqual(next.strategies.map(item => [item.revision, item.status]), [[1, 'CHANGES_REQUESTED'], [2, 'DRAFT']]);
  assert.equal(next.audit.at(-1)?.action, 'STRATEGY_REVISION_STARTED');
});
test('approved revision needs explicit reason and confirmation for a new draft, never inherits approval', () => {
  const state = approve();
  const action = { type: 'START_STRATEGY_REVISION' as const, campaignId: 'CAMPAIGN-001', revision: 1, at: t5 };
  assert.throws(() => reduceCampaignSession(state, fixture().handoffs, { ...action, confirmed: false, reason: 'Nuevo ángulo' }));
  assert.throws(() => reduceCampaignSession(state, fixture().handoffs, { ...action, confirmed: true }));
  const next = reduceCampaignSession(state, fixture().handoffs, { ...action, confirmed: true, reason: 'Nuevo ángulo' });
  assert.equal(next.strategies[0], state.strategies[0]);
  assert.equal(next.strategies[0].status, 'APPROVED');
  assert.equal(next.strategies[1].status, 'DRAFT');
  assert.equal(next.strategies[1].approvedAt, undefined);
  assert.equal(next.strategies[1].changeReason, 'Nuevo ángulo');
  const edited = save(next, t6, { ...input, creativeConcept: 'Nuevo concepto' });
  assert.equal(edited.strategies[1].changeReason, 'Nuevo ángulo');
  assert.equal(edited.strategies[0].creativeConcept, input.creativeConcept);
});
test('revision cap is enforced before creating another record', () => {
  const state = approve();
  const inflated: CampaignSession = { ...state, strategies: [validateStrategyRevision({ ...state.strategies[0], revision: MAX_STRATEGY_REVISIONS }, state.campaigns[0])] };
  assert.throws(() => reduceCampaignSession(inflated, fixture().handoffs, { type: 'START_STRATEGY_REVISION', campaignId: 'CAMPAIGN-001', revision: MAX_STRATEGY_REVISIONS, confirmed: true, reason: 'Nueva dirección', at: t5 }), /Límite/);
});
test('blocked campaign preserves strategy and resumes without changing it', () => {
  const state = save();
  const blocked = reduceCampaignSession(state, fixture().handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'BLOCKED', at: t3 });
  assert.equal(blocked.strategies[0], state.strategies[0]);
  assert.throws(() => reduceCampaignSession(blocked, fixture().handoffs, { type: 'SUBMIT_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 1, at: t4 }));
  const resumed = reduceCampaignSession(blocked, fixture().handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'PLANNING', at: t4 });
  assert.equal(resumed.strategies[0], state.strategies[0]);
  assert.equal(reduceCampaignSession(resumed, fixture().handoffs, { type: 'SUBMIT_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 1, at: t5 }).strategies[0].status, 'IN_REVIEW');
});
test('pending confirmation is scoped to campaign and revision; cancellation is non-mutating', () => {
  const pending = { campaignId: 'CAMPAIGN-001', revision: 1, action: 'APPROVE' as const };
  assert.equal(confirmationForStrategy(pending, 'CAMPAIGN-001', 1), pending);
  assert.equal(confirmationForStrategy(pending, 'CAMPAIGN-002', 1), undefined);
  assert.equal(confirmationForStrategy(pending, 'CAMPAIGN-001', 2), undefined);
  assert.deepEqual(submit(), submit());
});
test('timestamp actions are deterministic and never use render-time clock', () => {
  const run = () => dispatchCampaignAction(fixture().planning, fixture().handoffs, () => t2, { type: 'SAVE_STRATEGY', campaignId: 'CAMPAIGN-001', input });
  assert.deepEqual(run(), run());
  assert.equal(run().strategies[0].createdAt, t2);
  assert.throws(() => save(fixture().planning, t0), /Cronología/);
});
test('renderer escapes hostile text and presents Strategy as available without external links', () => {
  const state = save(fixture().planning, t2, { ...input, creativeConcept: '<script>alert(1)</script>' });
  const html = renderToStaticMarkup(<CampaignWorkspace id="workspace" session={state} open selectedId="CAMPAIGN-001" onSelect={() => {}} onAction={() => true} />);
  assert.match(html, /Strategy · Disponible/);
  assert.match(html, /LOCAL · SESIÓN/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href=/);
});
test('review screen exposes every strategic field and the matrix before human approval', () => {
  const state = submit();
  const html = renderToStaticMarkup(<CampaignWorkspace id="workspace" session={state} open selectedId="CAMPAIGN-001" onSelect={() => {}} onAction={() => true} />);
  for (const value of [input.audience, input.audienceNeed, input.creativeConcept, input.narrativeApproach,
    input.visualDirection, input.toneOfVoice, input.desiredAudienceResponse, input.successCriteria,
    input.deliverables[0].purpose, input.deliverables[0].creativeAngle]) assert.ok(html.includes(value));
  assert.match(html, /<details open=""/);
});
test('no strategy is invented for a campaign without an explicit save', () => {
  const state = fixture().planning;
  const html = renderToStaticMarkup(<CampaignWorkspace id="workspace" session={state} open selectedId="CAMPAIGN-001" onSelect={() => {}} onAction={() => true} />);
  assert.match(html, /No iniciada/);
  assert.equal(state.strategies.length, 0);
});
