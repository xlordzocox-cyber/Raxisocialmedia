import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { buildTestPrompt, cleanTestScenes, handleModelTest, quoteTest, TEST_MODELS, TEST_RULE, type ModelTestDependencies, type ModelTestRow, type TestTakeRow } from '../../../supabase/functions/sheet-creator/modelTest';
import { createWaveSpeed } from '../../../supabase/functions/sheet-creator/wavespeed';
import type { Price } from '../../../supabase/functions/sheet-creator/sheetPlan';

const seedream: Price = { model: TEST_MODELS[0], enabled: true, out: { '1k': 20, '1.5k': 20, '2k': 35 }, perInput: 8 };
const pulid: Price = { model: TEST_MODELS[1], enabled: true, out: { '1k': 20, '1.5k': 20, '2k': 20 }, perInput: 0 };
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KEY = 'ws-secret-key-123';

test('model test plan: 1-3 scenes, same text for both models, priced per arm in mills', () => {
  assert.deepEqual(cleanTestScenes([' a ', 'b']), ['a', 'b']);
  assert.throws(() => cleanTestScenes([]), /1 a 3/);
  assert.throws(() => cleanTestScenes(['a', 'b', 'c', 'd']), /1 a 3/);
  assert.throws(() => cleanTestScenes(['x'.repeat(301)]), /300/);
  assert.deepEqual(quoteTest({ scenes: 3, seedream, pulid }), { perArm: [28, 20], perSceneMills: 48, totalMills: 144 });
  const p = buildTestPrompt('Vesper Corvus, a clearly adult woman.', 'reading');
  assert.ok(p.startsWith('Vesper Corvus') && p.includes(TEST_RULE) && p.endsWith('reading'));
  assert.match(TEST_RULE, /ignore its clothing/); assert.match(TEST_RULE, /clearly an adult/);
});

test('wavespeed: FLUX-PuLID takes one image; free model names and mismatched bodies are refused', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({ data: { id: 'p1' } }); }) as unknown as typeof fetch;
  const w = createWaveSpeed(f);
  assert.equal(await w.submit(KEY, 'wavespeed-ai/flux-pulid', { prompt: 'p', image: 'u', guidance_scale: 3.5 }), 'p1');
  assert.equal(calls[0].url, 'https://api.wavespeed.ai/api/v3/wavespeed-ai/flux-pulid');
  assert.deepEqual(calls[0].body, { prompt: 'p', image: 'u', guidance_scale: 3.5, output_format: 'png' });
  await assert.rejects(w.submit(KEY, 'wavespeed-ai/flux-dev', { prompt: 'p', image: 'u' }), /modelo/);
  await assert.rejects(w.submit(KEY, 'wavespeed-ai/flux-pulid', { prompt: 'p', images: ['u'], resolution: '1k' }), /no corresponde/);
  await assert.rejects(w.submit(KEY, 'bytedance/seedream-v5.5/edit', { prompt: 'p', image: 'u' }), /no corresponde/);
});

function harness(over: Partial<ModelTestDependencies> = {}) {
  const tests = new Map<string, ModelTestRow>(); const takes = new Map<string, TestTakeRow>();
  const submitted: { model: string; body: Record<string, unknown> }[] = [];
  const polls = new Map<string, { status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; outputUrl?: string; error?: string }>();
  let spent = 0; let n = 0; const coins = [1, 0, 1];
  const d: ModelTestDependencies = {
    async price(m) { return m === seedream.model ? seedream : m === pulid.model ? pulid : null; },
    async fixedPrompt() { return 'Vesper Corvus, a clearly adult woman.'; },
    async identityLocked(_w, c) { return c === 'vesper-corvus'; },
    async currentRefs() { return { face: { id: 'face', objectPath: `${ws}/references/face.png` } }; },
    async monthSpendMills() { return spent; },
    async createModelTest(_a, t, tk) { const tot = tk.reduce((x, y) => x + y.cost_mills, 0); if (spent + tot > 10000) throw Object.assign(new Error('cap'), { cap: true }); spent += tot; tests.set(t.id, t); for (const x of tk) takes.set(x.id, x); },
    async loadModelTest(_w, id) { const t = tests.get(id); return t ? { test: t, takes: [...takes.values()].filter((x) => x.test_id === id) } : null; },
    async updateModelTest(id, patch) { tests.set(id, { ...tests.get(id)!, ...patch }); },
    async updateTake(id, patch) { takes.set(id, { ...takes.get(id)!, ...patch }); },
    async claimTake(id) { const t = takes.get(id)!; if (t.status !== 'QUEUED') return false; takes.set(id, { ...t, status: 'PENDING' }); return true; },
    async signedUrl(p) { return `signed:${p}`; },
    async secret() { return KEY; },
    async submit(_k, model, body) { submitted.push({ model, body: body as unknown as Record<string, unknown> }); return `pred-${submitted.length}`; },
    async poll(_k, id) { return polls.get(id) ?? { status: 'PENDING' }; },
    async storeOutput(_u, path) { return { path, sha256: 'c'.repeat(64), byteSize: 10, mime: 'image/png' }; },
    coin: () => coins.shift() ?? 0,
    newId: () => `0000000${++n}-0000-4000-8000-000000000000`.slice(-36),
    ...over,
  };
  return { d, tests, takes, submitted, polls, call: (b: Record<string, unknown>) => handleModelTest(d, owner, ws, b), setSpent: (v: number) => { spent = v; } };
}
const SCENES = ['close portrait', 'library', 'bridge'];

