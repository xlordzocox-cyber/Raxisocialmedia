import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { campaignEligibility } from '../src/campaigns/campaignEligibility';
import { CampaignEligibilityPanel } from '../src/campaigns/CampaignEligibilityPanel';
import { CampaignWorkspace } from '../src/campaigns/CampaignWorkspace';
import { RealCampaignCenter } from '../src/persistence/RealCampaignCenter';
import { RealCampaignStore, type RealCampaignState } from '../src/persistence/realCampaignStore';
import { RealIdeaStore } from '../src/persistence/realIdeaStore';
import { applyCampaignOperation, type CampaignSnapshot, type RealCampaignAction } from '../src/persistence/campaignCommands';
import type { CampaignReadContext } from '../src/persistence/campaignReadContext';
import { attentionFixture, attentionOwner as owner, attentionWorkspace as workspace } from './humanAttentionFixture';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

const scope: CampaignReadContext = { mode: 'REAL', ownerId: owner, workspaceId: workspace, ideasReady: true, synchronized: true, ideaPending: false };
const command = (snapshot: CampaignSnapshot, action: RealCampaignAction) => applyCampaignOperation(snapshot, {
  workspaceId: workspace,
  expectedVersion: snapshot.version,
  operationId: crypto.randomUUID(),
  action,
});
const approved = () => {
  const snapshot = attentionFixture();
  return command(snapshot, { type: 'APPROVE_STRATEGY', campaignId: snapshot.session.campaigns[0].id, revision: 1, confirmed: true });
};
const ready = (snapshot: CampaignSnapshot): RealCampaignState => ({ phase: 'ready', snapshot, error: null, pending: null, confirmedId: null });
const result = (snapshot: CampaignSnapshot) => campaignEligibility(ready(snapshot), scope).get(snapshot.session.campaigns[0].id)!;

test('canonical approval makes the current public photo eligible without mutating the snapshot', () => {
  const snapshot = approved();
  const original = structuredClone(snapshot);
  const view = result(snapshot);
  assert.equal(view.eligible, true);
  assert.equal(view.revision, 1);
  assert.equal(view.deliverables[0].deliverable.id, snapshot.session.strategies[0].deliverables[0].id);
  assert.deepEqual(snapshot, original);
});

test('no foreign, unconfirmed or demo snapshot can expose eligible campaigns', () => {
  const state = ready(approved());
  for (const context of [
    { ...scope, ownerId: 'other-owner' }, { ...scope, workspaceId: 'other-workspace' },
    { ...scope, mode: 'DEMO' as const }, { ...scope, ownerId: undefined },
    { ...scope, synchronized: false }, { ...scope, ideasReady: false }, { ...scope, ideaPending: true },
  ]) assert.equal(campaignEligibility(state, context).size, 0);
  for (const phase of ['loading', 'saving', 'error', 'unavailable'] as const) {
    assert.equal(campaignEligibility({ ...state, phase }, scope).size, 0);
  }
  assert.equal(campaignEligibility({ ...state, pending: state.snapshot!.receipts[0].command }, scope).size, 0);
});

test('incompatible campaign and revision states block and explain the decision', () => {
  for (const status of ['DRAFT', 'BLOCKED', 'CANCELED'] as const) {
    const snapshot = approved();
    snapshot.session.campaigns[0].status = status;
    const view = result(snapshot);
    assert.equal(view.eligible, false);
    assert.match(view.reason, new RegExp(status));
  }
  const snapshot = attentionFixture();
  assert.equal(result(snapshot).eligible, false);
  assert.match(result(snapshot).reason, /IN_REVIEW/);
  snapshot.session.strategies = [];
  assert.match(result(snapshot).reason, /aún no tiene/);
});

test('a new draft supersedes a previously approved revision without falling back', () => {
  const snapshot = approved();
  const next = command(snapshot, { type: 'START_STRATEGY_REVISION', campaignId: snapshot.session.campaigns[0].id, revision: 1, confirmed: true, reason: 'Fixture de nueva revisión' });
  assert.equal(next.session.strategies[0].status, 'APPROVED');
  assert.equal(result(next).eligible, false);
  assert.match(result(next).reason, /vigente 2.*DRAFT/);
});

test('ambiguous campaign and revision identities cannot select a winning approval', () => {
  const duplicate = approved();
  duplicate.session.campaigns.push(duplicate.session.campaigns[0]);
  assert.match(result(duplicate).reason, /identidad/);
  const demo = approved();
  demo.session.campaigns[0].provenance = 'MOCK';
  assert.equal(result(demo).eligible, false);
  const history = approved();
  history.session.strategies.push(history.session.strategies[0]);
  assert.match(result(history).reason, /ambiguo/);
  const unrelated = approved();
  unrelated.session.strategies[0] = { ...unrelated.session.strategies[0], campaignId: 'CAMPAIGN-999' };
  assert.equal(result(unrelated).eligible, false);
});

