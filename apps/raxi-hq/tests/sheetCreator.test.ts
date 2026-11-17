import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { viewsFor, quoteRun, takeCost, chainImages, CAP_MILLS, type Price } from '../../../supabase/functions/sheet-creator/sheetPlan';
import { buildSheetPrompt, ADULT_TEMPLATE } from '../../../supabase/functions/sheet-creator/sheetPrompts';
import { createWaveSpeed } from '../../../supabase/functions/sheet-creator/wavespeed';
import { createSheetHandler, type SheetDependencies, type RunRow, type TakeRow } from '../../../supabase/functions/sheet-creator/handler';

const price: Price = { model: 'bytedance/seedream-v5.5/edit', enabled: true, out: { '1k': 20, '1.5k': 20, '2k': 35 }, perInput: 8 };

test('sheet plan: general has 6 views anchored on the face front; adult has 3 body views anchored on body front', () => {
  assert.deepEqual(viewsFor('GENERAL'), ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BODY_FRONT', 'BODY_SIDE', 'BODY_BACK']);
  assert.deepEqual(viewsFor('ADULT'), ['BODY_FRONT', 'BODY_SIDE', 'BODY_BACK']);
});

test('sheet plan: quotes in integer mills with the verified prices', () => {
  assert.equal(quoteRun({ level: 'GENERAL', sources: 1, resolution: '1k', price }).totalMills, 208);
  assert.equal(quoteRun({ level: 'GENERAL', sources: 3, resolution: '1k', price }).totalMills, 304);
  assert.equal(quoteRun({ level: 'ADULT', sources: 2, resolution: '1k', price }).totalMills, 108);
  assert.equal(quoteRun({ level: 'GENERAL', sources: 1, resolution: '2k', price }).totalMills, 35 + 8 + 5 * (35 + 16));
  assert.deepEqual(quoteRun({ level: 'GENERAL', sources: 2, resolution: '1k', price }).takes.map((t) => [t.view, t.inputs]),
    [['FRONT', 2], ['THREE_QUARTER', 3], ['PROFILE', 3], ['BODY_FRONT', 3], ['BODY_SIDE', 3], ['BODY_BACK', 3]]);
  assert.equal(takeCost(price, '1k', 4), 52);
  assert.equal(CAP_MILLS, 10000);
});

test('sheet plan: rejects disabled models, bad source counts and bad resolutions', () => {
  assert.throws(() => quoteRun({ level: 'GENERAL', sources: 1, resolution: '1k', price: { ...price, enabled: false } }), /disponible/);
  assert.throws(() => quoteRun({ level: 'GENERAL', sources: 0, resolution: '1k', price }), /fotos/);
  assert.throws(() => quoteRun({ level: 'GENERAL', sources: 4, resolution: '1k', price }), /fotos/);
  assert.throws(() => quoteRun({ level: 'ADULT', sources: 1, resolution: '1k', price }), /ficha general/);
  assert.throws(() => quoteRun({ level: 'GENERAL', sources: 1, resolution: '4k' as '1k', price }), /resolución/);
});

test('sheet plan: chain images — anchor uses the sources; the rest add the anchor first', () => {
  assert.deepEqual(chainImages('GENERAL', 'FRONT', ['s1', 's2'], null), ['s1', 's2']);
  assert.deepEqual(chainImages('GENERAL', 'PROFILE', ['s1', 's2'], 'a'), ['a', 's1', 's2']);
  assert.deepEqual(chainImages('ADULT', 'BODY_FRONT', ['gBody', 'gFace'], null), ['gBody', 'gFace']);
  assert.deepEqual(chainImages('ADULT', 'BODY_BACK', ['gBody', 'gFace'], 'a'), ['a', 'gBody']);
  assert.throws(() => chainImages('GENERAL', 'PROFILE', ['s1'], null), /frente/);
});

test('sheet prompts: identity first, headless body views, change instruction last and capped', () => {
  const p = buildSheetPrompt({ level: 'GENERAL', view: 'BODY_SIDE', fixedPrompt: 'A 25-year-old woman named Raxi Vox.', instruction: 'x'.repeat(400) });
  assert.ok(p.startsWith('A 25-year-old woman named Raxi Vox.'));
  assert.match(p, /headless, cropped at the neck, standing, natural relaxed pose/);
  assert.match(p, /side view/);
  assert.ok(p.endsWith('x'.repeat(300)) && !p.includes('x'.repeat(301)));
  const face = buildSheetPrompt({ level: 'GENERAL', view: 'FRONT', fixedPrompt: null });
  assert.doesNotMatch(face, /headless/);
  for (const view of ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'] as const) {
    const general = buildSheetPrompt({ level: 'GENERAL', view, fixedPrompt: null });
    assert.match(general, /wearing only a plain black seamless bra and matching plain black briefs, no other clothing/, `same wardrobe in ${view}`);
    assert.doesNotMatch(general, /fitted plain outfit/);
  }
  assert.doesNotMatch(buildSheetPrompt({ level: 'ADULT', view: 'BODY_FRONT', fixedPrompt: null }), /bra/, 'the adult template keeps its own wardrobe');
  for (const level of ['GENERAL', 'ADULT'] as const) for (const view of ['BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'] as const)
    assert.match(buildSheetPrompt({ level, view, fixedPrompt: null, adultTemplate: level === 'ADULT' ? 'Plantilla de Luis.' : null }), /head, face and hair are completely outside the frame, both feet fully visible/, `${level} ${view} framed to the feet`);
  assert.doesNotMatch(buildSheetPrompt({ level: 'GENERAL', view: 'FRONT', fixedPrompt: null }), /feet/, 'face views keep their framing');
  assert.match(ADULT_TEMPLATE, /artistic anatomical reference, neutral standing pose, non-sexual/);
  assert.match(buildSheetPrompt({ level: 'ADULT', view: 'BODY_FRONT', fixedPrompt: null }), /non-sexual/);
  assert.match(buildSheetPrompt({ level: 'ADULT', view: 'BODY_FRONT', fixedPrompt: null, adultTemplate: 'Plantilla de Luis.' }), /^Plantilla de Luis, framed from the neck down to the feet/);
  assert.throws(() => buildSheetPrompt({ level: 'GENERAL', view: 'FRONT', fixedPrompt: 'y'.repeat(4001) }), /largo/);
  assert.throws(() => buildSheetPrompt({ level: 'ADULT', view: 'FRONT', fixedPrompt: null }), /vista/);
});

// ---------------- WaveSpeed client ----------------
const KEY = 'ws-secret-key-123';
function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return handler(url, init); }) as unknown as typeof fetch;
  return { f, calls };
}