test('model test handler: priced click, both models get the same face and text, cap enforced', async () => {
  const h = harness();
  const q = await h.call({ action: 'MODELTEST_QUOTE', character: 'vesper-corvus', scenes: SCENES });
  assert.equal(q.body.totalMills, 144);
  const start = { action: 'MODELTEST_START', character: 'vesper-corvus', scenes: SCENES, attestNotReal: true, expectedTotalMills: 144 };
  assert.equal((await h.call({ ...start, attestNotReal: false })).status, 400);
  assert.equal((await h.call({ ...start, expectedTotalMills: 100 })).status, 409);
  assert.match(String((await h.call({ ...start, character: 'raxi-vox' })).body.error), /bloquea la identidad/);
  h.setSpent(9900); assert.equal((await h.call(start)).status, 402); h.setSpent(0);
  assert.equal(h.submitted.length, 0, 'nothing sent before every check passes');
  const r = await h.call(start);
  assert.equal(r.status, 200);
  assert.equal(h.submitted.length, 6);
  const face = `signed:${ws}/references/face.png`;
  for (let i = 0; i < 3; i++) {
    const [a, b] = [h.submitted[i * 2], h.submitted[i * 2 + 1]];
    assert.equal(a.model, TEST_MODELS[0]); assert.deepEqual(a.body.images, [face]); assert.equal(a.body.resolution, '1.5k');
    assert.equal(b.model, TEST_MODELS[1]); assert.equal(b.body.image, face); assert.equal(b.body.guidance_scale, 3.5);
    assert.equal(a.body.prompt, b.body.prompt, 'identical text for both models');
  }
  assert.ok(!JSON.stringify(r.body).includes(KEY));
  assert.ok(!JSON.stringify(r.body).includes('Seedream') && !JSON.stringify(r.body).includes('PuLID'), 'blind until revealed');
});

