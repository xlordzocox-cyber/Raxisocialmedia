import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTalentProfile, canLock, splitLines } from '../src/talent/talentModel';
import { buildMedia } from '../src/portfolio/mediaModel';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReferenceHandler, type ReferenceDependencies } from '../../../supabase/functions/talent-reference/handler';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TalentProfilePage } from '../src/talent/TalentProfilePage';
import { TalentListPage } from '../src/talent/TalentListPage';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = 'a'.repeat(64);
const ref = (id: string, angle: string, character = 'raxi-vox', created = '2026-11-17T10:00:00Z') => ({
  id, workspace_id: ws, kind: 'REFERENCE', object_path: `${ws}/references/${character}/${id}.jpg`, sha256: sha,
  metadata: { character_id: character, angle, content_level: 'PUBLIC', source: 'LUIS_UPLOAD' }, created_at: created,
});
const version = (v: number, status: string, extra: Record<string, unknown> = {}) => ({
  workspace_id: ws, character_id: 'raxi-vox', version: v, identity_text: 'A 25-year-old woman named Raxi Vox with warm brown eyes.',
  marks: ['Pecas suaves'], accessories: [], reference_asset_ids: ['r1'], status, updated_at: '2026-11-17T10:00:00Z',
  locked_at: status === 'LOCKED' ? '2026-11-17T11:00:00Z' : null, ...extra,
});

test('talent model: references, locked version, draft and history', () => {
  const p = buildTalentProfile(ws, 'raxi-vox',
    [version(1, 'LOCKED'), version(2, 'DRAFT', { reference_asset_ids: ['r1', 'r2'] }), { ...version(1, 'LOCKED'), character_id: 'vesper-corvus' }],
    [ref('r1', 'FRONT'), ref('r2', 'PROFILE', 'raxi-vox', '2026-11-17T12:00:00Z'), ref('v1', 'FRONT', 'vesper-corvus'), { ...ref('o1', 'FRONT'), kind: 'ORIGINAL' }]);
  assert.equal(p.name, 'Raxi Vox');
  assert.deepEqual(p.references.map((r) => [r.id, r.angle]), [['r2', 'PROFILE'], ['r1', 'FRONT']]);
  assert.equal(p.locked?.version, 1);
  assert.equal(p.draft?.version, 2);
  assert.deepEqual(p.history.map((h) => h.version), [2, 1]);
  assert.equal(canLock(p), true);
});

test('talent model: lock needs real text and a front reference in the draft', () => {
  const noFront = buildTalentProfile(ws, 'raxi-vox', [version(1, 'DRAFT', { reference_asset_ids: ['r2'] })], [ref('r2', 'PROFILE')]);
  assert.equal(canLock(noFront), false);
  const shortText = buildTalentProfile(ws, 'raxi-vox', [version(1, 'DRAFT', { identity_text: 'corto' })], [ref('r1', 'FRONT')]);
  assert.equal(canLock(shortText), false);
  const adultFront = buildTalentProfile(ws, 'raxi-vox', [version(1, 'DRAFT', { reference_asset_ids: ['n1'] })], [{ ...ref('n1', 'FRONT'), metadata: { character_id: 'raxi-vox', angle: 'FRONT', content_level: 'NSFW' } }]);
  assert.equal(adultFront.references[0].level, 'ADULT');
  assert.equal(canLock(adultFront), false, 'identity is anchored on a general front reference');
  const none = buildTalentProfile(ws, 'raxi-vox', [], []);
  assert.equal(none.draft, null);
  assert.equal(none.locked, null);
  assert.equal(canLock(none), false);
});

test('talent model: foreign or malformed rows are rejected', () => {
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [], [{ ...ref('r1', 'FRONT'), workspace_id: 'other' }]));
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [], [{ ...ref('r1', 'FRONT'), object_path: 'other/r1.jpg' }]));
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [{ ...version(1, 'DRAFT'), workspace_id: 'other' }], []));
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [version(1, 'WEIRD')], []));
  assert.throws(() => buildTalentProfile(ws, 'nadie', [], []));
  assert.deepEqual(buildTalentProfile(ws, 'raxi-vox', [], [ref('r9', 'SIDEWAYS')]).references, [], 'unknown angle is ignored');
});

test('talent model: body views and source photos of the 360 creator are valid angles', () => {
  const p = buildTalentProfile(ws, 'raxi-vox', [], [ref('b1', 'BODY_FRONT'), ref('b2', 'BODY_SIDE'), ref('b3', 'BODY_BACK'), ref('s1', 'SOURCE'), ref('h1', 'HEAD')]);
  assert.deepEqual(p.references.map((r) => r.angle).sort(), ['BODY_BACK', 'BODY_FRONT', 'BODY_SIDE', 'SOURCE']);
});