test('approval metadata requires matching editorial receipt and audit for this revision', () => {
  for (const corruption of ['no-receipt', 'foreign-receipt', 'old-revision', 'no-audit', 'future-approval'] as const) {
    const snapshot = approved();
    const receipt = snapshot.receipts.at(-1)!.command;
    if (corruption === 'no-receipt') snapshot.receipts.pop();
    if (corruption === 'foreign-receipt') receipt.workspaceId = 'foreign';
    if (corruption === 'old-revision' && receipt.action.type === 'APPROVE_STRATEGY') receipt.action.revision = 2;
    if (corruption === 'no-audit') snapshot.session.audit.pop();
    if (corruption === 'future-approval') snapshot.serverTime = '2000-01-01T00:00:00Z';
    assert.equal(result(snapshot).eligible, false, corruption);
    assert.match(result(snapshot).reason, /recibo y una auditoría/);
  }
});

test('deliverables validate the brief and the public-photo tuple individually', () => {
  const snapshot = approved();
  const revision = snapshot.session.strategies[0];
  const photo = revision.deliverables[0];
  snapshot.session.strategies[0] = { ...revision, deliverables: [photo, { ...photo, id: 'STRATEGY-ITEM-002', format: 'CAROUSEL' }] };
  assert.deepEqual(result(snapshot).deliverables.map(item => item.eligible), [true, false]);
  snapshot.session.strategies[0].deliverables = [{ ...photo, format: 'CAROUSEL' }];
  assert.equal(result(snapshot).eligible, false);
  assert.match(result(snapshot).reason, /fotos públicas/);
  snapshot.session.strategies[0].deliverables = [{ ...photo, channel: 'INSTAGRAM_REEL' }];
  assert.match(result(snapshot).reason, /matriz.*inválida/);
  const campaign = snapshot.session.campaigns[0];
  campaign.channels = ['FANVIEW_CHAT'];
  campaign.contentLevels = ['FANVIEW_CHAT'];
  snapshot.session.strategies[0].deliverables = [{ ...photo, channel: 'FANVIEW_CHAT', contentLevel: 'FANVIEW_CHAT', format: 'CHAT_PHOTO' }];
  assert.equal(result(snapshot).eligible, false);
});

test('mounted REAL workspace retires eligibility while reloading and shows the new blocked revision', async () => {
  let snapshot = approved();
  let reads = 0, writes = 0;
  let release: ((value: CampaignSnapshot) => void) | undefined;
  const store = new RealCampaignStore({
    read: async () => ++reads === 1 ? snapshot : new Promise(resolve => { release = resolve; }),
    execute: async () => { writes++; throw new Error('Fixture de solo lectura'); },
  }, owner, workspace);
  const ideas = new RealIdeaStore({
    findWorkspace: async () => ({ id: workspace, ownerId: owner, name: 'raxi-hq' }),
    listIdeas: async () => [],
    createWorkspace: async () => { throw new Error('Fixture de solo lectura'); },
    createIdea: async () => { throw new Error('Fixture de solo lectura'); },
  }, owner);
  await ideas.load();
  await store.load();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<StrictMode><RealCampaignCenter store={store} ideas={ideas} /></StrictMode>); });
  try {
    const panel = () => view.root.findByType(CampaignEligibilityPanel);
    assert.equal(panel().props.result.eligible, true);
    assert.equal(panel().findAllByType('button').length, 0);
    assert.ok(panel().findAllByType('p').some(p => p.children.some(child =>
      typeof child === 'string' && child.includes('autorización humana independiente'))));
    assert.equal(reads, 1);
    let reading!: Promise<void>;
    await act(async () => { reading = store.load(); });
    assert.equal(panel().props.result, undefined);
    snapshot = command(snapshot, { type: 'START_STRATEGY_REVISION', campaignId: snapshot.session.campaigns[0].id, revision: 1, confirmed: true, reason: 'Fixture de revisión obsoleta' });
    await act(async () => { release!(snapshot); await reading; });
    assert.equal(panel().props.result.eligible, false);
    assert.match(panel().props.result.reason, /DRAFT/);
    const otherScope = { ...ideas.getSnapshot(), workspace: { id: 'another-workspace', ownerId: owner, name: 'raxi-hq' } };
    await act(async () => view.update(<RealCampaignCenter store={store} ideas={ideas} ideaState={otherScope} />));
    assert.equal(panel().props.result, undefined);
    assert.equal(writes, 0);
  } finally {
    await act(async () => view.unmount());
  }
});

test('the session-only Campaign Workspace does not display REAL eligibility', async () => {
  const { session } = approved();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<CampaignWorkspace id="fixture" session={session} getSession={() => session}
    open getSelectedId={() => undefined} onSelect={() => {}} onAction={() => false} />); });
  assert.equal(view.root.findAllByType(CampaignEligibilityPanel).length, 0);
  await act(async () => view.unmount());
});
