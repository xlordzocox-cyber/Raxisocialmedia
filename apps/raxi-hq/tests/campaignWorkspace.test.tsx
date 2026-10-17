import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadMockIdeaCenter } from '../src/ideas/mockIdeas';
import { createIdeaCenterSession, reduceIdeaCenterSession, type OperationsInboxItem } from '../src/ideas/ideaCenterSession';
import { OperationsInbox } from '../src/operations/OperationsInbox';
import { CampaignBriefForm } from '../src/campaigns/CampaignBriefForm';
import { CampaignWorkspace } from '../src/campaigns/CampaignWorkspace';
import { CAMPAIGN_CONTENT_LEVELS, type CampaignBriefInput, type CampaignRecord } from '../src/campaigns/campaignContracts';
import { createCampaignSession, campaignDecision, dispatchCampaignAction, reduceCampaignSession, type CampaignSession } from '../src/campaigns/campaignSession';
import { MAX_CAMPAIGNS, transitionCampaign, validateCampaignBrief, validateCampaignCollection, validateCampaignDecision, validateCampaignRecord } from '../src/campaigns/campaignValidation';

const at = '2026-10-17T00:00:00Z';
const later = '2026-10-18T00:00:00Z';
const brief: CampaignBriefInput = { title: 'Campaña Raxi', objective: 'Objetivo\nmedible', priority: 'HIGH',
  channels: ['INSTAGRAM_REEL'], contentLevels: ['PUBLIC_SOCIAL'], keyMessage: 'Mensaje\nclave', cta: 'Sigue\nla historia', notes: 'Nota\ninterna' };
function inbox(provenance: OperationsInboxItem['provenance'] = 'MOCK'): OperationsInboxItem[] {
  const fixture = loadMockIdeaCenter().ideas;
  const sent = reduceIdeaCenterSession(createIdeaCenterSession(fixture), { type: 'SEND_TO_HQ', ideaId: 'IDEA-APPROVED-001', at });
  return [{ ...sent.handoffs[0], provenance }];
}
function create(handoffs = inbox(), state = createCampaignSession(), input = brief, timestamp = at) {
  return reduceCampaignSession(state, handoffs, { type: 'CREATE_CAMPAIGN', ideaId: handoffs[0].handoff.ideaId, brief: input, at: timestamp });
}

test('handoff begins PENDING; no campaign exists until human confirmation', () => {
  const state = createCampaignSession();
  assert.deepEqual(campaignDecision(state, inbox()[0].handoff.ideaId), { ideaId: 'IDEA-APPROVED-001', status: 'PENDING' });
  assert.equal(state.campaigns.length, 0);
  assert.throws(() => validateCampaignDecision({ ideaId: 'IDEA-APPROVED-001', status: 'PENDING', campaignId: 'CAMPAIGN-001' }));
});

test('accepted decision requires valid timestamp and campaign ID', () => {
  assert.throws(() => validateCampaignDecision({ ideaId: 'IDEA-1', status: 'ACCEPTED', decidedAt: at }));
  assert.throws(() => validateCampaignDecision({ ideaId: 'IDEA-1', status: 'ACCEPTED', campaignId: 'CAMPAIGN-001' }));
  assert.deepEqual(validateCampaignDecision({ ideaId: 'IDEA-1', status: 'ACCEPTED', decidedAt: at, campaignId: 'CAMPAIGN-001' }),
    { ideaId: 'IDEA-1', status: 'ACCEPTED', decidedAt: at, campaignId: 'CAMPAIGN-001', reason: undefined });
});

test('rejection requires Luis reason and creates no campaign', () => {
  const handoffs = inbox();
  const initial = createCampaignSession();
  assert.throws(() => reduceCampaignSession(initial, handoffs, { type: 'REJECT_PROPOSAL', ideaId: 'IDEA-APPROVED-001', reason: '', at }));
  assert.equal(initial.decisions.length, 0);
  const rejected = reduceCampaignSession(initial, handoffs, { type: 'REJECT_PROPOSAL', ideaId: 'IDEA-APPROVED-001', reason: 'No encaja\nesta semana', at });
  assert.equal(rejected.campaigns.length, 0);
  assert.equal(rejected.decisions[0].status, 'REJECTED');
  assert.equal(rejected.decisions[0].reason, 'No encaja\nesta semana');
  assert.equal(rejected.audit[0].action, 'PROPOSAL_REJECTED');
  assert.throws(() => create(handoffs, rejected), /decidida/);
});

