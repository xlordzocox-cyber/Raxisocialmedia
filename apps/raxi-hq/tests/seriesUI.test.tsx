import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NewSeriesPage, SeriesDetailPage } from '../src/series/SeriesPage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const mounted: ReactTestRenderer[] = [];
after(() => { for (const r of mounted) act(() => r.unmount()); });
const settle = () => new Promise((res) => setTimeout(res, 20));

function fakeClient(level: 'PUBLIC' | 'NSFW' = 'PUBLIC', detail?: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { object_path: 'ws/base.jpg' }, error: null }) }) }) }),
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: 'https://signed/' + p }, error: null }) }) },
    functions: { invoke: async (_n: string, opts: { body: Record<string, unknown> }) => {
      calls.push(opts.body);
      const b = opts.body;
      if (b.action === 'SERIES_QUOTE') return { data: { totalMills: 132, perPhotoMills: 44, level, channels: level === 'PUBLIC' ? ['INSTAGRAM', 'INSTAGRAM_STORY', 'TEASER', 'FANVUE_FEED', 'FANVUE_CHAT'] : ['FANVUE_FEED', 'FANVUE_CHAT'], spentMills: 1156, capMills: 10000 }, error: null };
      if (b.action === 'SERIES_START') return { data: { seriesId: 's-1' }, error: null };
      return { data: detail, error: null };
    } },
  } as unknown as SupabaseClient;
  return { client, calls };
}
async function render(node: React.ReactElement) {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter>{node}</MemoryRouter>); await settle(); });
  mounted.push(r); return r;
}
const btn = (r: ReactTestRenderer, prefix: string) => r.root.findAll((n) => n.type === 'button' && n.children.join('').startsWith(prefix));
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

test('new series: price shown, button off until scenes and attestation, then sends exactly what was shown', async () => {
  const { client, calls } = fakeClient();
  const r = await render(<NewSeriesPage client={client} characterId="vesper-corvus" baseAssetId="base-1" />);
  const start = () => r.root.findByProps({ id: 'series-start' });
  assert.equal(start().props.disabled, true);
  for (const [i, s] of ['sentada en la cama', 'de pie junto a la ventana', 'frente al espejo'].entries())
    await act(async () => { r.root.findByProps({ 'aria-label': `Escena ${i + 1}` }).props.onChange({ target: { value: s } }); await settle(); });
  assert.match(start().children.join(''), /Crear serie · \$0\.132/);
  assert.equal(start().props.disabled, true, 'attestation missing');
  await act(async () => { r.root.findByProps({ id: 'series-attest' }).props.onChange({ target: { checked: true } }); });
  assert.equal(start().props.disabled, false);
  assert.match(text(r), /\$0\.044.*por foto/);
  await act(async () => { start().props.onClick(); await settle(); });
  const sent = calls.find((c) => c.action === 'SERIES_START')!;
  assert.deepEqual({ ...sent, title: undefined }, { action: 'SERIES_START', character: 'vesper-corvus', baseAssetId: 'base-1', channel: 'INSTAGRAM',
    scenes: ['sentada en la cama', 'de pie junto a la ventana', 'frente al espejo'], model: 'bytedance/seedream-v5.5/edit', resolution: '1k', title: undefined, attestNotReal: true, expectedTotalMills: 132 });
});

test('new series: Fanvue scenes are hidden until NSFW is on, and the series cannot start without it', async () => {
  const { client } = fakeClient('NSFW');
  const r = await render(<NewSeriesPage client={client} characterId="vesper-corvus" baseAssetId="base-nsfw" />);
  await act(async () => { r.root.findByProps({ id: 'series-channel' }).props.onChange({ target: { value: 'FANVUE_FEED' } }); await settle(); });
  assert.equal(r.root.findAll((n) => n.props['aria-label'] === 'Escena 1').length, 0, 'adult scenes hidden with NSFW off');
  assert.equal(r.root.findByProps({ id: 'series-start' }).props.disabled, true);
  await act(async () => { r.root.findByProps({ id: 'series-nsfw' }).props.onChange({ target: { checked: true } }); });
  assert.equal(r.root.findAll((n) => n.props['aria-label'] === 'Escena 1').length, 1);
  assert.match(text(r), /las escenas de Fanvue las escribes tú/);
});

const detail = (level: string, statuses: string[]) => ({ seriesId: 's-1', character: 'vesper-corvus', channel: level === 'PUBLIC' ? 'INSTAGRAM' : 'FANVUE_FEED', level, model: 'm',
  scenes: ['sentada en la cama', 'junto a la ventana'], baseUrl: 'https://signed/base.jpg', collectionId: 'c',
  takes: statuses.map((s, i) => ({ id: `t${i}`, shot: i + 1, takeNo: 1, status: s, costMills: 44, error: null, chosen: false, previewUrl: s === 'SUCCEEDED' ? `https://signed/${i}.png` : null })) });

test('series detail: each photo offers another version, change and choose with its cost', async () => {
  const { client, calls } = fakeClient('PUBLIC', detail('PUBLIC', ['SUCCEEDED', 'SUCCEEDED']));
  const r = await render(<SeriesDetailPage client={client} seriesId="s-1" pollMs={60_000} />);
  assert.equal(btn(r, 'Otra versión · $0.044').length, 2);
  assert.equal(btn(r, 'Cambiar · $0.044').length, 2);
  assert.equal(btn(r, 'Elegir').length, 2);
  await act(async () => { r.root.findByProps({ 'aria-label': 'Cambio para la foto 3' }).props.onChange({ target: { value: 'sin el teléfono' } }); });
  await act(async () => { btn(r, 'Cambiar · $0.044')[1].props.onClick(); await settle(); });
  assert.deepEqual(calls.find((c) => c.action === 'SERIES_RETAKE'), { action: 'SERIES_RETAKE', seriesId: 's-1', shot: 2, instruction: 'sin el teléfono', expectedCostMills: 44 });
});

test('series detail: a Fanvue series shows nothing until NSFW is turned on', async () => {
  const { client } = fakeClient('NSFW', detail('NSFW', ['SUCCEEDED', 'SUCCEEDED']));
  const r = await render(<SeriesDetailPage client={client} seriesId="s-1" pollMs={60_000} />);
  assert.equal(r.root.findAllByType('img').length, 0);
  await act(async () => { r.root.findByProps({ id: 'series-detail-nsfw' }).props.onChange({ target: { checked: true } }); });
  assert.ok(r.root.findAllByType('img').length >= 3);
});
