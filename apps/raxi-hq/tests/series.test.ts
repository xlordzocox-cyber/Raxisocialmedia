import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { channelsFor, cleanScenes, quoteSeries, seriesRefs, CHANNEL_LEVEL } from '../../../supabase/functions/sheet-creator/seriesPlan';
import { buildSeriesPrompt, CONTINUITY } from '../../../supabase/functions/sheet-creator/seriesPrompts';
import { handleSeries, type SeriesDependencies, type SeriesRow, type SeriesTakeRow } from '../../../supabase/functions/sheet-creator/series';
import type { Price } from '../../../supabase/functions/sheet-creator/sheetPlan';

const price: Price = { model: 'bytedance/seedream-v5.5/edit', enabled: true, out: { '1k': 20, '1.5k': 20, '2k': 35 }, perInput: 8 };
const ref = (id: string) => ({ id, objectPath: `ws/references/${id}.png` });

test('series plan: channel decides the level; a base never feeds a lower level', () => {
  assert.equal(CHANNEL_LEVEL.INSTAGRAM, 'PUBLIC'); assert.equal(CHANNEL_LEVEL.FANVUE_FEED, 'NSFW'); assert.equal(CHANNEL_LEVEL.FANVUE_CHAT, 'EXPLICIT');
  assert.deepEqual(channelsFor('PUBLIC'), ['INSTAGRAM', 'INSTAGRAM_STORY', 'TEASER', 'FANVUE_FEED', 'FANVUE_CHAT']);
  assert.deepEqual(channelsFor('NSFW'), ['FANVUE_FEED', 'FANVUE_CHAT']);
  assert.deepEqual(channelsFor('EXPLICIT'), ['FANVUE_CHAT']);
});

test('series plan: references by level — never an adult reference in a public series', () => {
  const all = { face: ref('f'), body: ref('b'), adultBody: ref('a') };
  assert.deepEqual(seriesRefs('PUBLIC', all).map((r) => r.id), ['f'], 'public: face only, the clothed body would compete with the base outfit');
  assert.deepEqual(seriesRefs('NSFW', all).map((r) => r.id), ['f', 'a']);
  assert.deepEqual(seriesRefs('EXPLICIT', { face: ref('f'), body: ref('b') }).map((r) => r.id), ['f']);
  assert.throws(() => seriesRefs('PUBLIC', { body: ref('b') }), /cara de frente/);
});

test('series plan: scenes and cost in mills', () => {
  assert.deepEqual(cleanScenes([' sentada en la cama ', 'mirando por la ventana']), ['sentada en la cama', 'mirando por la ventana']);
  assert.throws(() => cleanScenes(['una sola']), /2 a 6/);
  assert.throws(() => cleanScenes(['a', 'b', 'c', 'd', 'e', 'f', 'g']), /2 a 6/);
  assert.throws(() => cleanScenes(['ok', ' ']), /1 a 300/);
  assert.throws(() => cleanScenes(['ok', 'x'.repeat(301)]), /1 a 300/);
  assert.deepEqual(quoteSeries({ shots: 4, refs: 2, resolution: '1k', price }), { perPhotoMills: 44, totalMills: 176, inputs: 3 });
  assert.equal(quoteSeries({ shots: 6, refs: 3, resolution: '1k', price }).totalMills, 312);
});

test('series prompts: identity first, continuity rule, scene, then the change instruction', () => {
  const p = buildSeriesPrompt({ fixedPrompt: 'Vesper Corvus, a clearly adult 29-year-old woman.', scene: 'sentada en la cama mirando el teléfono', instruction: 'x'.repeat(400) });
  assert.ok(p.startsWith('Vesper Corvus, a clearly adult'));
  assert.ok(p.includes(`${CONTINUITY} sentada en la cama mirando el teléfono`));
  assert.match(CONTINUITY, /keep exactly the same outfit, hairstyle, makeup, jewelry, location and lighting as image 1/);
  assert.match(CONTINUITY, /ignore their clothing/);
  assert.match(CONTINUITY, /Only one woman/);
  assert.ok(p.endsWith('x'.repeat(300)) && !p.includes('x'.repeat(301)));
  assert.throws(() => buildSeriesPrompt({ fixedPrompt: 'y'.repeat(4000), scene: 'z' }), /largo/);
});