test('talent model: list fields are trimmed lines, max 20', () => {
  assert.deepEqual(splitLines('  uno \n\n dos\n'), ['uno', 'dos']);
  assert.equal(splitLines(Array.from({ length: 30 }, (_, i) => `x${i}`).join('\n')).length, 20);
});

test('media model: identity references never appear in the archive', () => {
  const asset = { id: 'a1', workspace_id: ws, object_path: `${ws}/a1/original.jpg`, mime_type: 'image/jpeg', sha256: sha, byte_size: 10, external_asset_id: null, metadata: { character_id: 'raxi-vox', content_level: 'PUBLIC' }, created_at: '2026-11-17T10:00:00Z' };
  const view = buildMedia(ws, [asset, { ...asset, id: 'r1', object_path: `${ws}/references/raxi-vox/r1.jpg`, kind: 'REFERENCE' }], [], []);
  assert.deepEqual(view.assets.map((a) => a.id), ['a1']);
});


test('talent migration: owner-only writes through two RPCs; lock feeds the Aria fixed prompt', () => {
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261117100000_raxi_hq_talent_identity.sql'), 'utf8');
  assert.match(sql, /alter table public\.raxi_identity_versions enable row level security/);
  assert.match(sql, /revoke all on public\.raxi_identity_versions from anon, authenticated/);
  assert.match(sql, /grant select on public\.raxi_identity_versions to authenticated/);
  assert.match(sql, /create unique index raxi_identity_one_draft/);
  for (const fn of ['raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[])', 'raxi_identity_lock(text, integer)']) {
    const name = fn.replace(/[()[\]]/g, (c) => `\\${c}`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name} from public, anon`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${name} to authenticated`), fn);
  }
  assert.match(sql, /a\.kind = 'REFERENCE'/, 'drafts only accept identity references');
  assert.match(sql, /metadata->>'angle' = 'FRONT' and a\.metadata->>'content_level' = 'PUBLIC'/, 'lock needs a general front reference');
  assert.match(sql, /insert into public\.raxi_character_profiles[\s\S]*on conflict \(workspace_id, character_id\) do update set fixed_prompt = excluded\.fixed_prompt/);
  assert.match(sql, /'IDENTITY_LOCKED'/);
});


const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
function refDeps(over: Partial<ReferenceDependencies> = {}) {
  const calls: string[] = [];
  const d: ReferenceDependencies = {
    async verifyUser(token) { return token === 'good' ? { id: owner, isAnonymous: false } : null; },
    async workspaceOf() { return ws; },
    async findBySha() { return null; },
    async upload(path, bytes, mime) { calls.push(`upload:${path}:${bytes.length}:${mime}`); },
    async register(row) { calls.push(`register:${row.kind}:${row.metadata.character_id}:${row.metadata.angle}:${row.metadata.content_level}`); },
    async removeObject(path) { calls.push(`remove:${path}`); },
    newId: () => 'new-id',
    async sha256() { return sha; },
    ...over,
  };
  return { d, calls };
}
function upload(fields: Record<string, string>, bytes: Uint8Array | null = JPEG, token = 'good') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (bytes) fd.set('file', new File([bytes], 'ficha.jpg', { type: 'image/jpeg' }));
  return new Request('https://x/functions/v1/talent-reference', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
}
const okFields = { character: 'raxi-vox', angle: 'FRONT', level: 'GENERAL' };

test('reference handler: session required', async () => {
  const { d, calls } = refDeps();
  assert.equal((await createReferenceHandler(d)(upload(okFields, JPEG, 'bad'))).status, 401);
  assert.equal((await createReferenceHandler(d)(new Request('https://x', { method: 'GET' }))).status, 405);
  assert.deepEqual(calls, []);
});

test('reference handler: stores the reference as REFERENCE with its level', async () => {
  const { d, calls } = refDeps();
  const res = await createReferenceHandler(d)(upload(okFields));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { assetId: 'new-id', character: 'raxi-vox', angle: 'FRONT', duplicate: false });
  assert.deepEqual(calls, [`upload:${ws}/references/raxi-vox/${sha}.jpg:${JPEG.length}:image/jpeg`, 'register:REFERENCE:raxi-vox:FRONT:PUBLIC']);
  const adult = refDeps();
  assert.equal((await createReferenceHandler(adult.d)(upload({ ...okFields, level: 'ADULT' }))).status, 200);
  assert.equal(adult.calls.at(-1), 'register:REFERENCE:raxi-vox:FRONT:NSFW');
});

