import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { buildRecreatePrompt, cleanEditedPrompt, cleanVariants, decodeTarget, isDraftPath, quoteRecreate, DEFAULT_STYLE, RECREATE_RULE } from '../../../supabase/functions/sheet-creator/recreatePlan';
import { costMillsOf, createPrompter, parsePrompter, prompterSystem } from '../../../supabase/functions/sheet-creator/recreatePrompter';
import { handleRecreate, type RecreateDependencies, type RecreationRow, type RecreateTakeRow } from '../../../supabase/functions/sheet-creator/recreate';
import type { Price } from '../../../supabase/functions/sheet-creator/sheetPlan';

const price: Price = { model: 'bytedance/seedream-v5.5/edit', enabled: true, out: { '1k': 20, '1.5k': 20, '2k': 35 }, perInput: 8 };
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).toString('base64');
const CINE = 'Cinematic photograph of this woman from the reference photo, keep the exact same face and hair from the reference. She reads by candlelight. Quiet gothic mood. Cinematic photo, realistic skin texture';

// ---------------- Plan ----------------
test('recreate plan: target photo is checked by its real header, size and type', () => {
  assert.equal(decodeTarget(png).ext, 'png');
  assert.throws(() => decodeTarget('data:image/jpeg;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64')), /no es la imagen/);
  assert.throws(() => decodeTarget('data:image/gif;base64,R0lGOD'), /JPG, PNG o WebP/);
  assert.throws(() => decodeTarget('data:image/png;base64,' + 'A'.repeat(4_300_000)), /3 MB/);
  assert.throws(() => decodeTarget(undefined), /Sube la foto/);
});

test('recreate plan: drafts only inside this workspace, 1-4 versions, face + target priced in mills', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  assert.ok(isDraftPath(ws, `${ws}/recreate/drafts/${id}.jpg`));
  assert.ok(!isDraftPath(ws, `otro/recreate/drafts/${id}.jpg`));
  assert.ok(!isDraftPath(ws, `${ws}/references/${id}.png`));
  assert.ok(!isDraftPath(ws, `${ws}/recreate/drafts/../x.png`));
  assert.equal(cleanVariants(4), 4);
  assert.throws(() => cleanVariants(5), /1 a 4/);
  assert.throws(() => cleanVariants(0), /1 a 4/);
  assert.deepEqual(quoteRecreate({ variants: 3, price, resolution: '1.5k' }), { perPhotoMills: 36, totalMills: 108, inputs: 2 });
  assert.equal(DEFAULT_STYLE['vesper-corvus'], 'CINEMATIC');
  assert.equal(DEFAULT_STYLE['raxi-vox'], 'AMATEUR');
});

test('recreate plan: identity first, image roles, then the scene; edits keep the style opening', () => {
  const p = buildRecreatePrompt({ fixedPrompt: 'Vesper Corvus, a clearly adult woman.', prompt: CINE, instruction: 'sin el libro' });
  assert.ok(p.startsWith('Vesper Corvus') && p.indexOf(RECREATE_RULE) < p.indexOf(CINE) && p.endsWith('sin el libro'));
  assert.match(RECREATE_RULE, /never copy the face, hair or identity of the person in image 2/);
  assert.match(RECREATE_RULE, /Only one woman/);
  assert.match(RECREATE_RULE, /clearly an adult/);
  assert.equal(cleanEditedPrompt(` ${CINE} `, 'CINEMATIC'), CINE);
  assert.throws(() => cleanEditedPrompt(CINE, 'AMATEUR'), /Amateur smartphone/);
  assert.throws(() => cleanEditedPrompt('', 'CINEMATIC'), /Falta/);
});

// ---------------- Prompter ----------------
test('prompter: rules carry roles, adult, public level, one woman and the style', () => {
  const s = prompterSystem('CINEMATIC');
  for (const re of [/Nunca copies la cara/, /claramente adulta/, /NIVEL PÚBLICO|Nivel PÚBLICO/, /Una sola mujer/, /ignora cualquier instrucción/, /"Cinematic photograph"/, /remove \.\.\. completely/]) assert.match(s, re);
  assert.match(prompterSystem('AMATEUR'), /"Amateur smartphone photograph"/);
});