// ---------------- Handler ----------------
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KEY = 'ws-secret-key-123';
function harness(over: Partial<SeriesDependencies> = {}) {
  const series = new Map<string, SeriesRow>(); const takes = new Map<string, SeriesTakeRow>();
  const submitted: { images: string[]; prompt: string }[] = []; const assets: Record<string, unknown>[] = []; const placed: unknown[][] = [];
  let spent = 0; let n = 0;
  const polls = new Map<string, { status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; outputUrl?: string; error?: string }>();
  const d: SeriesDependencies = {
    async price(m) { return m === price.model ? price : null; },
    async fixedPrompt() { return 'Vesper Corvus, a clearly adult 29-year-old woman.'; },
    async identityLocked(_w, c) { return c === 'vesper-corvus'; },
    async baseAsset(_w, c, id) { return c === 'vesper-corvus' && id.startsWith('base') ? { id, objectPath: `${ws}/${id}.jpg`, level: id === 'base-nsfw' ? 'NSFW' : 'PUBLIC' } : null; },
    async currentRefs() { return { face: ref('face'), body: ref('body'), adultBody: ref('adult') }; },
    async monthSpendMills() { return spent; },
    async createSeries(_a, s, t) { const tot = t.reduce((x, y) => x + y.cost_mills, 0); if (spent + tot > 10000) throw Object.assign(new Error('cap'), { cap: true }); spent += tot; series.set(s.id, { ...s, collection_id: 'col-1' }); for (const x of t) takes.set(x.id, x); },
    async addSeriesTake(_a, t) { if (spent + t.cost_mills > 10000) throw Object.assign(new Error('cap'), { cap: true }); spent += t.cost_mills; takes.set(t.id, t); },
    async loadSeries(_w, id) { const s = series.get(id); return s ? { series: s, takes: [...takes.values()].filter((t) => t.series_id === id) } : null; },
    async loadSeriesTake(_w, id) { return takes.get(id) ?? null; },
    async updateTake(id, patch) { takes.set(id, { ...takes.get(id)!, ...patch }); },
    async claimTake(id) { const t = takes.get(id)!; if (t.status !== 'QUEUED') return false; takes.set(id, { ...t, status: 'PENDING' }); return true; },
    async signedUrl(p) { return `signed:${p}`; },
    async secret() { return KEY; },
    async submit(_k, _m, body) { submitted.push({ images: body.images, prompt: body.prompt }); return `pred-${submitted.length}`; },
    async poll(_k, id) { return polls.get(id) ?? { status: 'PENDING' }; },
    async storeOutput(_u, path) { return { path, sha256: 'c'.repeat(64), byteSize: 10, mime: 'image/png' }; },
    async registerSeriesPhoto(row) { assets.push(row as unknown as Record<string, unknown>); },
    async placeInCollection(_w, col, pos, asset, payload) { placed.push([col, pos, asset, payload]); },
    newId: () => `id-${++n}`,
    ...over,
  };
  const call = async (b: Record<string, unknown>) => handleSeries(d, owner, ws, b);
  return { d, series, takes, submitted, assets, placed, polls, call, setSpent: (v: number) => { spent = v; }, getSpent: () => spent };
}
const start = { action: 'SERIES_START', character: 'vesper-corvus', baseAssetId: 'base-1', channel: 'INSTAGRAM', model: price.model, resolution: '1k',
  scenes: ['sentada en la cama mirando el teléfono', 'de pie junto a la ventana', 'acomodándose el pelo frente al espejo'], attestNotReal: true, expectedTotalMills: 108 };

test('series handler: identity, base, level and attestation are checked before any spend', async () => {
  const h = harness();
  assert.match(String((await h.call({ ...start, character: 'raxi-vox' })).body.error), /bloquea la identidad/);
  assert.match(String((await h.call({ ...start, baseAssetId: 'otra' })).body.error), /no es de esta modelo/);
  assert.match(String((await h.call({ ...start, baseAssetId: 'base-nsfw' })).body.error), /nunca baja de nivel/);
  assert.match(String((await h.call({ ...start, attestNotReal: false })).body.error), /persona real/);
  assert.equal((await h.call({ ...start, expectedTotalMills: 100 })).status, 409);
  assert.equal(h.submitted.length, 0);
  assert.equal(h.getSpent(), 0);
});