test('reference handler: refuses a missing level, unknown model or angle, and non-images', async () => {
  const h = createReferenceHandler(refDeps().d);
  assert.equal((await h(upload({ character: 'raxi-vox', angle: 'FRONT' }))).status, 400);
  assert.equal((await h(upload({ ...okFields, level: 'OTRO' }))).status, 400);
  assert.equal((await h(upload({ ...okFields, character: 'nadie' }))).status, 400);
  assert.equal((await h(upload({ ...okFields, angle: 'SIDEWAYS' }))).status, 400);
  assert.equal((await h(upload({ ...okFields, angle: 'HEAD' }))).status, 400);
  for (const angle of ['BODY_FRONT', 'BODY_SIDE', 'BODY_BACK', 'SOURCE']) assert.equal((await createReferenceHandler(refDeps().d)(upload({ ...okFields, angle }))).status, 200, angle);
  assert.equal((await h(upload(okFields, null))).status, 400);
  assert.equal((await h(upload(okFields, new TextEncoder().encode('<svg onload=x>')))).status, 415);
});

test('reference handler: duplicates are reused, other uses conflict, failed registration cleans up', async () => {
  const dup = refDeps({ async findBySha() { return { id: 'old', kind: 'REFERENCE', characterId: 'raxi-vox' }; } });
  const r1 = await createReferenceHandler(dup.d)(upload(okFields));
  assert.deepEqual(await r1.json(), { assetId: 'old', character: 'raxi-vox', angle: 'FRONT', duplicate: true });
  assert.deepEqual(dup.calls, []);
  const otherModel = refDeps({ async findBySha() { return { id: 'old', kind: 'REFERENCE', characterId: 'vesper-corvus' }; } });
  const r2 = await createReferenceHandler(otherModel.d)(upload(okFields));
  assert.equal(r2.status, 409);
  assert.match((await r2.json()).error, /otra modelo/);
  assert.deepEqual(otherModel.calls, []);
  const archived = refDeps({ async findBySha() { return { id: 'old', kind: 'ORIGINAL', characterId: 'raxi-vox' }; } });
  const ra = await createReferenceHandler(archived.d)(upload(okFields));
  assert.equal(ra.status, 200, 'a Fototeca photo of the same model can become her reference');
  assert.deepEqual(archived.calls, [`upload:${ws}/references/raxi-vox/${sha}.jpg:${JPEG.length}:image/jpeg`, 'register:REFERENCE:raxi-vox:FRONT:PUBLIC']);
  const broken = refDeps({ async register() { throw new Error('db down'); } });
  const r3 = await createReferenceHandler(broken.d)(upload(okFields));
  assert.equal(r3.status, 503);
  assert.ok(!(await r3.text()).includes('db down'));
  assert.deepEqual(broken.calls.at(-1), `remove:${ws}/references/raxi-vox/${sha}.jpg`);
});


Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

function talentClient(versions: unknown[], refs: unknown[]) {
  const rpcs: [string, unknown][] = []; const invokes: [string, unknown][] = [];
  const client = {
    rpc: async (name: string, args?: unknown) => { rpcs.push([name, args]); return name === 'raxi_get_workspace' ? { data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null } : { data: { ok: true }, error: null }; },
    from: (name: string) => ({ select: () => ({ eq: async () => ({ data: name === 'raxi_identity_versions' ? versions : refs, error: null }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }) }) },
    functions: { invoke: async (name: string, opts: { body: unknown }) => { invokes.push([name, opts.body]); return { data: { assetId: 'r9', duplicate: false }, error: null }; } },
  } as unknown as SupabaseClient;
  return { client, rpcs, invokes };
}
const renderProfile = async (client: SupabaseClient) => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><TalentProfilePage client={client} ownerId={owner} characterId="raxi-vox" /></MemoryRouter>); await new Promise((res) => setTimeout(res, 20)); });
  return r;
};
const byText = (r: ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === 'button' && n.children.join('') === label)[0];

test('Talento list: the whole roster, each linking to its profile', async () => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><TalentListPage /></MemoryRouter>); });
  const hrefs = r.root.findAllByType('a').map((a) => a.props.href);
  assert.ok(hrefs.includes('/talento/raxi-vox') && hrefs.includes('/talento/vesper-corvus'));
});

