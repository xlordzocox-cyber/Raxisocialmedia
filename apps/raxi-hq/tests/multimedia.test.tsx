import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildMedia, filterMedia, groupByDay } from '../src/portfolio/mediaModel';
import { MultimediaPage } from '../src/portfolio/MultimediaPage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = 'a'.repeat(64);
const asset = (n: number, created: string, extra: Record<string, unknown> = {}) => ({
  id: 'a' + n, workspace_id: ws, object_path: `${ws}/a${n}/original.jpg`, mime_type: 'image/jpeg', sha256: sha, byte_size: 2048,
  external_asset_id: `mcp_seedream-${n}.jpg`, metadata: { aria_file: `mcp_seedream-${n}.jpg`, character_id: 'vesper-corvus', content_level: 'PUBLIC' }, created_at: created, ...extra,
});
const assets = [asset(1, '2026-11-15T10:00:00Z'), asset(2, '2026-11-16T21:00:00Z'), asset(3, '2026-11-16T20:00:00Z', { metadata: { character_id: 'raxi-vox', content_level: 'PUBLIC' } }), asset(4, '2026-11-16T22:00:00Z', { metadata: { character_id: 'vesper-corvus', content_level: 'NSFW' } }), asset(5, '2026-11-16T22:30:00Z', { metadata: { character_id: 'vesper-corvus' } })];
const items = [{ workspace_id: ws, asset_id: 'a1', collection_id: 'c1' }];
const collections = [{ id: 'c1', workspace_id: ws, title: 'Noches de archivo' }];

test('media model: newest first, campaign links, filters and day groups', () => {
  const view = buildMedia(ws, assets, items, collections);
  assert.deepEqual(view.assets.map((a) => a.id), ['a5', 'a4', 'a2', 'a3', 'a1']);
  assert.deepEqual(view.assets.find((a) => a.id === 'a1')!.campaigns, ['Noches de archivo']);
  assert.deepEqual(view.characters, ['raxi-vox', 'vesper-corvus']);
  assert.deepEqual(filterMedia(view.assets, { section: 'PUBLIC', character: 'vesper-corvus', onlyLoose: false }).map((a) => a.id), ['a2', 'a1']);
  assert.deepEqual(filterMedia(view.assets, { section: 'PUBLIC', character: 'ALL', onlyLoose: true }).map((a) => a.id), ['a2', 'a3']);
  assert.deepEqual(filterMedia(view.assets, { section: 'HIDDEN', character: 'ALL', onlyLoose: false }).map((a) => a.id), ['a4'], 'NSFW only in hidden');
  assert.deepEqual(filterMedia(view.assets, { section: 'UNCLASSIFIED', character: 'ALL', onlyLoose: false }).map((a) => a.id), ['a5'], 'no level → never public');
  assert.equal(groupByDay(view.assets, 'UTC').length, 2);
});

test('media model: foreign rows, foreign paths, bad hashes are rejected; non-images hidden', () => {
  assert.throws(() => buildMedia(ws, [{ ...assets[0], workspace_id: 'other' }], [], []));
  assert.throws(() => buildMedia(ws, [{ ...assets[0], object_path: 'other/a1/original.jpg' }], [], []));
  assert.throws(() => buildMedia(ws, [{ ...assets[0], sha256: 'bad' }], [], []));
  assert.throws(() => buildMedia(ws, [], [{ ...items[0], workspace_id: 'other' }], collections));
  assert.equal(buildMedia(ws, [{ ...assets[0], mime_type: 'video/mp4' }], [], []).assets.length, 0);
});

test('Multimedia page renders every archived photo read-only (no writes)', async () => {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => { calls.push('rpc:' + name); return { data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null }; },
    from: (name: string) => ({ select: () => ({ eq: async () => ({ data: name === 'raxi_assets' ? assets : name === 'raxi_portfolio_items' ? items : collections, error: null }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }) }) },
  } as unknown as SupabaseClient;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<MemoryRouter><MultimediaPage client={client} ownerId={owner} /></MemoryRouter>); await new Promise((r) => setTimeout(r, 20)); });
  const tiles = view.root.findAll((n) => n.type === 'button' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].startsWith('Foto '));
  assert.equal(tiles.length, 3, 'public section by default: NSFW and unclassified are not shown');
  assert.ok(!JSON.stringify(view.toJSON()).includes('mcp_seedream-4.jpg'), 'NSFW asset not rendered in public view');
  assert.match(tiles[0].props['aria-label'], /mcp_seedream-2/, 'newest first');
  assert.deepEqual(calls, ['rpc:raxi_get_workspace'], 'only the workspace lookup RPC, no write RPCs');
  await act(async () => { tiles[2].props.onClick(); });
  assert.match(JSON.stringify(view.toJSON()), /Campañas: Noches de archivo/);
});