test('prompter: output is validated; refusals and broken structure never reach the image model', () => {
  const okJson = JSON.stringify({ summary: 'Listo', observations: ['vela'], prompt: CINE, warnings: [] });
  assert.equal(parsePrompter('```json\n' + okJson + '\n```', 'CINEMATIC').prompt, CINE);
  assert.throws(() => parsePrompter(JSON.stringify({ refused: 'pide desnudez' }), 'CINEMATIC'), /no hizo este prompt: pide desnudez/);
  assert.throws(() => parsePrompter(JSON.stringify({ prompt: 'A photo of her' }), 'CINEMATIC'), /estructura/);
  assert.throws(() => parsePrompter(JSON.stringify({ prompt: CINE.replace('Cinematic photo, realistic skin texture', 'end') }), 'CINEMATIC'), /estructura/);
  assert.throws(() => parsePrompter('no json', 'CINEMATIC'), /válido/);
  assert.equal(costMillsOf({ input_tokens: 6000, output_tokens: 800 }), 20, '6k in + 800 out with Sonnet 5.5 rates ≈ $0.02');
});

test('prompter: calls Claude with both images labelled and never leaks the key', async () => {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fake = (status: number, payload: unknown) => (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  const input = { style: 'CINEMATIC' as const, scene: 'leyendo', faceUrl: 'https://s/face.png', target: { kind: 'base64' as const, mime: 'image/png', data: 'AAAA' } };
  const r = await createPrompter(fake(200, { content: [{ type: 'text', text: JSON.stringify({ prompt: CINE, summary: 's' }) }], usage: { input_tokens: 1000, output_tokens: 100 } })).write('sk-secret', input);
  assert.equal(r.prompt, CINE); assert.equal(r.costMills, 3);
  const content = (calls[0].body.messages as { content: { type: string; text?: string; source?: { type: string } }[] }[])[0].content;
  assert.deepEqual(content.map((c) => c.type), ['text', 'image', 'text', 'image', 'text']);
  assert.match(String(content[0].text), /IDENTIDAD/); assert.match(String(content[2].text), /OBJETIVO/);
  assert.equal(calls[0].headers['x-api-key'], 'sk-secret');
  const err = await createPrompter(fake(500, { error: { message: 'sk-secret leaked?' } })).write('sk-secret', input).catch((e: Error) => e);
  assert.ok(err instanceof Error && !err.message.includes('sk-secret'));
});

// ---------------- Handler ----------------
const KEY = 'ws-secret-key-123';
function harness(over: Partial<RecreateDependencies> = {}) {
  const recs = new Map<string, RecreationRow>(); const takes = new Map<string, RecreateTakeRow>();
  const submitted: { images: string[]; prompt: string }[] = []; const assets: Record<string, unknown>[] = []; const uploads: string[] = []; const audits: string[] = [];
  let spent = 0; let n = 0; let today = 0;
  const polls = new Map<string, { status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; outputUrl?: string; error?: string }>();
  const prompterCalls: unknown[] = [];
  const d: RecreateDependencies = {
    async price(m) { return m === price.model ? price : null; },
    async fixedPrompt() { return 'Vesper Corvus, a clearly adult 29-year-old woman.'; },
    async identityLocked(_w, c) { return c === 'vesper-corvus'; },
    async currentRefs() { return { face: { id: 'face', objectPath: `${ws}/references/face.png` }, body: { id: 'body', objectPath: `${ws}/references/body.png` } }; },
    async monthSpendMills() { return spent; },
    async storeUpload(path) { uploads.push(path); },
    prompterKey: () => 'sk-anthropic',
    async writePrompt(_k, input) { prompterCalls.push(input); return { prompt: CINE, summary: 'ok', observations: [], warnings: [], costMills: 20 }; },
    async audit(_w, action) { audits.push(action); today++; },
    async promptsToday() { return today; },
    async createRecreation(_a, r, t) { const tot = t.reduce((x, y) => x + y.cost_mills, 0); if (spent + tot > 10000) throw Object.assign(new Error('cap'), { cap: true }); spent += tot; recs.set(r.id, r); for (const x of t) takes.set(x.id, x); },
    async addRecreationTake(_a, t) { if (spent + t.cost_mills > 10000) throw Object.assign(new Error('cap'), { cap: true }); spent += t.cost_mills; takes.set(t.id, t); },
    async loadRecreation(_w, id) { const r = recs.get(id); return r ? { rec: r, takes: [...takes.values()].filter((t) => t.recreation_id === id) } : null; },
    async loadRecreationTake(_w, id) { return takes.get(id) ?? null; },
    async updateTake(id, patch) { takes.set(id, { ...takes.get(id)!, ...patch }); },
    async claimTake(id) { const t = takes.get(id)!; if (t.status !== 'QUEUED') return false; takes.set(id, { ...t, status: 'PENDING' }); return true; },
    async signedUrl(p) { return `signed:${p}`; },
    async secret() { return KEY; },
    async submit(_k, _m, body) { submitted.push({ images: body.images, prompt: body.prompt }); return `pred-${submitted.length}`; },
    async poll(_k, id) { return polls.get(id) ?? { status: 'PENDING' }; },
    async storeOutput(_u, path) { return { path, sha256: 'c'.repeat(64), byteSize: 10, mime: 'image/png' }; },
    async registerRecreatePhoto(row) { assets.push(row as unknown as Record<string, unknown>); },
    newId: () => `0000000${++n}-0000-4000-8000-000000000000`.slice(-36),
    ...over,
  };
  const call = (b: Record<string, unknown>) => handleRecreate(d, owner, ws, b);
  return { d, recs, takes, submitted, assets, uploads, audits, polls, prompterCalls, call, setSpent: (v: number) => { spent = v; }, setToday: (v: number) => { today = v; } };
}
const base = { character: 'vesper-corvus', channel: 'INSTAGRAM', style: 'CINEMATIC', model: price.model };

test('recreate handler: the prompt step stores the target in drafts, audits the cost and spends nothing on images', async () => {
  const h = harness();
  const r = await h.call({ action: 'RECREATE_PROMPT', ...base, image: png, scene: 'leyendo con velas' });
  assert.equal(r.status, 200);
  assert.ok(isDraftPath(ws, r.body.objectivePath));
  assert.equal(r.body.prompt, CINE); assert.equal(r.body.promptCostMills, 20);
  assert.deepEqual(h.uploads, [r.body.objectivePath]);
  assert.deepEqual(h.audits, ['RECREATE_PROMPT']);
  assert.equal(h.submitted.length, 0);
  // A correction reuses the stored target instead of uploading again.
  const fix = await h.call({ action: 'RECREATE_PROMPT', ...base, objectivePath: r.body.objectivePath, previousPrompt: CINE, fix: 'más oscura' });
  assert.equal(fix.status, 200); assert.equal(h.uploads.length, 1);
  assert.equal((h.prompterCalls[1] as { target: { kind: string } }).target.kind, 'url');
  // A foreign path is never trusted: it must be a fresh upload.
  assert.equal((await h.call({ action: 'RECREATE_PROMPT', ...base, objectivePath: 'otro/recreate/drafts/x.png' })).status, 400);
});

test('recreate handler: identity, face, daily limit and refusals are checked first', async () => {
  assert.match(String((await harness().call({ action: 'RECREATE_PROMPT', ...base, character: 'raxi-vox', image: png })).body.error), /bloquea la identidad/);
  assert.match(String((await harness({ async currentRefs() { return {}; } }).call({ action: 'RECREATE_PROMPT', ...base, image: png })).body.error), /cara de frente/);
  const h = harness(); h.setToday(40);
  assert.equal((await h.call({ action: 'RECREATE_PROMPT', ...base, image: png })).status, 429);
  const refused = harness({ async writePrompt() { throw Object.assign(new Error('El prompter no hizo este prompt: desnudez'), { refused: true, costMills: 5 }); } });
  const r = await refused.call({ action: 'RECREATE_PROMPT', ...base, image: png });
  assert.equal(r.status, 422); assert.deepEqual(refused.audits, ['RECREATE_PROMPT_FAILED']);
  assert.equal((await harness({ prompterKey: () => null }).call({ action: 'RECREATE_PROMPT', ...base, image: png })).status, 412);
});

test('recreate handler: start is public only, attested, priced, and sends face + target with the roles', async () => {
  const h = harness();
  const draft = (await h.call({ action: 'RECREATE_PROMPT', ...base, image: png })).body.objectivePath as string;
  const start = { action: 'RECREATE_START', ...base, objectivePath: draft, prompt: CINE, promptCostMills: 20, variants: 2, attestNotReal: true, expectedTotalMills: 72 };
  assert.match(String((await h.call({ ...start, channel: 'FANVUE_FEED' })).body.error), /solo para Instagram/);
  assert.match(String((await h.call({ ...start, attestNotReal: false })).body.error), /identidad de la persona/);
  assert.equal((await h.call({ ...start, expectedTotalMills: 70 })).status, 409);
  assert.match(String((await h.call({ ...start, objectivePath: `${ws}/references/face.png` })).body.error), /prepara el prompt/);
  assert.match(String((await h.call({ ...start, prompt: 'A photo' })).body.error), /Cinematic photograph/);
  assert.equal(h.submitted.length, 0, 'nothing sent before every check passes');
  const r = await h.call(start);
  assert.equal(r.status, 200);
  assert.equal(h.submitted.length, 2);
  for (const s of h.submitted) {
    assert.deepEqual(s.images, [`signed:${ws}/references/face.png`, `signed:${draft}`], 'image 1 = face, image 2 = target');
    assert.ok(s.prompt.includes(RECREATE_RULE) && s.prompt.includes(CINE) && s.prompt.startsWith('Vesper Corvus'));
  }
  const rec = [...h.recs.values()][0];
  assert.deepEqual(rec.ref_asset_ids, ['face'], 'never the clothed body or an adult reference');
  assert.equal(rec.resolution, '1.5k');
  assert.ok(!JSON.stringify(r.body).includes(KEY));
});

test('recreate handler: cap, status, another version and choose', async () => {
  const h = harness();
  const draft = (await h.call({ action: 'RECREATE_PROMPT', ...base, image: png })).body.objectivePath as string;
  const start = { action: 'RECREATE_START', ...base, objectivePath: draft, prompt: CINE, variants: 4, attestNotReal: true, expectedTotalMills: 144 };
  h.setSpent(9900);
  assert.equal((await h.call(start)).status, 402);
  h.setSpent(0);
  const id = (await h.call(start)).body.recreationId as string;
  h.polls.set('pred-1', { status: 'SUCCEEDED', outputUrl: 'https://cdn/1.png' });
  h.polls.set('pred-2', { status: 'FAILED', error: 'rejected' });
  const st = await h.call({ action: 'RECREATE_STATUS', recreationId: id });
  const takes = st.body.takes as { variant: number; status: string; previewUrl: string | null }[];
  assert.deepEqual(takes.map((t) => [t.variant, t.status]), [[1, 'SUCCEEDED'], [2, 'FAILED'], [3, 'PENDING'], [4, 'PENDING']]);
  assert.equal(takes[0].previewUrl, `signed:${ws}/recreate/${id}/1/1.png`);
  assert.equal((await h.call({ action: 'RECREATE_RETAKE', recreationId: id, variant: 2, expectedCostMills: 44 })).status, 409);
  assert.equal((await h.call({ action: 'RECREATE_RETAKE', recreationId: id, variant: 5, expectedCostMills: 36 })).status, 400);
  const rt = await h.call({ action: 'RECREATE_RETAKE', recreationId: id, variant: 2, instruction: 'más sombra', expectedCostMills: 36 });
  assert.equal(rt.status, 200); assert.ok(h.submitted.at(-1)!.prompt.endsWith('más sombra'));
  const first = [...h.takes.values()].find((t) => t.variant_no === 1)!;
  assert.equal((await h.call({ action: 'RECREATE_CHOOSE', takeId: [...h.takes.values()].find((t) => t.variant_no === 3)!.id })).status, 409);
  const ch = await h.call({ action: 'RECREATE_CHOOSE', takeId: first.id });
  assert.equal(ch.status, 200);
  assert.equal((h.assets[0].metadata as Record<string, unknown>).content_level, 'PUBLIC');
  assert.equal((h.assets[0].metadata as Record<string, unknown>).source, 'RAXI_RECREATE');
  assert.equal((await h.call({ action: 'RECREATE_CHOOSE', takeId: first.id })).body.duplicate, true);
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
  for (const f of ['20261118000000_raxi_hq_sheet_creator.sql', '20261118030000_raxi_hq_continuity_series.sql', '20261118040000_raxi_hq_recreate.sql'])
    await db.exec(readFileSync(join(process.cwd(), `../../supabase/migrations/${f}`), 'utf8'));
  const a = (id: string, lvl: string, extra = '') => `('${id}', '${ws}', 'REFERENCE', '${ws}/${id}.png', '{"character_id":"vesper-corvus","content_level":"${lvl}","angle":"FRONT"${extra}}')`;
  await db.exec(`insert into public.raxi_assets (id, workspace_id, kind, object_path, metadata) values
    ${a('20000000-0000-4000-8000-000000000001', 'PUBLIC')}, ${a('20000000-0000-4000-8000-000000000002', 'NSFW')}, ${a('20000000-0000-4000-8000-000000000003', 'PUBLIC', ',"superseded_by":"x"')}`);
  return db;
}
const DRAFT = `${ws}/recreate/drafts/12345678-1234-4234-8234-123456789abc.jpg`;
const R = (over: Record<string, unknown> = {}) => JSON.stringify({ id: crypto.randomUUID(), character_id: 'vesper-corvus', channel: 'INSTAGRAM', objective_path: DRAFT,
  ref_asset_ids: ['20000000-0000-4000-8000-000000000001'], style: 'CINEMATIC', prompt: CINE, variants: 2, model: price.model, resolution: '1.5k',
  ceiling_mills: 72, attested_not_real: true, ...over });
const TK = (recJson: string, cost = 36, n = 2) => { const id = JSON.parse(recJson).id;
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: crypto.randomUUID(), recreation_id: id, variant_no: i + 1, take_no: 1, prompt: 'p', input_count: 2, cost_mills: cost }))); };

