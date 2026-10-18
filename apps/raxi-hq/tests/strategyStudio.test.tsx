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
import { StrategyStudio } from '../src/campaigns/StrategyStudio';
import { StrategyForm } from '../src/campaigns/StrategyForm';
import { strategyDraftKey, withoutStrategyDraft } from '../src/campaigns/CampaignWorkspace';
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
test('submitting current form input atomically includes unsaved concept and matrix edits', () => {
  const draft = save();
  const edited = { ...input, creativeConcept: 'Concepto editado antes de enviar',
    deliverables: [{ ...input.deliverables[0], quantity: 3, purpose: 'Propósito editado' }] };
  const reviewed = reduceCampaignSession(draft, fixture().handoffs, {
    type: 'SUBMIT_STRATEGY_WITH_INPUT', campaignId: 'CAMPAIGN-001', revision: 1, input: edited, at: t3,
  });
  assert.equal(reviewed.strategies[0].status, 'IN_REVIEW');
  assert.equal(reviewed.strategies[0].creativeConcept, edited.creativeConcept);
  assert.deepEqual(reviewed.strategies[0].deliverables, edited.deliverables);
  assert.equal(reviewed.audit.length, draft.audit.length + 1);
  assert.equal(reviewed.audit.at(-1)?.action, 'STRATEGY_SUBMITTED');
  assert.equal(draft.strategies[0].status, 'DRAFT');
  assert.equal(draft.strategies[0].creativeConcept, input.creativeConcept);
});
test('invalid current form input or stale revision cannot partially submit a draft', () => {
  const draft = save();
  const before = structuredClone(draft);
  for (const invalid of [{ ...input, audience: '' }, { ...input, deliverables: [{ ...input.deliverables[0], quantity: 0 }] }]) {
    assert.throws(() => reduceCampaignSession(draft, fixture().handoffs, {
      type: 'SUBMIT_STRATEGY_WITH_INPUT', campaignId: 'CAMPAIGN-001', revision: 1, input: invalid, at: t3,
    }));
    assert.deepEqual(draft, before);
  }
  assert.throws(() => reduceCampaignSession(draft, fixture().handoffs, {
    type: 'SUBMIT_STRATEGY_WITH_INPUT', campaignId: 'CAMPAIGN-001', revision: 2, input, at: t3,
  }), /obsoleta/);
  assert.deepEqual(draft, before);
});
test('campaign transitions cannot precede the latest Strategy edit, submission or approval', () => {
  const { handoffs, planning } = fixture();
  const draft = save(planning, t3);
  for (const to of ['BLOCKED', 'CANCELED'] as const) {
    assert.throws(() => reduceCampaignSession(draft, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to, at: t2 }), /Cronología/);
    assert.equal(draft.campaigns[0].status, 'PLANNING');
    assert.equal(draft.strategies[0].status, 'DRAFT');
  }
  const submitted = submit(draft, t4);
  assert.throws(() => reduceCampaignSession(submitted, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'BLOCKED', at: t3 }), /Cronología/);
  const approved = approve(submitted, t5);
  assert.throws(() => reduceCampaignSession(approved, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'CANCELED', at: t4 }), /Cronología/);
  const blocked = reduceCampaignSession(approved, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'BLOCKED', at: t5 });
  assert.equal(blocked.strategies[0], approved.strategies[0]);
  assert.equal(blocked.strategies[0].status, 'APPROVED');
  const resumed = reduceCampaignSession(blocked, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'PLANNING', at: t6 });
  assert.equal(resumed.strategies[0], approved.strategies[0]);
  assert.equal(resumed.campaigns[0].status, 'PLANNING');
  assert.equal(resumed.audit.at(-1)?.action, 'CAMPAIGN_UNBLOCKED');
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
  assert.equal(next.strategies[1].revisionReason, 'Nuevo ángulo');
  assert.equal(next.strategies[1].changeReason, undefined);
  const edited = save(next, t6, { ...input, creativeConcept: 'Nuevo concepto' });
  assert.equal(edited.strategies[1].revisionReason, 'Nuevo ángulo');
  assert.equal(edited.strategies[0].creativeConcept, input.creativeConcept);
});
test('opening and requested-change reasons remain distinct through three revisions', () => {
  const { handoffs } = fixture();
  const approved1 = approve();
  const opened2 = reduceCampaignSession(approved1, handoffs, { type: 'START_STRATEGY_REVISION', campaignId: 'CAMPAIGN-001', revision: 1, confirmed: true, reason: 'A: explorar otro ángulo', at: t5 });
  assert.equal(opened2.strategies[1].revisionReason, 'A: explorar otro ángulo');
  assert.equal(opened2.strategies[1].changeReason, undefined);
  const saved2 = save(opened2, t6, { ...input, creativeConcept: 'Segunda propuesta' });
  assert.equal(saved2.strategies[1].revisionReason, 'A: explorar otro ángulo');
  const submitted2 = reduceCampaignSession(saved2, handoffs, { type: 'SUBMIT_STRATEGY_WITH_INPUT', campaignId: 'CAMPAIGN-001', revision: 2, input: { ...input, creativeConcept: 'Edición final de revisión 2' }, at: '2026-10-17T00:00:07Z' });
  assert.equal(submitted2.strategies[1].revisionReason, 'A: explorar otro ángulo');
  assert.equal(submitted2.strategies[1].creativeConcept, 'Edición final de revisión 2');
  const requested2 = reduceCampaignSession(submitted2, handoffs, { type: 'REQUEST_STRATEGY_CHANGES', campaignId: 'CAMPAIGN-001', revision: 2, reason: 'B: ajustar la historia', at: '2026-10-17T00:00:08Z' });
  assert.equal(requested2.strategies[1].revisionReason, 'A: explorar otro ángulo');
  assert.equal(requested2.strategies[1].changeReason, 'B: ajustar la historia');
  assert.equal(requested2.strategies[0], approved1.strategies[0]);
  assert.ok(Object.isFrozen(requested2.strategies[0]));
  const opened3 = reduceCampaignSession(requested2, handoffs, { type: 'START_STRATEGY_REVISION', campaignId: 'CAMPAIGN-001', revision: 2, confirmed: true, at: '2026-10-17T00:00:09Z' });
  assert.equal(opened3.strategies[1], requested2.strategies[1]);
  assert.equal(opened3.strategies[2].revisionReason, undefined);
  assert.equal(opened3.strategies[2].changeReason, undefined);
  const html = renderToStaticMarkup(<StrategyStudio campaign={opened3.campaigns[0]} session={opened3} onAction={() => true} />);
  assert.match(html, /Motivo de apertura de revisión: A: explorar otro ángulo/);
  assert.match(html, /Cambios solicitados: B: ajustar la historia/);
  assert.doesNotMatch(html, /Motivo: B: ajustar la historia/);
});
test('approval and ordinary submit preserve the opening reason without inventing requested changes', () => {
  const { handoffs } = fixture();
  const approved1 = approve();
  const opened2 = reduceCampaignSession(approved1, handoffs, { type: 'START_STRATEGY_REVISION', campaignId: 'CAMPAIGN-001', revision: 1, confirmed: true, reason: 'Nueva dirección', at: t5 });
  const submitted2 = reduceCampaignSession(opened2, handoffs, { type: 'SUBMIT_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 2, at: t6 });
  assert.equal(submitted2.strategies[1].revisionReason, 'Nueva dirección');
  const approved2 = reduceCampaignSession(submitted2, handoffs, { type: 'APPROVE_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 2, confirmed: true, at: '2026-10-17T00:00:07Z' });
  assert.equal(approved2.strategies[1].revisionReason, 'Nueva dirección');
  assert.equal(approved2.strategies[1].changeReason, undefined);
  assert.equal(approved2.strategies[0], approved1.strategies[0]);
  assert.ok(Object.isFrozen(approved2.strategies[1]));
});
test('empty, unsafe and oversized reasons reject atomically without partial audit', () => {
  const { handoffs } = fixture();
  const approved1 = approve();
  const before = structuredClone(approved1);
  for (const reason of ['', '   ', '\u0000', '\u001b', 'x'.repeat(1501)]) {
    assert.throws(() => reduceCampaignSession(approved1, handoffs, { type: 'START_STRATEGY_REVISION', campaignId: 'CAMPAIGN-001', revision: 1, confirmed: true, reason, at: t5 }));
    assert.deepEqual(approved1, before);
  }
  const opened2 = reduceCampaignSession(approved1, handoffs, { type: 'START_STRATEGY_REVISION', campaignId: 'CAMPAIGN-001', revision: 1, confirmed: true, reason: 'x'.repeat(1500), at: t5 });
  const submitted2 = reduceCampaignSession(opened2, handoffs, { type: 'SUBMIT_STRATEGY', campaignId: 'CAMPAIGN-001', revision: 2, at: t6 });
  const submittedBefore = structuredClone(submitted2);
  for (const reason of ['', '   ', '\u0000', '\u001b', 'x'.repeat(1501)]) {
    assert.throws(() => reduceCampaignSession(submitted2, handoffs, { type: 'REQUEST_STRATEGY_CHANGES', campaignId: 'CAMPAIGN-001', revision: 2, reason, at: '2026-10-17T00:00:07Z' }));
    assert.deepEqual(submitted2, submittedBefore);
  }
  const valid = reduceCampaignSession(submitted2, handoffs, { type: 'REQUEST_STRATEGY_CHANGES', campaignId: 'CAMPAIGN-001', revision: 2, reason: 'y'.repeat(1500), at: '2026-10-17T00:00:07Z' });
  assert.equal(valid.strategies[1].revisionReason?.length, 1500);
  assert.equal(valid.strategies[1].changeReason?.length, 1500);
  assert.equal(valid.audit.length, submitted2.audit.length + 1);
});
test('revision validation rejects invalid opening and change reasons independently', () => {
  const state = save();
  const campaign = state.campaigns[0];
  for (const field of ['revisionReason', 'changeReason'] as const) {
    for (const reason of ['', '\u0000', 'x'.repeat(1501)]) {
      assert.throws(() => validateStrategyRevision({ ...state.strategies[0], [field]: reason }, campaign));
    }
  }
  const both = validateStrategyRevision({ ...state.strategies[0], revisionReason: 'Abrir\nrevisión', changeReason: 'Cambios\nsolicitados' }, campaign);
  assert.equal(both.revisionReason, 'Abrir\nrevisión');
  assert.equal(both.changeReason, 'Cambios\nsolicitados');
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
test('editing drafts remain isolated by campaign and revision during A to B to A navigation', () => {
  const first = { ...input, audience: 'Audiencia A pendiente', notes: 'Nota A', deliverables: [{ ...input.deliverables[0], quantity: 4 }] };
  const second = { ...input, audience: 'Audiencia B pendiente', notes: 'Nota B' };
  const drafts = { [strategyDraftKey('CAMPAIGN-001', 1)]: first, [strategyDraftKey('CAMPAIGN-002', 1)]: second };
  assert.deepEqual(drafts[strategyDraftKey('CAMPAIGN-001', 1)], first);
  assert.deepEqual(drafts[strategyDraftKey('CAMPAIGN-002', 1)], second);
  assert.equal(drafts[strategyDraftKey('CAMPAIGN-001', 2)], undefined);
  assert.deepEqual(withoutStrategyDraft(drafts, strategyDraftKey('CAMPAIGN-001', 1)), { [strategyDraftKey('CAMPAIGN-002', 1)]: second });
});
test('a remounted form restores every pending field, notes and complete matrix', () => {
  const pending = { ...input, audience: 'A pendiente', audienceNeed: 'Necesidad pendiente', creativeConcept: 'Concepto pendiente',
    narrativeApproach: 'Narrativa pendiente', visualDirection: 'Visual pendiente', toneOfVoice: 'Voz pendiente',
    desiredAudienceResponse: 'Respuesta pendiente', successCriteria: 'Éxito pendiente', notes: 'Notas pendientes',
    deliverables: [{ ...input.deliverables[0], purpose: 'Propósito pendiente', creativeAngle: 'Ángulo pendiente', quantity: 5 },
      { ...input.deliverables[0], id: 'STRATEGY-ITEM-002', purpose: 'Segunda pieza', quantity: 1 }] };
  const html = renderToStaticMarkup(<StrategyForm campaign={fixture().planning.campaigns[0]} revision={save().strategies[0]} draft={pending} onSave={() => true} />);
  for (const value of [pending.audience, pending.audienceNeed, pending.creativeConcept, pending.narrativeApproach,
    pending.visualDirection, pending.toneOfVoice, pending.desiredAudienceResponse, pending.successCriteria,
    pending.notes, pending.deliverables[0].purpose, pending.deliverables[0].creativeAngle, pending.deliverables[1].purpose]) assert.ok(html.includes(value));
  assert.match(html, /STRATEGY-ITEM-002/);
  assert.match(html, /value="5"/);
});
test('dirty draft is visible in planning and blocked modes without editing an approved snapshot', () => {
  const { handoffs } = fixture();
  const planning = save();
  const pending = { ...input, creativeConcept: 'Cambio sin guardar' };
  const plannedHtml = renderToStaticMarkup(<StrategyStudio campaign={planning.campaigns[0]} session={planning} onAction={() => true} draft={pending} onDiscardDraft={() => {}} />);
  assert.match(plannedHtml, /CAMBIOS SIN GUARDAR · LOCAL · SESIÓN/);
  assert.match(plannedHtml, /Descartar cambios sin guardar/);
  const blocked = reduceCampaignSession(planning, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'BLOCKED', at: t3 });
  const blockedHtml = renderToStaticMarkup(<StrategyStudio campaign={blocked.campaigns[0]} session={blocked} onAction={() => true} draft={pending} />);
  assert.match(blockedHtml, /Campaña bloqueada. Reanuda planificación para continuar/);
  assert.match(blockedHtml, /CAMBIOS SIN GUARDAR/);
  assert.doesNotMatch(blockedHtml, /<form/);
  const approved = approve();
  assert.equal(approved.strategies[0].creativeConcept, input.creativeConcept);
  assert.ok(Object.isFrozen(approved.strategies[0]));
});
test('terminal cancellation explains read-only status and never offers an editable form', () => {
  const { handoffs } = fixture();
  const planned = save();
  const canceled = reduceCampaignSession(planned, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'CANCELED', at: t3 });
  const html = renderToStaticMarkup(<StrategyStudio campaign={canceled.campaigns[0]} session={canceled} onAction={() => true} draft={{ ...input, notes: 'Pendiente' }} />);
  assert.match(html, /Campaña cancelada. Estado terminal; estrategia disponible únicamente para consulta/);
  assert.match(html, /Borrador pendiente conservado solo en esta sesión/);
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(html, /Enviar a revisión/);
});
test('draft campaign message offers planning instead of impossible resume action', () => {
  const { created } = fixture();
  const html = renderToStaticMarkup(<StrategyStudio campaign={created.campaigns[0]} session={created} onAction={() => true} />);
  assert.match(html, /Inicia la planificación para comenzar Strategy/);
  assert.doesNotMatch(html, /Reanuda planificación/);
});
test('invalid edited form leaves the draft and canonical revision untouched until explicit discard', () => {
  const saved = save();
  const invalid = { ...input, audience: '' };
  const key = strategyDraftKey('CAMPAIGN-001', 1);
  const drafts = { [key]: invalid };
  assert.throws(() => reduceCampaignSession(saved, fixture().handoffs, { type: 'SUBMIT_STRATEGY_WITH_INPUT', campaignId: 'CAMPAIGN-001', revision: 1, input: drafts[key], at: t3 }));
  assert.equal(drafts[key], invalid);
  assert.equal(saved.strategies[0].status, 'DRAFT');
  assert.equal(saved.strategies[0].audience, input.audience);
  assert.equal(saved.audit.at(-1)?.action, 'STRATEGY_CREATED');
  assert.equal(withoutStrategyDraft(drafts, key)[key], undefined);
});
test('chronology guard rejects transitions before a Strategy edit even after blocking', () => {
  const { handoffs } = fixture();
  const edited = save(fixture().planning, t3);
  const blocked = reduceCampaignSession(edited, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'BLOCKED', at: t4 });
  assert.throws(() => reduceCampaignSession(blocked, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'PLANNING', at: t2 }), /Cronología/);
  assert.throws(() => reduceCampaignSession(edited, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'CANCELED', at: t2 }), /Cronología/);
  assert.equal(blocked.strategies[0], edited.strategies[0]);
});
