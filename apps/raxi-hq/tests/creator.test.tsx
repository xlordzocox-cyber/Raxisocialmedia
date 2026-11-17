import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SheetCreatorPage } from '../src/creator/SheetCreatorPage';
import { usd } from '../src/creator/creatorModel';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ref = (id: string, angle: string, level = 'PUBLIC') => ({ id, workspace_id: ws, kind: 'REFERENCE', object_path: `${ws}/references/raxi-vox/${id}.jpg`, sha256: 'a'.repeat(64),
  metadata: { character_id: 'raxi-vox', angle, content_level: level }, created_at: '2026-11-17T10:00:00Z' });

const run = (level: 'GENERAL' | 'ADULT', statuses: string[]) => ({ runId: 'run-1', character: 'raxi-vox', level, model: 'bytedance/seedream-v5.5/edit', resolution: '1k',
  takes: (level === 'GENERAL' ? ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'] : ['BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'])
    .map((view, i) => ({ id: `t${i}`, view, takeNo: 1, status: statuses[i] ?? 'QUEUED', costMills: i === 0 ? 28 : 36, error: null, chosen: false, previewUrl: statuses[i] === 'SUCCEEDED' ? `https://signed/${view}.png` : null })) });

function fakeClient(refs: unknown[], latest: unknown = { runId: null }) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    rpc: async () => ({ data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null }),
    from: (name: string) => ({ select: () => ({ eq: async () => ({ data: name === 'raxi_identity_versions' ? [] : refs, error: null }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed/' + p })), error: null }) }) },
    functions: { invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
      if (name !== 'sheet-creator') return { data: { assetId: 'x' }, error: null };
      calls.push(opts.body);
      const b = opts.body;
      if (b.action === 'LATEST') return { data: b.level === 'GENERAL' ? latest : { runId: null }, error: null };
      if (b.action === 'QUOTE') return { data: { totalMills: b.level === 'ADULT' ? 108 : 208, spentMills: 1500, capMills: 10000, takes: [] }, error: null };
      if (b.action === 'START') return { data: run(b.level as 'GENERAL', ['PENDING']), error: null };
      return { data: run('GENERAL', ['SUCCEEDED', 'SUCCEEDED']), error: null };
    } },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const settle = () => new Promise((res) => setTimeout(res, 20));
const mounted: ReactTestRenderer[] = [];
after(() => { for (const r of mounted) act(() => r.unmount()); });
async function render(client: SupabaseClient) {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><SheetCreatorPage client={client} ownerId={owner} characterId="raxi-vox" pollMs={60_000} /></MemoryRouter>); await settle(); });
  mounted.push(r);
  return r;
}
const button = (r: ReactTestRenderer, prefix: string) => r.root.findAll((n) => n.type === 'button' && n.children.join('').startsWith(prefix));
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

test('creator: costs are shown in dollars from integer mills', () => {
  assert.equal(usd(208), '$0.208'); assert.equal(usd(1500), '$1.50'); assert.equal(usd(10000), '$10.00');
});

test('creator: "Crear ficha" stays off until a photo is chosen and the not-a-real-person box is ticked', async () => {
  const { client, calls } = fakeClient([ref('s1', 'SOURCE')]);
  const r = await render(client);
  const start = () => r.root.findByProps({ id: 'general-start' });
  assert.equal(start().props.disabled, true);
  await act(async () => { r.root.findAll((n) => n.type === 'input' && n.props.type === 'checkbox' && !n.props.id)[0].props.onChange({ target: { checked: true } }); await settle(); });
  assert.match(start().children.join(''), /Crear ficha · \$0\.208/);
  assert.equal(start().props.disabled, true, 'attestation still missing');
  await act(async () => { r.root.findByProps({ id: 'general-attest' }).props.onChange({ target: { checked: true } }); });
  assert.equal(start().props.disabled, false);
  assert.match(text(r), /Gastado este mes: .*\$1\.50.* de .*\$10\.00/);
  await act(async () => { start().props.onClick(); await settle(); });
  const sent = calls.find((c) => c.action === 'START')!;
  assert.deepEqual(sent, { action: 'START', character: 'raxi-vox', level: 'GENERAL', model: 'bytedance/seedream-v5.5/edit', resolution: '1k', sourceIds: ['s1'], attestNotReal: true, expectedTotalMills: 208 });
});

test('creator: the adult sheet is hidden with NSFW off, and needs the general face and body before it can be created', async () => {
  const none = await render(fakeClient([ref('s1', 'SOURCE')]).client);
  assert.equal(none.root.findByProps({ id: 'creator-nsfw' }).props.checked, false);
  assert.equal(none.root.findAll((n) => n.props.id === 'adult-start').length, 0);
  await act(async () => { none.root.findByProps({ id: 'creator-nsfw' }).props.onChange({ target: { checked: true } }); await settle(); });
  assert.match(text(none), /primero elige la cara de frente y el cuerpo de frente/);
  assert.equal(none.root.findAll((n) => n.props.id === 'adult-start').length, 0);

  const { client, calls } = fakeClient([ref('s1', 'SOURCE'), ref('f1', 'FRONT'), ref('b1', 'BODY_FRONT'), ref('n1', 'BODY_FRONT', 'NSFW')]);
  const r = await render(client);
  assert.ok(!r.root.findAllByType('img').some((i) => String(i.props.src).includes('/n1.jpg')), 'no adult image with NSFW off');
  assert.equal(r.root.findAll((n) => n.props.id === 'adult-start').length, 0, 'no adult creator with NSFW off, even when it could be created');
  assert.ok(!calls.some((c) => c.level === 'ADULT'), 'nothing adult is even quoted with NSFW off');
  await act(async () => { r.root.findByProps({ id: 'creator-nsfw' }).props.onChange({ target: { checked: true } }); await settle(); });
  assert.match(text(r), /Seedream 5\.5/);
  assert.match(r.root.findByProps({ id: 'adult-start' }).children.join(''), /Crear ficha adulta · \$0\.108/);
  assert.ok(calls.some((c) => c.action === 'QUOTE' && c.level === 'ADULT' && c.model === 'bytedance/seedream-v5.5/edit'));
});

test('creator: each view offers another version, change, upload and choose, with its cost', async () => {
  const { client, calls } = fakeClient([ref('s1', 'SOURCE')], run('GENERAL', ['SUCCEEDED', 'SUCCEEDED', 'PENDING', 'SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']));
  const r = await render(client);
  assert.equal(button(r, 'Otra versión').length, 6);
  assert.equal(button(r, 'Otra versión · $0.028').length, 1, 'the face front costs one take with its sources');
  assert.equal(button(r, 'Cambiar · $0.036').length, 5);
  assert.equal(r.root.findAll((n) => n.type === 'label' && n.props.className === 'creator-own').length, 6);
  assert.equal(button(r, 'Elegir').length, 5, 'only finished takes can be chosen');
  const change = r.root.findByProps({ 'aria-label': 'Cambio para Cara a tres cuartos' });
  await act(async () => { change.props.onChange({ target: { value: 'sonrisa leve' } }); });
  await act(async () => { button(r, 'Cambiar · $0.036')[0].props.onClick(); await settle(); });
  assert.deepEqual(calls.find((c) => c.action === 'RETAKE'), { action: 'RETAKE', runId: 'run-1', view: 'THREE_QUARTER', expectedCostMills: 36, instruction: 'sonrisa leve' });
  await act(async () => { button(r, 'Elegir')[0].props.onClick(); await settle(); });
  assert.deepEqual(calls.find((c) => c.action === 'CHOOSE'), { action: 'CHOOSE', takeId: 't0' });
});
