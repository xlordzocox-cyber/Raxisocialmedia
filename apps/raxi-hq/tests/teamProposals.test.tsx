import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canDecide, canUndo, parseProposals, visibleProposals } from '../src/ideas/teamProposals';
import { TeamProposalsPanel } from '../src/ideas/TeamProposalsPanel';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: 'p' + n, workspace_id: ws, external_id: 'PROP-' + n, agent_key: 'researcher', character_id: 'vesper-corvus',
  title: 'Idea ' + n, summary: 'Resumen ' + n, rationale: null, channel: 'INSTAGRAM', estimated_cost_usd: '0.0450',
  evidence: [{ label: 'Fuente', url: 'https://example.com/a', observedAt: '2026-11-15' }, { label: 'Mala', url: 'javascript:alert(1)' }],
  status: 'PROPOSED', owner_note: null, created_at: `2026-11-15T0${n}:00:00Z`, ...extra,
});

test('team proposals: parsed safely, foreign rows and unsafe links rejected, dismissed hidden by default', () => {
  const all = parseProposals(ws, [row(1), row(2, { status: 'DISMISSED' }), row(3, { status: 'ACCEPTED' })]);
  assert.equal(all[0].estimatedCostUsd, 0.045);
  assert.equal(all[0].evidence[1].url, undefined, 'non-https links are dropped');
  assert.deepEqual(visibleProposals(all, false).map((p) => p.id), ['p1', 'p3']);
  assert.equal(visibleProposals(all, true).length, 3);
  assert.equal(canDecide(all.find((p) => p.id === 'p1')!), true);
  assert.equal(canUndo(all.find((p) => p.id === 'p3')!), true);
  assert.throws(() => parseProposals(ws, [row(1, { workspace_id: 'other' })]));
  assert.throws(() => parseProposals(ws, [row(1, { status: 'HACKED' })]));
});

test('team proposals panel: owner decision goes only through the audited RPC', async () => {
  const calls: unknown[] = [];
  let status = 'PROPOSED';
  const client = {
    from: () => ({ select: () => ({ eq: async () => ({ data: [row(1, { status })], error: null }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); status = String(args.p_decision); return { data: {}, error: null }; },
  } as unknown as SupabaseClient;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<TeamProposalsPanel client={client} workspace={ws} />); });
  const button = (label: string) => view.root.findAllByType('button').find((b) => b.children.join('') === label);
  assert.match(JSON.stringify(view.toJSON()), /Propuesta del equipo · Investigador/);
  await act(async () => { button('Me interesa')!.props.onClick(); });
  assert.deepEqual(calls, [['raxi_team_proposal_decide', { p_id: 'p1', p_decision: 'ACCEPTED' }]]);
  assert.ok(button('Deshacer'), 'accepted proposal can be undone');
  assert.equal(button('Me interesa'), undefined);
});

test('team proposals panel: hidden entirely when the table is not installed', async () => {
  const client = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code: '42P01' } }) }) }) } as unknown as SupabaseClient;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<TeamProposalsPanel client={client} workspace={ws} />); });
  assert.equal(view.toJSON(), null);
});
