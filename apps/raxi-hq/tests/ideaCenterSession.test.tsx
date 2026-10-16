import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadMockIdeaCenter } from '../src/ideas/mockIdeas';
import { createIdeaCenterSession, dispatchIdeaAction, ideaProvenance, reduceIdeaCenterSession, sessionIdeas, type IdeaCenterSession, type IdeaReviewInput } from '../src/ideas/ideaCenterSession';
import { validateIdeaRecord, MAX_IDEAS } from '../src/ideas/ideaValidation';
import { ManualIdeaForm } from '../src/ideas/ManualIdeaForm';
import { IdeaReviewForm } from '../src/ideas/IdeaReviewForm';
import { OperationsInbox } from '../src/operations/OperationsInbox';
import { IdeaCenterPanel } from '../src/ideas/IdeaCenterPanel';
import { CampusOverview } from '../src/campus/CampusOverview';

const at = '2026-10-16T12:00:00Z';
const mock = () => loadMockIdeaCenter().ideas;
const initial = () => createIdeaCenterSession(mock());
const create = (state = initial(), title = 'Idea de Luis') => reduceIdeaCenterSession(state,
  { type: 'CREATE_DRAFT', input: { title, note: 'Una nota original', priority: 'MEDIUM', sourceRef: 'https://example.test/opaco' }, at });
const review: IdeaReviewInput = { title: 'Idea de Luis', summary: 'Resumen escrito', reason: 'Motivo escrito', priority: 'HIGH',
  suggestedChannels: ['INSTAGRAM_FEED'], tags: ['original'], fitScore: 74, confidenceScore: 63 };
const promoted = () => reduceIdeaCenterSession(create(), { type: 'PROMOTE_DRAFT', draftId: 'IDEA-MANUAL-002', input: review, at });
const approved = () => {
  const p = promoted();
  const r = reduceIdeaCenterSession(p, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'UNDER_REVIEW', at });
  return reduceIdeaCenterSession(r, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'APPROVED_FOR_HQ', at });
};

test('manual draft is separate from IdeaRecord and uses collision-free sequential IDs', () => {
  const one = create();
  assert.equal(one.manualDrafts[0].id, 'IDEA-MANUAL-002');
  assert.equal(one.manualDrafts[0].priority, 'MEDIUM');
  assert.equal(one.manualDrafts[0].createdAt, at);
  assert.equal(sessionIdeas(one).length, mock().length);
  assert.equal(ideaProvenance(one, 'IDEA-MANUAL-002'), 'LOCAL · SESIÓN');
  const two = create(one, 'Segunda idea');
  assert.equal(two.manualDrafts[1].id, 'IDEA-MANUAL-003');
  const deleted = reduceIdeaCenterSession(two, { type: 'DELETE_DRAFT', draftId: 'IDEA-MANUAL-002', at });
  assert.equal(create(deleted).manualDrafts.at(-1)?.id, 'IDEA-MANUAL-004');
  assert.equal(one.audit[0].id, 'AUDIT-0001');
  assert.equal(deleted.audit[2].id, 'AUDIT-0003');
  assert.deepEqual(mock(), initial().mockIdeas);
});

test('draft rejects empty or oversized text, controls, bad timestamps and unsafe IDs', () => {
  const base = { title: 'T', note: 'N', priority: 'MEDIUM' as const };
  for (const input of [{ ...base, title: '' }, { ...base, note: '' }, { ...base, title: 'x'.repeat(121) },
    { ...base, note: 'x'.repeat(1001) }, { ...base, note: 'bad\nline' }, { ...base, sourceRef: 'x'.repeat(257) }]) {
    assert.throws(() => reduceIdeaCenterSession(initial(), { type: 'CREATE_DRAFT', input, at }));
  }
  assert.throws(() => reduceIdeaCenterSession(initial(), { type: 'CREATE_DRAFT', input: base, at: '2026-02-30T12:00:00Z' }));
  assert.throws(() => reduceIdeaCenterSession(initial(), { type: 'DELETE_DRAFT', draftId: 'constructor', at }));
});