test('series handler: QUOTE shows the allowed channels and spends nothing', async () => {
  const h = harness();
  const r = await h.call({ ...start, action: 'SERIES_QUOTE', baseAssetId: 'base-nsfw', channel: 'FANVUE_FEED' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.channels, ['FANVUE_FEED', 'FANVUE_CHAT']);
  assert.equal(r.body.totalMills, 3 * (20 + 8 * 3), 'Fanvue adds the adult body: base + face + adult body');
  assert.equal(h.submitted.length, 0);
});

test('series handler: a public series sends base + general face only, every photo at once', async () => {
  const h = harness();
  const r = await h.call(start);
  assert.equal(r.status, 200);
  assert.equal(h.getSpent(), 108);
  assert.equal(h.submitted.length, 3);
  for (const s of h.submitted) assert.deepEqual(s.images, [`signed:${ws}/base-1.jpg`, 'signed:ws/references/face.png']);
  assert.ok(h.submitted.every((s) => !s.images.some((i) => i.includes('adult'))), 'no adult reference in a public series');
  assert.match(h.submitted[1].prompt, /de pie junto a la ventana$/);
  assert.ok(!JSON.stringify(r.body).includes(KEY));
});

test('series handler: a Fanvue series may add the adult body reference', async () => {
  const h = harness();
  const r = await h.call({ ...start, baseAssetId: 'base-nsfw', channel: 'FANVUE_FEED', expectedTotalMills: 132 });
  assert.equal(r.status, 200);
  assert.ok(h.submitted[0].images.includes('signed:ws/references/adult.png'));
});

test('series handler: cap, status, retake and choose', async () => {
  const h = harness(); h.setSpent(9900);
  assert.equal((await h.call(start)).status, 402);
  h.setSpent(0);
  const { seriesId } = (await h.call(start)).body as { seriesId: string };
  h.polls.set('pred-1', { status: 'SUCCEEDED', outputUrl: 'https://cdn.example/1.png' });
  h.polls.set('pred-2', { status: 'FAILED', error: 'rejected' });
  const st = await h.call({ action: 'SERIES_STATUS', seriesId });
  const shots = (st.body.takes as { shot: number; status: string; previewUrl: string | null }[]);
  assert.deepEqual(shots.map((t) => [t.shot, t.status]), [[1, 'SUCCEEDED'], [2, 'FAILED'], [3, 'PENDING']]);
  assert.equal(shots[0].previewUrl, `signed:${ws}/series/${seriesId}/1/1.png`);
  assert.equal((await h.call({ action: 'SERIES_RETAKE', seriesId, shot: 2, expectedCostMills: 40 })).status, 409);
  const rt = await h.call({ action: 'SERIES_RETAKE', seriesId, shot: 2, instruction: 'sin el teléfono', expectedCostMills: 36 });
  assert.equal(rt.status, 200);
  assert.match(h.submitted.at(-1)!.prompt, /sin el teléfono$/);
  const first = [...h.takes.values()].find((t) => t.shot_no === 1)!;
  assert.equal((await h.call({ action: 'SERIES_CHOOSE', takeId: [...h.takes.values()].find((t) => t.shot_no === 3)!.id })).status, 409, 'not ready yet');
  const ch = await h.call({ action: 'SERIES_CHOOSE', takeId: first.id });
  assert.equal(ch.status, 200);
  assert.equal(h.assets.length, 1);
  assert.equal((h.assets[0].metadata as Record<string, unknown>).content_level, 'PUBLIC');
  assert.equal(h.assets[0].kind, 'ORIGINAL');
  assert.deepEqual(h.placed[0].slice(0, 3), ['col-1', 2, ch.body.assetId], 'shot 1 goes after the base (position 1)');
  assert.equal((await h.call({ action: 'SERIES_CHOOSE', takeId: first.id })).body.duplicate, true);
  assert.equal(h.assets.length, 1);
});

// ---------------- Migration ----------------
async function migrated() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.raxi_workspaces(id uuid primary key, owner_user_id uuid not null, slug text not null);
    create table public.raxi_assets(id uuid primary key, workspace_id uuid, kind text, object_path text, metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz);
    create table public.raxi_identity_versions(workspace_id uuid, character_id text, version int, status text);
    create table public.raxi_portfolio_collections(id uuid primary key, workspace_id uuid, external_id text, character_id text, title text, channel text, status text, concept text, payload jsonb);
    create table public.raxi_portfolio_items(workspace_id uuid, collection_id uuid, position int, asset_id uuid, payload jsonb);
    insert into public.raxi_workspaces values ('${ws}', '${owner}', 'raxi-hq');`);
  for (const f of ['20261118000000_raxi_hq_sheet_creator.sql', '20261118030000_raxi_hq_continuity_series.sql'])
    await db.exec(readFileSync(join(process.cwd(), `../../supabase/migrations/${f}`), 'utf8'));
  const asset = (id: string, kind: string, lvl: string, extra = '') => `('${id}', '${ws}', '${kind}', '${ws}/${id}.png', '{"character_id":"vesper-corvus","content_level":"${lvl}"${extra}}')`;
  await db.exec(`insert into public.raxi_assets (id, workspace_id, kind, object_path, metadata) values
    ${asset('10000000-0000-4000-8000-000000000001', 'ORIGINAL', 'PUBLIC')}, ${asset('10000000-0000-4000-8000-000000000002', 'ORIGINAL', 'NSFW')},
    ${asset('10000000-0000-4000-8000-000000000003', 'REFERENCE', 'PUBLIC', ',"angle":"FRONT"')}, ${asset('10000000-0000-4000-8000-000000000004', 'REFERENCE', 'NSFW', ',"angle":"BODY_FRONT"')},
    ${asset('10000000-0000-4000-8000-000000000005', 'REFERENCE', 'PUBLIC', ',"angle":"BODY_FRONT","superseded_by":"x"')}`);
  return db;
}
const S = (over: Record<string, unknown> = {}) => JSON.stringify({ id: crypto.randomUUID(), character_id: 'vesper-corvus', channel: 'INSTAGRAM', level: 'PUBLIC',
  base_asset_id: '10000000-0000-4000-8000-000000000001', ref_asset_ids: ['10000000-0000-4000-8000-000000000003'], scenes: ['a', 'b'],
  model: price.model, resolution: '1k', ceiling_mills: 100, attested_not_real: true, title: 'Habitación', ...over });
const T = (seriesJson: string, cost = 44, shots = 2) => { const id = JSON.parse(seriesJson).id;
  return JSON.stringify(Array.from({ length: shots }, (_, i) => ({ id: crypto.randomUUID(), series_id: id, shot_no: i + 1, take_no: 1, prompt: 'p', input_count: 3, cost_mills: cost }))); };

test('series migration: every rule is enforced by the database', async () => {
  const db = await migrated();
  const create = (s: string, t = T(s)) => db.query(`select public.raxi_series_create($1::uuid, $2::jsonb, $3::jsonb)`, [owner, s, t]);
  await assert.rejects(create(S()), /identity not locked/);
  await db.exec(`insert into public.raxi_identity_versions values ('${ws}', 'vesper-corvus', 3, 'LOCKED')`);
  await assert.rejects(create(S({ base_asset_id: '10000000-0000-4000-8000-000000000002' })), /never goes below/);
  await assert.rejects(create(S({ ref_asset_ids: ['10000000-0000-4000-8000-000000000004'] })), /invalid reference/, 'adult reference in a public series');
  await assert.rejects(create(S({ ref_asset_ids: ['10000000-0000-4000-8000-000000000005'] })), /invalid reference/, 'retired reference');
  await assert.rejects(create(S({ attested_not_real: false })), /attestation/);
  await assert.rejects(create(S({ ceiling_mills: 50 })), /ceiling/);
  const ok = S();
  await create(ok);
  const id = JSON.parse(ok).id;
  const items = await db.query<{ position: number }>(`select position from public.raxi_portfolio_items order by position`);
  assert.deepEqual(items.rows.map((r) => r.position), [1], 'the base opens the series collection');
  assert.equal(Number((await db.query<{ s: number }>(`select public.raxi_sheet_month_spend('${owner}') as s`)).rows[0].s), 88, 'series share the monthly cap with sheets');
  const fanvue = S({ channel: 'FANVUE_FEED', level: 'NSFW', base_asset_id: '10000000-0000-4000-8000-000000000002', ref_asset_ids: ['10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'] });
  await create(fanvue);
  await assert.rejects(db.query(`insert into public.raxi_sheet_takes (id, run_id, series_id, workspace_id, view, shot_no, take_no, prompt, input_count, cost_mills)
    values (gen_random_uuid(), null, '${id}', '${ws}', 'FRONT', 1, 9, 'p', 1, 1)`), /owner_kind/, 'a take is either a sheet view or a series shot');
  await assert.rejects(create(S({ channel: 'INSTAGRAM', level: 'NSFW' })), 'channel and level must agree');
});

test('series migration: clients can only read', () => {
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261118030000_raxi_hq_continuity_series.sql'), 'utf8');
  assert.match(sql, /revoke all on public\.raxi_series from anon, authenticated/);
  assert.match(sql, /grant select on public\.raxi_series to authenticated/);
  assert.match(sql, /revoke all on function public\.raxi_series_create\(uuid, jsonb, jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.raxi_series_create\(uuid, jsonb, jsonb\) to service_role/);
});

// ---------------- Continuity inside a campaign ----------------
import { continuityBlocked, continuityGroups, continuityOf, continuationScene, continuityOrder } from '../../../supabase/functions/raxi-agent-runner/continuity';

test('campaign continuity: only valid continuations of an earlier new photo, max 6 per base', () => {
  assert.deepEqual(continuityOf([{}, { continuidad_de: 1 }, { continuidad_de: 1 }, { continuidad_de: 2 }, { continuidad_de: 9 }, { continuidad_de: 5 }, { continuidad_de: 7 }]),
    [null, 1, 1, null, null, 5, null], 'a continuation of a continuation, of a future post or of itself becomes a new photo');
  const many = [{}, ...Array.from({ length: 8 }, () => ({ continuidad_de: 1 }))];
  assert.equal(continuityOf(many).filter((b) => b === 1).length, 6);
  assert.equal(continuationScene({ escena: 'sitting on the bed', plano: 'close-up, looking at the phone' }), 'sitting on the bed. close-up, looking at the phone');
});

test('campaign continuity: groups wait for nothing but skip rejected, made or started photos', () => {
  const it = (id: string, position: number, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, position, asset_id: null, payload, ...extra });
  const groups = continuityGroups([
    it('a', 1, { kind: 'PHOTO_TO_GENERATE' }, { asset_id: 'base-asset' }),
    it('b', 2, { kind: 'PHOTO_TO_CONTINUE', base_position: 1, scene: 'sitting' }),
    it('c', 3, { kind: 'PHOTO_TO_CONTINUE', base_position: 1, scene: 'standing' }, { human_decision: 'REJECTED' }),
    it('d', 4, { kind: 'PHOTO_TO_CONTINUE', base_position: 1, scene: 'done' }, { asset_id: 'x' }),
    it('e', 5, { kind: 'PHOTO_TO_CONTINUE', base_position: 1, scene: 'started', series_id: 's' }),
  ] as never);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['b']);
  assert.equal(groups[0].baseAssetId, 'base-asset');
});

test('campaign continuity: Fanvue and missing prerequisites block it; the order prices it in mills', () => {
  const ok = { channel: 'INSTAGRAM', identityLocked: true, hasGeneralRefs: true, keyConnected: true, priceEnabled: true };
  assert.equal(continuityBlocked(ok), null);
  assert.match(String(continuityBlocked({ ...ok, channel: 'FANVUE_FEED' })), /serie pendiente/);
  assert.match(String(continuityBlocked({ ...ok, identityLocked: false })), /identidad/);
  assert.match(String(continuityBlocked({ ...ok, keyConnected: false })), /WaveSpeed/);
  const g = [{ basePosition: 1, baseItemId: 'a', baseAssetId: null, items: [{ id: 'b' }, { id: 'c' }, { id: 'd' }], scenes: ['x', 'y', 'z'] }] as never;
  const order = continuityOrder(g, 44, null)!;
  assert.equal(order.total_mills, 132); assert.equal(order.total_usd, 0.132);
  assert.deepEqual(order.grupos[0].item_ids, ['b', 'c', 'd']);
  const blocked = continuityOrder(g, 44, 'motivo')!;
  assert.equal(blocked.total_usd, 0, 'a blocked continuity adds nothing to the approved amount');
  assert.equal(continuityOrder([], 44, null), null);
});

test('series migration: a series started by a campaign creates no extra Fototeca collection', async () => {
  const db = await migrated();
  await db.exec(`insert into public.raxi_identity_versions values ('${ws}', 'vesper-corvus', 3, 'LOCKED')`);
  const s = S({ proposal_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
  await db.query(`select public.raxi_series_create($1::uuid, $2::jsonb, $3::jsonb)`, [owner, s, T(s)]);
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from public.raxi_portfolio_collections`)).rows[0].n), 0);
  assert.equal((await db.query<{ c: string | null }>(`select collection_id as c from public.raxi_series`)).rows[0].c, null);
});
