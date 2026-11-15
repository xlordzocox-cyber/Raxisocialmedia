import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPortfolio, canApprove, cropRect, gridOrder, postText, progress } from '../src/portfolio/portfolioModel';
import { FototecaPage } from '../src/portfolio/FototecaPage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = 'a'.repeat(64);
const collection = { id: 'c1', workspace_id: ws, external_id: 'VESPER-1', character_id: 'vesper-corvus', title: 'Una noche', channel: 'INSTAGRAM', status: 'IN_REVIEW', concept: 'Concepto', created_at: '2026-11-15T08:00:00Z' };
const item = (position: number, extra: Record<string, unknown> = {}) => ({
  id: 'i' + position, workspace_id: ws, collection_id: 'c1', position, asset_id: 'a' + position, caption: 'Texto ' + position, alt_text: 'Alt ' + position,
  hashtags: [], crop: '4:5', qa_status: 'PRELIMINARY_PASS', qa_notes: null, human_decision: 'PENDING', status: 'DRAFT', published_url: null, ...extra,
});
const asset = (n: number) => ({ id: 'a' + n, workspace_id: ws, object_path: `${ws}/a${n}/original.jpg`, mime_type: 'image/jpeg', sha256: sha, byte_size: 1000 });

test('portfolio model: grid shows newest first, progress counts, NEEDS_FIX blocks approval', () => {
  const view = buildPortfolio(ws, [collection], [item(1), item(2, { qa_status: 'NEEDS_FIX' }), item(3, { human_decision: 'APPROVED', status: 'READY' })], [asset(1), asset(2), asset(3)]);
  const items = view.collections[0].items;
  assert.deepEqual(items.map((i) => i.position), [1, 2, 3]);
  assert.deepEqual(gridOrder(items).map((i) => i.position), [3, 2, 1]);
  assert.equal(canApprove(items[0]), true);
  assert.equal(canApprove(items[1]), false, 'NEEDS_FIX cannot be approved');
  assert.equal(canApprove(items[2]), false, 'already approved');
  assert.deepEqual(progress(items), { total: 3, approved: 1, published: 0, blocked: 1 });
});

test('portfolio model: foreign rows, foreign storage paths and invalid states are rejected', () => {
  assert.throws(() => buildPortfolio(ws, [{ ...collection, workspace_id: 'other' }], [], []));
  assert.throws(() => buildPortfolio(ws, [collection], [item(1)], [{ ...asset(1), object_path: 'other/a1/original.jpg' }]));
  assert.throws(() => buildPortfolio(ws, [collection], [item(1, { status: 'HACKED' })], [asset(1)]));
  assert.throws(() => buildPortfolio(ws, [collection], [item(1, { collection_id: 'missing' })], []));
  assert.throws(() => buildPortfolio(ws, [collection], [], [{ ...asset(1), sha256: 'bad' }]));
});

test('post text appends normalized hashtags; items without asset cannot be approved', () => {
  const view = buildPortfolio(ws, [collection], [item(1, { hashtags: ['gothic', '#darkacademia'], asset_id: null })], []);
  const it = view.collections[0].items[0];
  assert.equal(postText(it), 'Texto 1\n\n#gothic #darkacademia');
  assert.equal(canApprove(it), false);
});

function fakeClient(rpcLog: unknown[]) {
  const table = (rows: unknown[]) => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) });
  return {
    rpc: async (name: string, args?: unknown) => {
      rpcLog.push([name, args]);
      if (name === 'raxi_get_workspace') return { data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null };
      return { data: { ok: true }, error: null };
    },
    from: (name: string) => table(name === 'raxi_portfolio_collections' ? [collection] : name === 'raxi_portfolio_items' ? [item(1), item(2, { qa_status: 'NEEDS_FIX' })] : [asset(1), asset(2)]),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }) }) },
  } as unknown as SupabaseClient;
}
const flush = () => new Promise((r) => setTimeout(r, 20));

test('Fototeca page renders the campaign grid and sends approval through the audited RPC only', async () => {
  const log: unknown[] = [];
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<MemoryRouter><FototecaPage client={fakeClient(log)} ownerId={owner} /></MemoryRouter>); await flush(); });
  const text = JSON.stringify(view.toJSON());
  assert.match(text, /Una noche/);
  assert.match(text, /0\/2 aprobadas/);
  const tiles = view.root.findAll((n) => n.type === 'button' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Publicación'));
  assert.equal(tiles.length, 2);
  assert.match(tiles[0].props['aria-label'], /Publicación 2/, 'newest first');
  await act(async () => { tiles[1].props.onClick(); await flush(); });
  const approve = view.root.findAll((n) => n.type === 'button' && n.children.join('') === 'Aprobar')[0];
  assert.equal(approve.props.disabled, false);
  await act(async () => { approve.props.onClick(); await flush(); });
  assert.deepEqual(log.find((l) => (l as unknown[])[0] === 'raxi_portfolio_decide'), ['raxi_portfolio_decide', { p_item: 'i1', p_decision: 'APPROVED', p_published_url: null }]);
  await act(async () => { tiles[0].props.onClick(); await flush(); });
  const approveBlocked = view.root.findAll((n) => n.type === 'button' && n.children.join('') === 'Aprobar')[0];
  assert.equal(approveBlocked.props.disabled, true, 'NEEDS_FIX item cannot be approved from the UI');
});

test('feed crop: 9:16 Aria original (1152x2048) becomes a centered 4:5 that excludes the top 15% of the frame', () => {
  const r = cropRect(1152, 2048, '4:5');
  assert.deepEqual(r, { sx: 0, sy: 304, sw: 1152, sh: 1440 });
  assert.ok(r.sy / 2048 > 0.14, 'top band (where the "HOTALS" sign sits) is outside the crop');
  assert.deepEqual(cropRect(1000, 1000, 'ORIGINAL'), { sx: 0, sy: 0, sw: 1000, sh: 1000 });
  assert.deepEqual(cropRect(2000, 1000, '1:1'), { sx: 500, sy: 0, sw: 1000, sh: 1000 });
});