test('capacity applies to drafts plus canonical ideas before creation', () => {
  let state = initial();
  for (let i = state.mockIdeas.length; i < MAX_IDEAS; i++) state = create(state, `Idea ${i}`);
  assert.equal(state.manualDrafts.length + state.mockIdeas.length, MAX_IDEAS);
  assert.throws(() => create(state), /Límite/);
  assert.equal(state.manualDrafts.length + state.mockIdeas.length, MAX_IDEAS);
});

test('only drafts can be deleted; promotion requires explicit complete scores', () => {
  const state = create();
  assert.throws(() => reduceIdeaCenterSession(state, { type: 'DELETE_DRAFT', draftId: 'IDEA-MANUAL-001', at }));
  for (const input of [{ ...review, fitScore: Number.NaN }, { ...review, confidenceScore: Number.NaN },
    { ...review, reason: '' }, { ...review, suggestedChannels: ['BAD'] as never }]) {
    assert.throws(() => reduceIdeaCenterSession(state, { type: 'PROMOTE_DRAFT', draftId: 'IDEA-MANUAL-002', input, at }));
    assert.equal(state.manualDrafts.length, 1);
  }
  const next = promoted();
  const idea = sessionIdeas(next).find(item => item.id === 'IDEA-MANUAL-002')!;
  assert.equal(idea.source, 'MANUAL_LUIS');
  assert.equal(idea.status, 'PROPOSED');
  assert.equal(idea.approvedAt, undefined);
  assert.equal(idea.sentToHqAt, undefined);
  assert.equal(idea.fitScore, 74);
  assert.equal(idea.confidenceScore, 63);
  assert.equal(idea.evidence[0].sourceRef, 'https://example.test/opaco');
  assert.deepEqual(validateIdeaRecord(idea), idea);
  assert.equal(next.manualDrafts.length, 0);
});

test('transitions use canonical rules, protect approval and do not mutate MOCK fixture', () => {
  const start = promoted();
  assert.throws(() => reduceIdeaCenterSession(start, { type: 'SEND_TO_HQ', ideaId: 'IDEA-MANUAL-002', at }));
  assert.throws(() => reduceIdeaCenterSession(start, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'APPROVED_FOR_HQ', at }));
  const next = approved();
  assert.equal(sessionIdeas(next).find(idea => idea.id === 'IDEA-MANUAL-002')?.status, 'APPROVED_FOR_HQ');
  assert.deepEqual(next.audit.map(event => event.action), ['DRAFT_CREATED', 'DRAFT_PROMOTED', 'REVIEW_STARTED', 'APPROVED_FOR_HQ']);
  const mockIdea = next.mockIdeas.find(idea => idea.id === 'IDEA-GAMING-HORROR')!;
  const modified = reduceIdeaCenterSession(next, { type: 'TRANSITION', ideaId: mockIdea.id, to: 'UNDER_REVIEW', at });
  assert.equal(mockIdea.status, 'PROPOSED');
  assert.equal(ideaProvenance(modified, mockIdea.id), 'MOCK · modificado en sesión');
  assert.equal(sessionIdeas(modified).find(idea => idea.id === mockIdea.id)?.status, 'UNDER_REVIEW');
});

test('handoff is confirmed action, idempotent and never creates Campaign', () => {
  const state = approved();
  assert.equal(state.handoffs.length, 0);
  const sent = reduceIdeaCenterSession(state, { type: 'SEND_TO_HQ', ideaId: 'IDEA-MANUAL-002', at });
  assert.equal(sent.handoffs.length, 1);
  assert.equal(sent.handoffs[0].ideaId, 'IDEA-MANUAL-002');
  assert.equal(sent.handoffs[0].sentAt, at);
  assert.equal(sessionIdeas(sent).find(idea => idea.id === 'IDEA-MANUAL-002')?.status, 'SENT_TO_HQ');
  assert.equal(reduceIdeaCenterSession(sent, { type: 'SEND_TO_HQ', ideaId: 'IDEA-MANUAL-002', at: '2026-10-17T00:00:00Z' }), sent);
  assert.equal(Object.hasOwn(sent, 'campaigns'), false);
  assert.equal(Object.hasOwn(sent.handoffs[0], 'campaignId'), false);
});

