import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { AgencyNav, AGENCY_SECTIONS } from '../src/agency/AgencyNav';
import { buildPortfolio } from '../src/portfolio/portfolioModel';
import { buildMedia } from '../src/portfolio/mediaModel';
import { buildAgency } from '../src/agency/agencyModel';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgenciaPage } from '../src/agency/AgenciaPage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

test('agency nav: five sections, the current one is marked', async () => {
  assert.deepEqual(AGENCY_SECTIONS.map((s) => [s.to, s.label]), [['/', 'Agencia'], ['/fototeca', 'Fototeca'], ['/multimedia', 'Archivo'], ['/conexiones', 'Conexiones'], ['/estudio', 'Estudio en vivo']]);
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter initialEntries={['/fototeca']}><AgencyNav /></MemoryRouter>); });
  const links = r.root.findAllByType('a');
  assert.deepEqual(links.map((a) => a.props.href), ['/', '/fototeca', '/multimedia', '/conexiones', '/estudio']);
  assert.deepEqual(links.filter((a) => a.props['aria-current'] === 'page').map((a) => a.props.href), ['/fototeca']);
  assert.equal(r.root.findByType('nav').props['aria-label'], 'Secciones de la agencia');
});


const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = 'a'.repeat(64);
const collections = [
  { id: 'c1', workspace_id: ws, external_id: 'VESPER-1', character_id: 'vesper-corvus', title: 'Una noche', channel: 'INSTAGRAM', status: 'IN_REVIEW', concept: null, created_at: '2026-11-15T08:00:00Z' },
  { id: 'c2', workspace_id: ws, external_id: 'RAXI-1', character_id: 'raxi-vox', title: 'Setup nuevo', channel: 'INSTAGRAM', status: 'PUBLISHED', concept: null, created_at: '2026-11-10T08:00:00Z' },
];
const item = (id: string, collection: string, position: number, extra: Record<string, unknown> = {}) => ({
  id, workspace_id: ws, collection_id: collection, position, asset_id: 'a' + position, caption: '', alt_text: '', hashtags: [], crop: '4:5',
  qa_status: 'PRELIMINARY_PASS', qa_notes: null, human_decision: 'PENDING', status: 'DRAFT', published_url: null, ...extra,
});
const items = [
  item('i1', 'c1', 1), item('i2', 'c1', 2, { qa_status: 'NEEDS_FIX' }), item('i3', 'c1', 3, { human_decision: 'APPROVED', status: 'READY' }),
  item('i4', 'c2', 4, { human_decision: 'APPROVED', status: 'PUBLISHED', published_url: 'https://www.instagram.com/p/x/' }),
];
const asset = (n: number, created: string, character: string, level?: string) => ({
  id: 'a' + n, workspace_id: ws, object_path: `${ws}/a${n}/original.jpg`, mime_type: 'image/jpeg', sha256: sha, byte_size: 1000,
  external_asset_id: `f${n}.jpg`, metadata: { character_id: character, ...(level ? { content_level: level } : {}) }, created_at: created,
});
const assets = [
  asset(1, '2026-11-15T10:00:00Z', 'vesper-corvus', 'PUBLIC'), asset(2, '2026-11-16T10:00:00Z', 'vesper-corvus', 'NSFW'),
  asset(3, '2026-11-14T10:00:00Z', 'vesper-corvus', 'PUBLIC'), asset(4, '2026-11-12T10:00:00Z', 'raxi-vox'),
];
const overview = () => buildAgency(buildPortfolio(ws, collections, items, assets), buildMedia(ws, assets, items, collections));

test('agency model: what needs Luis, without inventing work', () => {
  const a = overview();
  assert.deepEqual(a.pending.map((p) => [p.itemId, p.kind, p.collectionTitle]), [['i1', 'DECIDE', 'Una noche'], ['i2', 'FIX', 'Una noche']]);
  assert.equal(a.pending[0].assetPath, `${ws}/a1/original.jpg`);
});

test('agency model: productions in progress exclude finished campaigns', () => {
  const a = overview();
  assert.deepEqual(a.productions, [{ id: 'c1', title: 'Una noche', channel: 'INSTAGRAM', character: 'Vesper Corvus', total: 3, approved: 1, published: 0, blocked: 1 }]);
});

test('agency model: talent covers are public-only and newest first', () => {
  const a = overview();
  assert.deepEqual(a.talent, [
    { id: 'raxi-vox', name: 'Raxi Vox', photos: 1, campaigns: 1, coverPath: null },
    { id: 'vesper-corvus', name: 'Vesper Corvus', photos: 3, campaigns: 1, coverPath: `${ws}/a1/original.jpg` },
  ]);
});


function fakeClient(tables: Record<string, unknown[]>) {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => { calls.push('rpc:' + name); return { data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null }; },
    from: (name: string) => ({ select: () => ({ eq: async () => ({ data: tables[name], error: null }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }) }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const render = async (client: SupabaseClient) => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><AgenciaPage client={client} ownerId={owner} /></MemoryRouter>); await new Promise((res) => setTimeout(res, 20)); });
  return r;
};

test('Agencia page: shows pending decisions, productions and talent, read-only', async () => {
  const { client, calls } = fakeClient({ raxi_portfolio_collections: collections, raxi_portfolio_items: items, raxi_assets: assets });
  const r = await render(client);
  const text = JSON.stringify(r.toJSON());
  assert.match(text, /2 decisiones esperan por ti/);
  assert.match(text, /Una noche/);
  assert.match(text, /Vesper Corvus/);
  assert.match(text, /Raxi Vox/);
  assert.ok(!text.includes('Setup nuevo'), 'finished campaigns are not in progress');
  assert.deepEqual(r.root.findAllByType('img').map((i) => i.props.src).filter((s: string) => s.includes('/a2/')), [], 'NSFW asset never used as a cover');
  assert.ok(r.root.findAllByType('img').every((i) => typeof i.props.alt === 'string' && i.props.alt.length > 0));
  assert.deepEqual(calls, ['rpc:raxi_get_workspace'], 'no write RPCs');
});

test('Agencia page: empty workspace says so instead of inventing content', async () => {
  const { client } = fakeClient({ raxi_portfolio_collections: [], raxi_portfolio_items: [], raxi_assets: [] });
  const text = JSON.stringify((await render(client)).toJSON());
  assert.match(text, /Nada espera tu decisión/);
  assert.match(text, /Aún no hay producciones en curso/);
});

test('agency model: the talent roster is fixed, even when a model has no data yet', () => {
  const empty = buildAgency(buildPortfolio(ws, [], [], []), buildMedia(ws, [], [], []));
  assert.deepEqual(empty.talent, [
    { id: 'raxi-vox', name: 'Raxi Vox', photos: 0, campaigns: 0, coverPath: null },
    { id: 'vesper-corvus', name: 'Vesper Corvus', photos: 0, campaigns: 0, coverPath: null },
  ]);
});