test('model test handler: blind A/B per scene, votes, reveal and tally', async () => {
  const h = harness();
  const id = (await h.call({ action: 'MODELTEST_START', character: 'vesper-corvus', scenes: SCENES, attestNotReal: true, expectedTotalMills: 144 })).body.testId as string;
  for (let i = 1; i <= 6; i++) h.polls.set(`pred-${i}`, { status: 'SUCCEEDED', outputUrl: `https://cdn/${i}.png` });
  const st = await h.call({ action: 'MODELTEST_STATUS', testId: id });
  const sc = st.body.scenes as { A: { previewUrl: string }; B: { previewUrl: string } }[];
  // coins [1,0,1]: scene 1 shows PuLID (arm 1) as A, scene 2 shows Seedream as A.
  assert.match(sc[0].A.previewUrl, /\/1\/1-1\.png$/); assert.match(sc[0].B.previewUrl, /\/1\/0-1\.png$/);
  assert.match(sc[1].A.previewUrl, /\/2\/0-1\.png$/);
  assert.equal((await h.call({ action: 'MODELTEST_REVEAL', testId: id })).status, 409, 'vote every scene first');
  assert.equal((await h.call({ action: 'MODELTEST_VOTE', testId: id, scene: 4, vote: 'A' })).status, 400);
  assert.equal((await h.call({ action: 'MODELTEST_VOTE', testId: id, scene: 1, vote: 'X' })).status, 400);
  await h.call({ action: 'MODELTEST_VOTE', testId: id, scene: 1, vote: 'A' }); // PuLID
  await h.call({ action: 'MODELTEST_VOTE', testId: id, scene: 2, vote: 'A' }); // Seedream
  await h.call({ action: 'MODELTEST_VOTE', testId: id, scene: 3, vote: 'TIE' });
  const rv = await h.call({ action: 'MODELTEST_REVEAL', testId: id });
  assert.deepEqual(rv.body.tally, { 'Seedream 5.5': 1, 'FLUX-PuLID': 1, Empate: 1 });
  const s1 = (rv.body.scenes as { modelA: string }[])[0];
  assert.equal(s1.modelA, 'FLUX-PuLID');
  assert.equal((await h.call({ action: 'MODELTEST_VOTE', testId: id, scene: 1, vote: 'B' })).status, 409, 'votes close after the reveal');
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
    insert into public.raxi_workspaces values ('${ws}', '${owner}', 'raxi-hq');
    insert into public.raxi_identity_versions values ('${ws}', 'vesper-corvus', 3, 'LOCKED');`);
  for (const f of ['20261118000000_raxi_hq_sheet_creator.sql', '20261118030000_raxi_hq_continuity_series.sql', '20261118040000_raxi_hq_recreate.sql',
    '20261118050000_raxi_hq_recreate_fanvue.sql', '20261118060000_raxi_hq_model_test.sql'])
    await db.exec(readFileSync(join(process.cwd(), `../../supabase/migrations/${f}`), 'utf8'));
  const a = (id: string, lvl: string, angle: string, extra = '') => `('${id}', '${ws}', 'REFERENCE', '${ws}/${id}.png', '{"character_id":"vesper-corvus","content_level":"${lvl}","angle":"${angle}"${extra}}')`;
  await db.exec(`insert into public.raxi_assets (id, workspace_id, kind, object_path, metadata) values
    ${a('20000000-0000-4000-8000-000000000001', 'PUBLIC', 'FRONT')}, ${a('20000000-0000-4000-8000-000000000002', 'NSFW', 'BODY_FRONT')},
    ${a('20000000-0000-4000-8000-000000000003', 'PUBLIC', 'FRONT', ',"superseded_by":"x"')}`);
  return db;
}
const T = (o: Record<string, unknown> = {}) => JSON.stringify({ id: crypto.randomUUID(), character_id: 'vesper-corvus', face_asset_id: '20000000-0000-4000-8000-000000000001',
  scenes: ['a', 'b'], models: [...TEST_MODELS], a_index: [0, 1], ceiling_mills: 96, attested_not_real: true, ...o });
const TK = (t: string, costs = [28, 20]) => { const id = JSON.parse(t).id;
  return JSON.stringify([1, 2].flatMap((shot) => [0, 1].map((arm) => ({ id: crypto.randomUUID(), test_id: id, shot_no: shot, test_arm: arm, take_no: 1, prompt: 'p', input_count: 1, cost_mills: costs[arm] })))); };

test('model test migration: rules, ledger and blind table are enforced by the database', async () => {
  const db = await migrated();
  const create = (t: string, tk = TK(t)) => db.query(`select public.raxi_model_test_create($1::uuid, $2::jsonb, $3::jsonb)`, [owner, t, tk]);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from public.raxi_provider_prices where model = 'wavespeed-ai/flux-pulid' and enabled`)).rows[0].n, 1);
  await assert.rejects(db.query(`insert into public.raxi_provider_prices (model) values ('wavespeed-ai/anything')`), 'only allow-listed non-edit models');
  await assert.rejects(create(T({ face_asset_id: '20000000-0000-4000-8000-000000000002' })), /invalid reference/, 'never an adult reference');
  await assert.rejects(create(T({ face_asset_id: '20000000-0000-4000-8000-000000000003' })), /invalid reference/, 'retired face');
  await assert.rejects(create(T({ attested_not_real: false })), /attestation/);
  await assert.rejects(create(T({ ceiling_mills: 50 })), /ceiling/);
  await assert.rejects(create(T({ models: [TEST_MODELS[0], 'bytedance/seedream-v5.0-pro/edit'] })), /not enabled/);
  await assert.rejects(create(T({ scenes: ['a', 'b', 'c', 'd'], a_index: [0, 0, 0, 0] })), 'at most 3 scenes');
  await create(T());
  assert.equal(Number((await db.query<{ s: number }>(`select public.raxi_sheet_month_spend('${owner}') as s`)).rows[0].s), 96, 'same monthly cap ledger');
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261118060000_raxi_hq_model_test.sql'), 'utf8');
  assert.match(sql, /revoke all on public\.raxi_model_tests from anon, authenticated;/);
  assert.doesNotMatch(sql, /grant select on public\.raxi_model_tests/, 'the shuffle is never readable by the client');
  assert.match(sql, /grant execute on function public\.raxi_model_test_create\(uuid, jsonb, jsonb\) to service_role/);
});