test('archive and rejection routes remain canonical; invalid chronology is rejected', () => {
  const state = promoted();
  assert.throws(() => reduceIdeaCenterSession(state, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'UNDER_REVIEW', at: '2026-10-01T00:00:00Z' }));
  const reviewState = reduceIdeaCenterSession(state, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'UNDER_REVIEW', at });
  const rejected = reduceIdeaCenterSession(reviewState, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'REJECTED', at });
  const archived = reduceIdeaCenterSession(rejected, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'ARCHIVED', at });
  assert.equal(sessionIdeas(archived).find(idea => idea.id === 'IDEA-MANUAL-002')?.status, 'ARCHIVED');
  assert.throws(() => reduceIdeaCenterSession(archived, { type: 'SEND_TO_HQ', ideaId: 'IDEA-MANUAL-002', at }));
});

test('fixed injected clock reproduces IDs, timestamps, audit and inbox exactly', () => {
  const run = () => {
    let state = dispatchIdeaAction(initial(), () => at, { type: 'CREATE_DRAFT', input: { title: 'Una idea', note: 'Nota', priority: 'MEDIUM' } });
    state = dispatchIdeaAction(state, () => at, { type: 'PROMOTE_DRAFT', draftId: 'IDEA-MANUAL-002', input: review });
    state = dispatchIdeaAction(state, () => at, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'UNDER_REVIEW' });
    state = dispatchIdeaAction(state, () => at, { type: 'TRANSITION', ideaId: 'IDEA-MANUAL-002', to: 'APPROVED_FOR_HQ' });
    return dispatchIdeaAction(state, () => at, { type: 'SEND_TO_HQ', ideaId: 'IDEA-MANUAL-002' });
  };
  assert.deepEqual(run(), run());
  assert.deepEqual(run().audit.map(event => event.id), ['AUDIT-0001', 'AUDIT-0002', 'AUDIT-0003', 'AUDIT-0004', 'AUDIT-0005']);
});

test('UI exposes accessible draft, review, confirmation and inbox without HTML execution', () => {
  const draft = create().manualDrafts[0];
  const form = renderToStaticMarkup(<ManualIdeaForm onSave={() => {}} onCancel={() => {}} />);
  const reviewForm = renderToStaticMarkup(<IdeaReviewForm draft={draft} onSave={() => {}} onCancel={() => {}} />);
  assert.match(form, /aria-label="Nueva idea de Luis"/);
  assert.match(form, /Guardar borrador/);
  assert.match(reviewForm, /Afinidad con Raxi/);
  assert.match(reviewForm, /Referencia original/);
  assert.match(reviewForm, /https:\/\/example.test\/opaco/);
  assert.doesNotMatch(reviewForm, /<a\s|href=/);
  const html = renderToStaticMarkup(<IdeaCenterPanel id="ideas" ideas={sessionIdeas(approved())} open session={approved()} onAction={() => true} />);
  assert.match(html, /Enviar al Centro de Operaciones/);
  assert.match(html, /Borradores de Luis/);
  assert.match(html, /MOCK \+ SESIÓN LOCAL/);
  const inbox = renderToStaticMarkup(<OperationsInbox id="inbox" handoffs={reduceIdeaCenterSession(approved(), { type: 'SEND_TO_HQ', ideaId: 'IDEA-MANUAL-002', at }).handoffs} open />);
  assert.match(inbox, /PROPUESTA RECIBIDA/);
  assert.match(inbox, /PENDIENTE DE DECISIÓN DEL HQ/);
  assert.doesNotMatch(inbox, /Crear campaña<\/button/);
});

test('user input stays escaped and session boundary has no persistence or external write capability', () => {
  const draft = { ...create().manualDrafts[0], sourceRef: '<script>alert(1)</script>' };
  const html = renderToStaticMarkup(<IdeaReviewForm draft={draft} onSave={() => {}} onCancel={() => {}} />);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<a\s|href=/);
  for (const path of ['src/ideas/ideaCenterSession.ts', 'src/ideas/manualIdeaDraft.ts', 'src/ideas/ManualIdeaForm.tsx',
    'src/ideas/IdeaReviewForm.tsx', 'src/operations/OperationsInbox.tsx', 'src/campus/CampusOverview.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|localStorage|sessionStorage|XMLHttpRequest|fetch\s*\(|\.\.\/adapters\//);
  }
  const campus = renderToStaticMarkup(<CampusOverview ideas={mock()} />);
  assert.match(campus, /0<\/b> propuestas recibidas/);
  assert.match(campus, /0<\/b> borradores locales/);
});