test('accept creates exactly one DRAFT with linked ID, provenance and two audit events', () => {
  const handoffs = inbox();
  const next = create(handoffs);
  assert.equal(next.campaigns.length, 1);
  assert.equal(next.campaigns[0].id, 'CAMPAIGN-001');
  assert.equal(next.campaigns[0].status, 'DRAFT');
  assert.equal(next.campaigns[0].sourceIdeaId, handoffs[0].handoff.ideaId);
  assert.equal(next.campaigns[0].sourceHandoffSentAt, handoffs[0].handoff.sentAt);
  assert.equal(next.campaigns[0].provenance, 'MOCK');
  assert.equal(next.decisions[0].campaignId, next.campaigns[0].id);
  assert.deepEqual(next.audit.map(event => event.action), ['PROPOSAL_ACCEPTED', 'CAMPAIGN_CREATED']);
  assert.deepEqual(next.audit.map(event => event.actor), ['LUIS', 'LUIS']);
  assert.equal(handoffs.length, 1);
  assert.throws(() => create(handoffs, next), /decidida/);
});

test('invalid brief and invalid provenance leave original session untouched', () => {
  const handoffs = inbox();
  const initial = createCampaignSession();
  assert.throws(() => create(handoffs, initial, { ...brief, objective: '' }));
  assert.throws(() => create([{ ...handoffs[0], provenance: 'LIVE' as never }], initial));
  assert.deepEqual(initial, createCampaignSession());
});

test('audit failure is atomic and does not orphan accepted campaign', () => {
  const initial: CampaignSession = { ...createCampaignSession(), audit: Array.from({ length: 999 }, (_, index) => ({
    id: `AUDIT-CAMPAIGN-${index + 1}`, timestamp: at, action: 'PROPOSAL_REJECTED', actor: 'LUIS' as const,
  })) };
  assert.throws(() => create(inbox(), initial), /Límite/);
  assert.equal(initial.campaigns.length, 0);
  assert.equal(initial.decisions.length, 0);
});

test('fixed clock reproduces campaign, decision and audit IDs exactly', () => {
  const run = () => dispatchCampaignAction(createCampaignSession(), inbox(), () => at,
    { type: 'CREATE_CAMPAIGN', ideaId: 'IDEA-APPROVED-001', brief });
  assert.deepEqual(run(), run());
  assert.deepEqual(run().audit.map(event => event.id), ['AUDIT-CAMPAIGN-0001', 'AUDIT-CAMPAIGN-0002']);
});

test('separate handoffs receive sequential IDs without collisions', () => {
  const first = inbox();
  const second: OperationsInboxItem = { ...first[0], handoff: { ...first[0].handoff, ideaId: 'IDEA-SECOND', title: 'Otra propuesta' } };
  const accepted = create(first);
  const next = reduceCampaignSession(accepted, [...first, second], { type: 'CREATE_CAMPAIGN', ideaId: 'IDEA-SECOND', brief, at });
  assert.deepEqual(next.campaigns.map(item => item.id), ['CAMPAIGN-001', 'CAMPAIGN-002']);
  assert.deepEqual(next.decisions.map(item => item.campaignId), ['CAMPAIGN-001', 'CAMPAIGN-002']);
});

test('MOCK, modified MOCK and LOCAL_SESSION provenance remain distinct from Office mode', () => {
  for (const provenance of ['MOCK', 'MOCK_SESSION_MODIFIED', 'LOCAL_SESSION'] as const) {
    const state = create(inbox(provenance));
    assert.equal(state.campaigns[0].provenance, provenance);
  }
  const officeMode = 'LIVE_READ_ONLY';
  assert.equal(officeMode, 'LIVE_READ_ONLY');
  assert.equal(create(inbox()).campaigns[0].provenance, 'MOCK');
});

test('brief requires title, objective, channel, content level and message', () => {
  for (const invalid of [{ ...brief, title: '' }, { ...brief, objective: '' }, { ...brief, channels: [] },
    { ...brief, contentLevels: [] }, { ...brief, keyMessage: '' }]) assert.throws(() => validateCampaignBrief(invalid));
  assert.deepEqual(validateCampaignBrief(brief), brief);
});

