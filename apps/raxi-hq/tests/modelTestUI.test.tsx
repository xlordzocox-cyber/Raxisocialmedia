import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CompareDetailPage, NewComparePage, SUGGESTED_SCENES } from '../src/compare/ComparePage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const mounted: ReactTestRenderer[] = [];
after(() => { for (const r of mounted) act(() => r.unmount()); });
const settle = () => new Promise((res) => setTimeout(res, 20));
function fakeClient(detail?: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client = { functions: { invoke: async (_n: string, opts: { body: Record<string, unknown> }) => {
    calls.push(opts.body); const b = opts.body;
    if (b.action === 'MODELTEST_QUOTE') return { data: { totalMills: 48 * (b.scenes as string[]).length, perSceneMills: 48, spentMills: 1244, capMills: 10000 }, error: null };
    if (b.action === 'MODELTEST_START') return { data: { testId: 't-1' }, error: null };
    return { data: detail, error: null };
  } } } as unknown as SupabaseClient;
  return { client, calls };
}
async function render(node: React.ReactElement) {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter>{node}</MemoryRouter>); await settle(); });
  mounted.push(r); return r;
}
const byId = (r: ReactTestRenderer, id: string) => r.root.find((n) => n.props.id === id);

test('Comparar: three suggested scenes, nothing spent until the attestation and the priced click', async () => {
  const { client, calls } = fakeClient();
  const r = await render(<NewComparePage client={client} characterId="vesper-corvus" />);
  assert.equal(byId(r, 'cmp-scene-0').props.value, SUGGESTED_SCENES['vesper-corvus'][0]);
  assert.equal(byId(r, 'cmp-start').props.disabled, true, 'attestation required');
  await act(async () => { byId(r, 'cmp-attest').props.onChange({ target: { checked: true } }); await settle(); });
  assert.equal(String(byId(r, 'cmp-start').props.children), 'Comparar 3 escenas · $0.144');
  assert.ok(!calls.some((c) => c.action === 'MODELTEST_START'));
  await act(async () => { byId(r, 'cmp-start').props.onClick(); await settle(); });
  const start = calls.find((c) => c.action === 'MODELTEST_START')!;
  assert.equal(start.expectedTotalMills, 144); assert.equal((start.scenes as string[]).length, 3); assert.equal(start.attestNotReal, true);
});

test('Comparar detail: blind A/B, vote per scene, reveal only after every vote', async () => {
  const ph = (n: number) => ({ status: 'SUCCEEDED', error: null, previewUrl: `https://s/${n}.png` });
  const detail = { testId: 't-1', character: 'vesper-corvus', revealed: false, faceUrl: 'https://s/f.png', tally: null,
    scenes: [{ scene: 1, text: 'a', vote: 'A', A: ph(1), B: ph(2) }, { scene: 2, text: 'b', vote: null, A: ph(3), B: ph(4) }] };
  const { client, calls } = fakeClient(detail);
  const r = await render(<CompareDetailPage client={client} testId="t-1" />);
  assert.ok(!JSON.stringify(r.toJSON()).includes('Seedream'), 'no model names before the reveal');
  assert.equal(byId(r, 'cmp-reveal').props.disabled, true);
  const b2 = r.root.findAll((n) => n.type === 'button' && n.props.children === 'B se parece más')[1];
  await act(async () => { b2.props.onClick(); await settle(); });
  assert.deepEqual(calls.at(-1), { testId: 't-1', action: 'MODELTEST_VOTE', scene: 2, vote: 'B' });
});