test('wavespeed: submit sends the bearer key and the edit body; poll maps statuses', async () => {
  const { f, calls } = fakeFetch((url) => url.endsWith('/edit')
    ? Response.json({ code: 200, data: { id: 'pred-1', status: 'created' } })
    : url.endsWith('/pred-1/result') ? Response.json({ code: 200, data: { id: 'pred-1', status: 'completed', outputs: ['https://cdn.example/o.png'] } })
    : Response.json({ code: 200, data: { id: 'pred-2', status: 'failed', error: 'rejected' } }));
  const ws = createWaveSpeed(f);
  assert.equal(await ws.submit(KEY, 'bytedance/seedream-v5.5/edit', { prompt: 'p', images: ['u1'], resolution: '1k' }), 'pred-1');
  assert.equal(calls[0].url, 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.5/edit');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { prompt: 'p', images: ['u1'], resolution: '1k', output_format: 'png' });
  assert.deepEqual(await ws.poll(KEY, 'pred-1'), { status: 'SUCCEEDED', outputUrl: 'https://cdn.example/o.png' });
  assert.equal(calls[1].url, 'https://api.wavespeed.ai/api/v3/predictions/pred-1/result');
  assert.deepEqual(await ws.poll(KEY, 'pred-2'), { status: 'FAILED', error: 'rejected' });
});

test('wavespeed: pending states, bad models and errors never leak the key', async () => {
  const { f } = fakeFetch((url) => url.includes('pred-3') ? Response.json({ data: { status: 'processing' } }) : new Response(`bad ${KEY}`, { status: 500 }));
  const ws = createWaveSpeed(f);
  assert.deepEqual(await ws.poll(KEY, 'pred-3'), { status: 'PENDING' });
  await assert.rejects(ws.submit(KEY, 'bytedance/seedream-v5.5/edit', { prompt: 'p', images: ['u'], resolution: '1k' }), (e: Error) => !e.message.includes(KEY));
  await assert.rejects(ws.submit(KEY, '../../x', { prompt: 'p', images: ['u'], resolution: '1k' }), /modelo/);
  await assert.rejects(ws.poll(KEY, 'a/b'), /predicción/);
});

// ---------------- Handler ----------------
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const wsId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function harness(over: Partial<SheetDependencies> = {}) {
  const runs = new Map<string, RunRow>();
  const takes = new Map<string, TakeRow>();
  const submitted: { model: string; images: string[]; prompt: string }[] = [];
  const registered: Record<string, unknown>[] = [];
  let spent = 0; let n = 0; let predN = 0;
  const polls = new Map<string, { status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; outputUrl?: string; error?: string }>();
  const deps: SheetDependencies = {
    async verifyUser(t) { return t === 'good' ? { id: owner, isAnonymous: false } : null; },
    async workspaceOf() { return wsId; },
    async price(model) { return model === price.model ? price : null; },
    async fixedPrompt() { return 'A 25-year-old woman named Raxi Vox.'; },
    async sourceAssets(_ws, character, ids) { return ids.every((id) => id.startsWith(`${character}:`)) ? ids.map((id) => ({ id, objectPath: `${wsId}/references/${id}.jpg` })) : null; },
    async generalAnchors(_ws, character) { return character === 'raxi-vox' ? { FRONT: { id: 'gF', objectPath: `${wsId}/gF.png` }, BODY_FRONT: { id: 'gB', objectPath: `${wsId}/gB.png` } } : {}; },
    async monthSpendMills() { return spent; },
    async createRun(_actor, run, rows) {
      const total = rows.reduce((s, r) => s + r.cost_mills, 0);
      if (spent + total > CAP_MILLS) throw Object.assign(new Error('cap'), { cap: true });
      spent += total; runs.set(run.id, run); for (const r of rows) takes.set(r.id, r);
    },
    async addTake(_actor, row) { if (spent + row.cost_mills > CAP_MILLS) throw Object.assign(new Error('cap'), { cap: true }); spent += row.cost_mills; takes.set(row.id, row); },
    async loadRun(_ws, id) { const run = runs.get(id); return run ? { run, takes: [...takes.values()].filter((t) => t.run_id === id) } : null; },
    async loadTake(_ws, id) { return takes.get(id) ?? null; },
    async updateTake(id, patch) { const t = takes.get(id)!; takes.set(id, { ...t, ...patch }); if (patch.status === 'CANCELLED' || (patch.status === 'FAILED' && !t.prediction_id)) spent -= t.cost_mills; },
    async claimTake(id) { const t = takes.get(id)!; if (t.status !== 'QUEUED') return false; takes.set(id, { ...t, status: 'PENDING' }); return true; },
    async signedUrl(path) { return `signed:${path}`; },
    async secret() { return KEY; },
    async submit(_key, model, body) { submitted.push({ model, images: body.images, prompt: body.prompt }); return `pred-${++predN}`; },
    async poll(_key, id) { return polls.get(id) ?? { status: 'PENDING' }; },
    async storeOutput(_url, path) { return { path, sha256: 'c'.repeat(64), byteSize: 10, mime: 'image/png' }; },
    async registerReference(row) { registered.push(row as unknown as Record<string, unknown>); },
    newId: () => `id-${++n}`,
    ...over,
  };
  const call = (body: unknown, token = 'good') => createSheetHandler(deps)(new Request('http://x/sheet-creator', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { deps, runs, takes, submitted, registered, polls, call, setSpent: (v: number) => { spent = v; }, getSpent: () => spent };
}
const startBody = { action: 'START', character: 'raxi-vox', level: 'GENERAL', model: price.model, resolution: '1k', sourceIds: ['raxi-vox:s1'], attestNotReal: true, expectedTotalMills: 208 };

test('sheet handler: session, roster and attestation are required', async () => {
  const h = harness();
  assert.equal((await h.call(startBody, 'bad')).status, 401);
  assert.equal((await h.call({ ...startBody, character: 'nadie' })).status, 400);
  const r = await h.call({ ...startBody, attestNotReal: false });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /persona real/);
  assert.equal((await h.call({ ...startBody, sourceIds: ['vesper-corvus:s1'] })).status, 400, 'sources must belong to the model');
  assert.equal(h.submitted.length, 0);
});

test('sheet handler: QUOTE spends nothing and reports the month', async () => {
  const h = harness(); h.setSpent(1500);
  const r = await h.call({ ...startBody, action: 'QUOTE' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { totalMills: 208, spentMills: 1500, capMills: 10000, takes: [20 + 8, 36, 36, 36, 36, 36] });
  assert.equal(h.submitted.length, 0);
  assert.equal(h.getSpent(), 1500);
});

test('sheet handler: START rejects a stale price and the monthly cap', async () => {
  const h = harness();
  assert.equal((await h.call({ ...startBody, expectedTotalMills: 200 })).status, 409);
  h.setSpent(9900);
  const r = await h.call(startBody);
  assert.equal(r.status, 402);
  assert.match((await r.json()).error, /\$9\.90 de \$10/);
  assert.equal(h.submitted.length, 0);
});

test('sheet handler: START reserves the whole sheet and submits only the anchor', async () => {
  const h = harness();
  const r = await h.call(startBody);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(h.getSpent(), 208);
  assert.equal(h.submitted.length, 1);
  assert.deepEqual(h.submitted[0].images, [`signed:${wsId}/references/raxi-vox:s1.jpg`]);
  assert.match(h.submitted[0].prompt, /^A 25-year-old woman named Raxi Vox\./);
  const takes = [...h.takes.values()];
  assert.deepEqual(takes.map((t) => [t.view, t.status]), [['FRONT', 'PENDING'], ['THREE_QUARTER', 'QUEUED'], ['PROFILE', 'QUEUED'], ['BODY_FRONT', 'QUEUED'], ['BODY_SIDE', 'QUEUED'], ['BODY_BACK', 'QUEUED']]);
  assert.equal(h.runs.get(body.runId)?.attested_not_real, true);
  assert.ok(!JSON.stringify(body).includes(KEY));
});

test('sheet handler: STATUS stores the anchor and chains the rest; a failed anchor cancels and refunds', async () => {
  const h = harness();
  const { runId } = await (await h.call(startBody)).json();
  h.polls.set('pred-1', { status: 'SUCCEEDED', outputUrl: 'https://cdn.example/a.png' });
  const r = await h.call({ action: 'STATUS', runId });
  assert.equal(r.status, 200);
  assert.equal(h.submitted.length, 6);
  const anchorPath = `${wsId}/sheets/${runId}/FRONT/1.png`;
  for (const s of h.submitted.slice(1)) assert.deepEqual(s.images, [`signed:${anchorPath}`, `signed:${wsId}/references/raxi-vox:s1.jpg`]);
  const view = await r.json();
  assert.equal(view.takes.find((t: { view: string }) => t.view === 'FRONT').previewUrl, `signed:${anchorPath}`);
  assert.ok(!JSON.stringify(view).includes(KEY));

  const h2 = harness();
  const s2 = await (await h2.call(startBody)).json();
  h2.polls.set('pred-1', { status: 'FAILED', error: 'content rejected' });
  await h2.call({ action: 'STATUS', runId: s2.runId });
  assert.equal(h2.submitted.length, 1);
  assert.deepEqual([...h2.takes.values()].map((t) => t.status), ['FAILED', 'CANCELLED', 'CANCELLED', 'CANCELLED', 'CANCELLED', 'CANCELLED']);
  assert.equal(h2.getSpent(), 28, 'queued takes are released; a submitted take that failed still counts (conservative: WaveSpeed billing of failures is unverified)');
});

test('sheet handler: concurrent STATUS calls submit each queued take only once', async () => {
  const h = harness({ async submit(_k, _m, body) { await new Promise((r) => setTimeout(r, 5)); h.submitted.push({ model: 'm', images: body.images, prompt: body.prompt }); return `pred-${h.submitted.length}`; } });
  const { runId } = await (await h.call(startBody)).json();
  h.polls.set('pred-1', { status: 'SUCCEEDED', outputUrl: 'https://cdn.example/a.png' });
  await Promise.all([h.call({ action: 'STATUS', runId }), h.call({ action: 'STATUS', runId })]);
  assert.equal(h.submitted.length, 6, 'anchor + 5 views, no duplicates');
});

test('sheet handler: adult sheets need the chosen general face and body, and use them as sources', async () => {
  const h = harness();
  const adult = { ...startBody, level: 'ADULT', sourceIds: [], expectedTotalMills: 108 };
  assert.equal((await h.call({ ...adult, character: 'vesper-corvus' })).status, 400);
  const r = await h.call(adult);
  assert.equal(r.status, 200);
  assert.deepEqual(h.submitted[0].images, [`signed:${wsId}/gB.png`, `signed:${wsId}/gF.png`]);
  assert.match(h.submitted[0].prompt, /non-sexual/);
  assert.deepEqual([...h.takes.values()].map((t) => t.view), ['BODY_FRONT', 'BODY_SIDE', 'BODY_BACK']);
});

test('sheet handler: RETAKE quotes one take, needs the anchor for other views, and adds the instruction', async () => {
  const h = harness();
  const { runId } = await (await h.call(startBody)).json();
  assert.equal((await h.call({ action: 'RETAKE', runId, view: 'PROFILE', expectedCostMills: 36 })).status, 409, 'anchor not ready yet');
  h.polls.set('pred-1', { status: 'SUCCEEDED', outputUrl: 'https://cdn.example/a.png' });
  await h.call({ action: 'STATUS', runId });
  assert.equal((await h.call({ action: 'RETAKE', runId, view: 'PROFILE', expectedCostMills: 30 })).status, 409, 'stale cost');
  const r = await h.call({ action: 'RETAKE', runId, view: 'PROFILE', instruction: 'sonrisa leve', expectedCostMills: 36 });
  assert.equal(r.status, 200);
  assert.match(h.submitted.at(-1)!.prompt, /sonrisa leve$/);
  assert.equal([...h.takes.values()].filter((t) => t.view === 'PROFILE').map((t) => t.take_no).join(), '1,2');
});

test('sheet handler: CHOOSE registers a reference with the right level, once', async () => {
  const h = harness();
  const { runId } = await (await h.call(startBody)).json();
  h.polls.set('pred-1', { status: 'SUCCEEDED', outputUrl: 'https://cdn.example/a.png' });
  await h.call({ action: 'STATUS', runId });
  const anchor = [...h.takes.values()].find((t) => t.view === 'FRONT')!;
  const queued = [...h.takes.values()].find((t) => t.view === 'PROFILE')!;
  assert.equal((await h.call({ action: 'CHOOSE', takeId: queued.id })).status, 409);
  const r = await h.call({ action: 'CHOOSE', takeId: anchor.id });
  assert.equal(r.status, 200);
  assert.equal(h.registered.length, 1);
  assert.deepEqual(h.registered[0].kind, 'REFERENCE');
  assert.deepEqual((h.registered[0].metadata as Record<string, unknown>).angle, 'FRONT');
  assert.deepEqual((h.registered[0].metadata as Record<string, unknown>).content_level, 'PUBLIC');
  const again = await h.call({ action: 'CHOOSE', takeId: anchor.id });
  assert.equal(again.status, 200);
  assert.equal(h.registered.length, 1, 'choosing twice does not duplicate');
});

test('sheet handler: missing WaveSpeed key stops before reserving', async () => {
  const h = harness({ async secret() { return null; } });
  const r = await h.call(startBody);
  assert.equal(r.status, 412);
  assert.match((await r.json()).error, /Conexiones/);
  assert.equal(h.getSpent(), 0);
});

// ---------------- Migration ----------------
const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261118000000_raxi_hq_sheet_creator.sql'), 'utf8');

async function migrated() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.raxi_workspaces(id uuid primary key, owner_user_id uuid not null, slug text not null);
    create table public.raxi_assets(id uuid primary key);
    insert into public.raxi_workspaces values ('${wsId}', '${owner}', 'raxi-hq');`);
  await db.exec(sql);
  return db;
}
const run = (id: string, level = 'GENERAL') => JSON.stringify({ id, character_id: 'raxi-vox', level, model: price.model, resolution: '1k', source_asset_ids: [], attested_not_real: true, adult_template: null });
const take = (id: string, runId: string, view: string, cost: number) => ({ id, run_id: runId, view, take_no: 1, prompt: 'p', input_count: 1, cost_mills: cost, status: 'QUEUED' });

test('sheet migration: the monthly cap is enforced by the database', async () => {
  const db = await migrated();
  // Takes are capped at $1 each by a check constraint, so large amounts are split across take numbers.
  const takesFor = (runId: string, cost: number) => Array.from({ length: Math.ceil(cost / 1000) }, (_, i) =>
    ({ ...take(crypto.randomUUID(), runId, 'FRONT', Math.min(1000, cost - i * 1000)), take_no: i + 1 }));
  const create = (runId: string, cost: number) => db.query(`select public.raxi_sheet_create_run($1::uuid, $2::jsonb, $3::jsonb)`,
    [owner, run(runId), JSON.stringify(takesFor(runId, cost))]);
  await create('11111111-1111-4111-8111-111111111111', 9000);
  await create('22222222-2222-4222-8222-222222222222', 1000);
  await assert.rejects(create('33333333-3333-4333-8333-333333333333', 1), /monthly cap/);
  await db.exec(`update public.raxi_sheet_takes set created_at = now() - interval '40 days' where run_id = '11111111-1111-4111-8111-111111111111'`);
  await create('44444444-4444-4444-8444-444444444444', 500);
  await db.exec(`update public.raxi_sheet_takes set status = 'CANCELLED' where run_id = '22222222-2222-4222-8222-222222222222'`);
  const spend = await db.query<{ s: number }>(`select public.raxi_sheet_month_spend($1::uuid) as s`, [owner]);
  assert.equal(Number(spend.rows[0].s), 500, 'only this month and only live takes count');
  await db.exec(`update public.raxi_sheet_takes set status = 'FAILED', prediction_id = 'pred-x' where run_id = '44444444-4444-4444-8444-444444444444'`);
  assert.equal(Number((await db.query<{ s: number }>(`select public.raxi_sheet_month_spend($1::uuid) as s`, [owner])).rows[0].s), 500, 'a submitted take that failed still counts');
  await create('88888888-8888-4888-8888-888888888888', 9000);
  const t = take('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', 'PROFILE', 600);
  await assert.rejects(db.query(`select public.raxi_sheet_add_take($1::uuid, $2::jsonb)`, [owner, JSON.stringify(t)]), /monthly cap/);
});

test('sheet migration: attestation, roster and owner are checked; clients can only read', async () => {
  const db = await migrated();
  const bad = JSON.parse(run('66666666-6666-4666-8666-666666666666')); bad.attested_not_real = false;
  await assert.rejects(db.query(`select public.raxi_sheet_create_run($1::uuid, $2::jsonb, '[]'::jsonb)`, [owner, JSON.stringify(bad)]));
  await assert.rejects(db.query(`select public.raxi_sheet_create_run($1::uuid, $2::jsonb, '[]'::jsonb)`, ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', run('77777777-7777-4777-8777-777777777777')]), /owner/);
  assert.match(sql, /revoke all on public\.raxi_sheet_runs from anon, authenticated/);
  assert.match(sql, /revoke all on public\.raxi_sheet_takes from anon, authenticated/);
  assert.match(sql, /grant select on public\.raxi_sheet_runs to authenticated/);
  for (const fn of ['raxi_sheet_create_run(uuid, jsonb, jsonb)', 'raxi_sheet_add_take(uuid, jsonb)', 'raxi_sheet_month_spend(uuid)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
  const prices = await db.query<{ model: string; enabled: boolean; out_1k: string; per_input: string }>(`select model, enabled, out_1k, per_input from public.raxi_provider_prices order by model`);
  assert.deepEqual(prices.rows.map((p) => [p.model, p.enabled]), [['bytedance/seedream-v5.0-pro/edit', false], ['bytedance/seedream-v5.5/edit', true]]);
  assert.equal(Number(prices.rows[1].out_1k), 0.02);
  assert.equal(Number(prices.rows[1].per_input), 0.008);
});