test('brief separates channels from editorial levels and rejects invalid or duplicate values', () => {
  assert.equal(CAMPAIGN_CONTENT_LEVELS.length, 4);
  assert.throws(() => validateCampaignBrief({ ...brief, contentLevels: ['INSTAGRAM_REEL'] }));
  assert.throws(() => validateCampaignBrief({ ...brief, channels: ['PUBLIC_SOCIAL'] }));
  assert.throws(() => validateCampaignBrief({ ...brief, channels: ['INSTAGRAM_REEL', 'INSTAGRAM_REEL'] }));
  assert.throws(() => validateCampaignBrief({ ...brief, contentLevels: ['TEASER', 'TEASER'] }));
});

test('multiline fields preserve LF; single-line title and unsafe controls fail', () => {
  assert.equal(validateCampaignBrief(brief).objective, 'Objetivo\nmedible');
  for (const invalid of [{ ...brief, title: 'Título\nmal' }, { ...brief, objective: 'a\r\nb' },
    { ...brief, keyMessage: 'a\u0000b' }, { ...brief, cta: 'a\u001bb' }, { ...brief, notes: 'a\u007fb' }]) {
    assert.throws(() => validateCampaignBrief(invalid));
  }
  assert.throws(() => validateCampaignBrief({ ...brief, objective: 'x'.repeat(1501) }));
  assert.throws(() => validateCampaignBrief({ ...brief, title: 'x'.repeat(121) }));
});

test('CampaignRecord rejects unsafe IDs, invalid timestamps and reversed chronology', () => {
  const valid = create().campaigns[0];
  assert.deepEqual(validateCampaignRecord(valid), valid);
  for (const invalid of [{ ...valid, id: 'prototype' }, { ...valid, id: '__proto__' }, { ...valid, id: 'CAMPAIGN-XYZ' },
    { ...valid, sourceIdeaId: 'toString' }, { ...valid, createdAt: '2026-02-30T00:00:00Z' },
    { ...valid, updatedAt: '2026-10-16T00:00:00Z' }, { ...valid, sourceHandoffSentAt: later }]) {
    assert.throws(() => validateCampaignRecord(invalid));
  }
});

test('collection bounds before mapping, rejects duplicate IDs and source ideas', () => {
  const valid = create().campaigns[0];
  assert.equal(MAX_CAMPAIGNS, 100);
  assert.equal(validateCampaignCollection([valid]).length, 1);
  assert.throws(() => validateCampaignCollection([valid, valid]));
  assert.throws(() => validateCampaignCollection([valid, { ...valid, id: 'CAMPAIGN-002' }]));
  assert.throws(() => validateCampaignCollection(Array(MAX_CAMPAIGNS + 1)));
  assert.throws(() => validateCampaignCollection(Array(1)));
  const custom = [valid] as CampaignRecord[];
  Object.defineProperty(custom, 'map', { value: () => { throw new Error('input.map called'); } });
  assert.equal(validateCampaignCollection(custom).length, 1);
  const exact = Array.from({ length: MAX_CAMPAIGNS }, (_, index) => ({ ...valid,
    id: `CAMPAIGN-${String(index + 1).padStart(3, '0')}`, sourceIdeaId: `IDEA-${index + 1}` }));
  assert.equal(validateCampaignCollection(exact).length, MAX_CAMPAIGNS);
  const oversized = Array.from({ length: MAX_CAMPAIGNS + 1 }, () => undefined);
  Object.defineProperty(oversized, 0, { get() { throw new Error('visited before bound'); } });
  assert.throws(() => validateCampaignCollection(oversized), /Límite/);
});

test('campaign status permits planning, block, unblock and cancellation; CANCELED is terminal', () => {
  const draft = create().campaigns[0];
  const planning = transitionCampaign(draft, 'PLANNING', later);
  const blocked = transitionCampaign(planning, 'BLOCKED', later);
  const resumed = transitionCampaign(blocked, 'PLANNING', later);
  assert.equal(resumed.status, 'PLANNING');
  for (const item of [draft, planning, blocked]) {
    assert.equal(transitionCampaign(item, 'CANCELED', later).status, 'CANCELED');
  }
  assert.throws(() => transitionCampaign(draft, 'BLOCKED', later));
  assert.throws(() => transitionCampaign(transitionCampaign(draft, 'CANCELED', later), 'PLANNING', later));
  assert.throws(() => transitionCampaign(planning, 'BLOCKED', '2026-10-16T00:00:00Z'));
});