test('recreate migration: every rule is enforced by the database', async () => {
  const db = await migrated();
  const create = (r: string, t = TK(r)) => db.query(`select public.raxi_recreation_create($1::uuid, $2::jsonb, $3::jsonb)`, [owner, r, t]);
  await assert.rejects(create(R()), /identity not locked/);
  await db.exec(`insert into public.raxi_identity_versions values ('${ws}', 'vesper-corvus', 3, 'LOCKED')`);
  await assert.rejects(create(R({ objective_path: `otro/recreate/drafts/12345678-1234-4234-8234-123456789abc.jpg` })), /invalid target/);
  await assert.rejects(create(R({ objective_path: `${ws}/references/face.png` })), /invalid target/);
  await assert.rejects(create(R({ ref_asset_ids: ['20000000-0000-4000-8000-000000000002'] })), /invalid reference/, 'adult reference');
  await assert.rejects(create(R({ ref_asset_ids: ['20000000-0000-4000-8000-000000000003'] })), /invalid reference/, 'retired reference');
  await assert.rejects(create(R({ ref_asset_ids: [] })), /reference required/);
  await assert.rejects(create(R({ attested_not_real: false })), /attestation/);
  await assert.rejects(create(R({ ceiling_mills: 50 })), /ceiling/);
  await assert.rejects(create(R({ channel: 'FANVUE_FEED' })), 'public channels only');
  await assert.rejects(create(R({ variants: 5 })), 'at most 4 versions');
  await create(R());
  assert.equal(Number((await db.query<{ s: number }>(`select public.raxi_sheet_month_spend('${owner}') as s`)).rows[0].s), 72, 'same monthly cap as sheets and series');
  await assert.rejects(db.query(`insert into public.raxi_sheet_takes (id, workspace_id, series_id, shot_no, recreation_id, variant_no, take_no, prompt, input_count, cost_mills)
    values (gen_random_uuid(), '${ws}', null, 1, gen_random_uuid(), 1, 1, 'p', 1, 1)`), 'a take belongs to exactly one kind');
  await db.query(`select public.raxi_sheet_add_take($1::uuid, $2::jsonb)`, [owner, JSON.stringify({ id: crypto.randomUUID(), recreation_id: JSON.parse(R()).id, variant_no: 1, take_no: 2, prompt: 'p', input_count: 2, cost_mills: 36 })])
    .then(() => assert.fail('a take of an unknown recreation must be refused'), (e: Error) => assert.match(e.message, /foreign run/));
  await assert.rejects(db.query(`select public.raxi_sheet_add_take($1::uuid, $2::jsonb)`, [owner, JSON.stringify({ id: crypto.randomUUID(), recreation_id: JSON.parse(R()).id, variant_no: 1, take_no: 1, prompt: 'p', input_count: 2, cost_mills: 9990 })]), /monthly cap/);
});

test('recreate migration: clients can only read', () => {
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261118040000_raxi_hq_recreate.sql'), 'utf8');
  assert.match(sql, /revoke all on public\.raxi_recreations from anon, authenticated/);
  assert.match(sql, /grant select on public\.raxi_recreations to authenticated/);
  assert.match(sql, /revoke all on function public\.raxi_recreation_create\(uuid, jsonb, jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.raxi_recreation_create\(uuid, jsonb, jsonb\) to service_role/);
});