test('Talento profile: shows each 360 angle, missing ones included, read with RLS only', async () => {
  const { client, rpcs } = talentClient([], [ref('r1', 'FRONT')]);
  const r = await renderProfile(client);
  const text = JSON.stringify(r.toJSON());
  assert.match(text, /Raxi Vox/);
  assert.match(text, /Sin identidad todavía/);
  for (const label of ['Frente', 'Tres cuartos', 'Perfil', 'Espalda', 'Cuerpo completo']) assert.match(text, new RegExp(label));
  assert.equal(r.root.findAllByType('img').filter((i) => String(i.props.src).includes('/r1.jpg')).length, 1);
  assert.deepEqual(rpcs.map(([n]) => n), ['raxi_get_workspace']);
});

test('Talento profile: upload sends the file, model, angle and level', async () => {
  const { client, invokes } = talentClient([], []);
  const r = await renderProfile(client);
  const file = new File([JPEG], 'frente.jpg', { type: 'image/jpeg' });
  await act(async () => { r.root.findByProps({ id: 'ref-file' }).props.onChange({ target: { files: [file] } }); });
  await act(async () => { r.root.findByProps({ id: 'ref-angle' }).props.onChange({ target: { value: 'PROFILE' } }); });
  await act(async () => { r.root.findByProps({ id: 'ref-level' }).props.onChange({ target: { value: 'ADULT' } }); });
  await act(async () => { r.root.findByProps({ 'aria-label': 'Subir referencia' }).props.onSubmit({ preventDefault() {} }); await new Promise((res) => setTimeout(res, 10)); });
  assert.equal(invokes.length, 1);
  const [name, body] = invokes[0] as [string, FormData];
  assert.equal(name, 'talent-reference');
  assert.deepEqual([body.get('character'), body.get('angle'), body.get('level')], ['raxi-vox', 'PROFILE', 'ADULT']);
  assert.ok(body.get('file') instanceof Blob);
});

test('Talento profile: the adult sheet stays hidden until the NSFW switch is turned on', async () => {
  const adult = { ...ref('n1', 'FRONT'), metadata: { character_id: 'raxi-vox', angle: 'FRONT', content_level: 'NSFW' } };
  const { client } = talentClient([], [ref('r1', 'FRONT'), adult]);
  const r = await renderProfile(client);
  const shown = () => r.root.findAllByType('img').map((i) => String(i.props.src));
  assert.ok(shown().some((x) => x.includes('/r1.jpg')));
  assert.ok(!shown().some((x) => x.includes('/n1.jpg')), 'adult reference hidden by default');
  const toggle = r.root.findByProps({ id: 'nsfw-switch' });
  assert.equal(toggle.props.checked, false);
  await act(async () => { toggle.props.onChange({ target: { checked: true } }); });
  assert.ok(shown().some((x) => x.includes('/n1.jpg')));
  assert.ok(!shown().some((x) => x.includes('/r1.jpg')), 'the switch shows one sheet at a time');
});

test('Talento profile: saving a draft and locking it go through the owner RPCs', async () => {
  const { client, rpcs } = talentClient([version(1, 'DRAFT', { reference_asset_ids: ['r1'] })], [ref('r1', 'FRONT')]);
  const r = await renderProfile(client);
  await act(async () => { r.root.findByProps({ id: 'identity-text' }).props.onChange({ target: { value: 'A 25-year-old woman named Raxi Vox, warm brown eyes, teal highlights.' } }); });
  await act(async () => { r.root.findByProps({ id: 'identity-marks' }).props.onChange({ target: { value: 'Pecas suaves\nLunar junto al labio' } }); });
  await act(async () => { byText(r, 'Guardar borrador').props.onClick(); await new Promise((res) => setTimeout(res, 10)); });
  assert.deepEqual(rpcs.find(([n]) => n === 'raxi_identity_save_draft')?.[1], {
    p_character: 'raxi-vox', p_text: 'A 25-year-old woman named Raxi Vox, warm brown eyes, teal highlights.',
    p_marks: ['Pecas suaves', 'Lunar junto al labio'], p_accessories: [], p_refs: ['r1'],
  });
  await act(async () => { byText(r, 'Bloquear versión 1').props.onClick(); });
  assert.ok(!rpcs.some(([n]) => n === 'raxi_identity_lock'), 'first click only asks for confirmation');
  assert.match(JSON.stringify(r.toJSON()), /prompt fijo/);
  await act(async () => { byText(r, 'Sí, bloquear').props.onClick(); await new Promise((res) => setTimeout(res, 10)); });
  assert.deepEqual(rpcs.find(([n]) => n === 'raxi_identity_lock')?.[1], { p_character: 'raxi-vox', p_version: 1 });
});