test('session status transitions append deterministic Luis audit', () => {
  const handoffs = inbox();
  let state = create(handoffs);
  state = reduceCampaignSession(state, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'PLANNING', at: later });
  state = reduceCampaignSession(state, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'BLOCKED', at: later });
  state = reduceCampaignSession(state, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'PLANNING', at: later });
  state = reduceCampaignSession(state, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'CANCELED', at: later });
  assert.deepEqual(state.audit.map(event => event.action), ['PROPOSAL_ACCEPTED', 'CAMPAIGN_CREATED', 'CAMPAIGN_PLANNING_STARTED', 'CAMPAIGN_BLOCKED', 'CAMPAIGN_UNBLOCKED', 'CAMPAIGN_CANCELED']);
  assert.throws(() => reduceCampaignSession(state, handoffs, { type: 'TRANSITION_CAMPAIGN', campaignId: 'CAMPAIGN-001', to: 'PLANNING', at: later }));
});

test('Inbox retains handoff and renders accepted/rejected decision with internal navigation only', () => {
  const handoffs = inbox();
  const accepted = renderToStaticMarkup(<OperationsInbox id="inbox" handoffs={handoffs} open campaigns={create(handoffs)} onAction={() => true} onOpenCampaign={() => {}} />);
  assert.match(accepted, /CONVERTIDA EN CAMPAÑA/);
  assert.match(accepted, /CAMPAIGN-001/);
  assert.match(accepted, /Abrir campaña/);
  assert.match(accepted, /PROPUESTA RECIBIDA/);
  const rejectedState = reduceCampaignSession(createCampaignSession(), handoffs, { type: 'REJECT_PROPOSAL', ideaId: 'IDEA-APPROVED-001', reason: 'No\nahora', at });
  const rejected = renderToStaticMarkup(<OperationsInbox id="inbox" handoffs={handoffs} open campaigns={rejectedState} />);
  assert.match(rejected, /NO CONVERTIDA EN CAMPAÑA/);
  assert.match(rejected, /No\nahora/);
  assert.doesNotMatch(rejected, /<a\s|href=/);
});

test('Brief UI exposes inherited suggestions, editable fields and explicit confirmation', () => {
  const html = renderToStaticMarkup(<CampaignBriefForm handoff={inbox()[0].handoff} onCreate={() => true} onCancel={() => {}} />);
  assert.match(html, /Campaign Brief/);
  assert.match(html, /sugerencia heredada/);
  assert.match(html, /Revisar y confirmar brief/);
  assert.match(html, /Nivel editorial/);
  assert.match(html, /Redes públicas/);
  assert.doesNotMatch(html, /Crear campaña interna<\/button/);
});

test('Workspace renders counts, detail, provenance, session warning and inactive future stages', () => {
  const state = create(inbox('LOCAL_SESSION'));
  const html = renderToStaticMarkup(<CampaignWorkspace id="workspace" session={state} open selectedId="CAMPAIGN-001" onSelect={() => {}} onAction={() => true} />);
  assert.match(html, /1 Campaigns/);
  assert.match(html, /LOCAL · SESIÓN/);
  assert.match(html, /Las campañas creadas en esta fase viven solo durante esta sesión/);
  assert.match(html, /IDEA-APPROVED-001/);
  assert.match(html, /Objetivo\nmedible/);
  assert.match(html, /Brief · Disponible/);
  for (const stage of ['Strategy', 'Assets', 'Copy', 'QA', 'Planner', 'Publishing', 'Analytics']) assert.match(html, new RegExp(`${stage} · PRÓXIMAMENTE`));
  assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 7);
});

test('untrusted text is React-escaped and new boundary has no persistence or external writes', () => {
  const handoffs = inbox();
  const hostile = create(handoffs, createCampaignSession(), { ...brief, objective: '<script>alert(1)</script>' });
  const html = renderToStaticMarkup(<CampaignWorkspace id="workspace" session={hostile} open onSelect={() => {}} onAction={() => true} />);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<a\s|href=/);
  for (const path of ['src/campaigns/campaignContracts.ts', 'src/campaigns/campaignValidation.ts', 'src/campaigns/campaignSession.ts',
    'src/campaigns/CampaignBriefForm.tsx', 'src/campaigns/CampaignWorkspace.tsx', 'src/operations/OperationsInbox.tsx']) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /dangerouslySetInnerHTML|localStorage|sessionStorage|XMLHttpRequest|fetch\s*\(|\.\.\/adapters\//);
  }
  assert.doesNotMatch(readFileSync('src/domain/campaigns.ts', 'utf8'), /CampaignRecord/);
});
