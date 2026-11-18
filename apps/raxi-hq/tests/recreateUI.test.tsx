import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NewRecreatePage, RecreateDetailPage } from '../src/recreate/RecreatePage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const mounted: ReactTestRenderer[] = [];
after(() => { for (const r of mounted) act(() => r.unmount()); });
const settle = () => new Promise((res) => setTimeout(res, 20));
const CINE = 'Cinematic photograph of this woman from the reference photo, keep the exact same face and hair from the reference. Cinematic photo, realistic skin texture';

function fakeClient(detail?: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    functions: { invoke: async (_n: string, opts: { body: Record<string, unknown> }) => {
      calls.push(opts.body);
      const b = opts.body;
      if (b.action === 'RECREATE_PROMPT') return { data: { objectivePath: 'ws/recreate/drafts/x.jpg', objectiveUrl: 'https://signed/x.jpg', prompt: CINE, summary: 'Listo', observations: [], warnings: ['Solo cara visible'], promptCostMills: 20 }, error: null };
      if (b.action === 'RECREATE_QUOTE') return { data: { totalMills: 36 * Number(b.variants), perPhotoMills: 36, spentMills: 1244, capMills: 10000 }, error: null };
      if (b.action === 'RECREATE_START') return { data: { recreationId: 'rc-1' }, error: null };
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
const byId = (r: ReactTestRenderer, id: string) => r.root.find((n) => n.props.id === id);
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

test('Recrear: nothing is spent until a photo, a prepared prompt, the attestation and the priced click', async () => {
  const { client, calls } = fakeClient();
  const r = await render(<NewRecreatePage client={client} characterId="vesper-corvus" read={async () => 'data:image/png;base64,AAAA'} />);
  assert.equal(byId(r, 'rc-style').props.value, 'CINEMATIC', 'Vesper defaults to cinematic');
  assert.equal(byId(r, 'rc-prepare').props.disabled, true, 'no photo yet');
  await act(async () => { byId(r, 'rc-file').props.onChange({ target: { files: [{ type: 'image/png' }] } }); await settle(); });
  assert.match(String(byId(r, 'rc-prepare').props.children), /Preparar prompt · unos \$0\.02/);
  await act(async () => { byId(r, 'rc-prepare').props.onClick(); await settle(); });
  assert.equal(calls[0].action, 'RECREATE_PROMPT'); assert.equal(calls[0].image, 'data:image/png;base64,AAAA');
  assert.equal(byId(r, 'rc-prompt').props.value, CINE);
  assert.match(text(r), /Solo cara visible/);
  assert.match(text(r), /Prompter en esta foto: \$0\.02/);
  assert.equal(byId(r, 'rc-start').props.disabled, true, 'attestation required');
  await act(async () => { byId(r, 'rc-variants').props.onChange({ target: { value: '3' } }); await settle(); });
  await act(async () => { byId(r, 'rc-attest').props.onChange({ target: { checked: true } }); await settle(); });
  assert.match(String(byId(r, 'rc-start').props.children), /Crear 3 fotos · \$0\.108/);
  assert.ok(!calls.some((c) => c.action === 'RECREATE_START'));
  // Rehacer reuses the stored photo instead of uploading again.
  await act(async () => { byId(r, 'rc-prepare').props.onClick(); await settle(); });
  assert.equal(calls.filter((c) => c.action === 'RECREATE_PROMPT')[1].objectivePath, 'ws/recreate/drafts/x.jpg');
  assert.equal(calls.filter((c) => c.action === 'RECREATE_PROMPT')[1].image, undefined);
  await act(async () => { byId(r, 'rc-start').props.onClick(); await settle(); });
  const start = calls.find((c) => c.action === 'RECREATE_START')!;
  assert.equal(start.expectedTotalMills, 108); assert.equal(start.variants, 3); assert.equal(start.attestNotReal, true);
  assert.equal(start.objectivePath, 'ws/recreate/drafts/x.jpg'); assert.equal(start.channel, 'INSTAGRAM');
});

test('Recrear: Raxi defaults to amateur; only public channels are offered', async () => {
  const { client } = fakeClient();
  const r = await render(<NewRecreatePage client={client} characterId="raxi-vox" read={async () => 'x'} />);
  assert.equal(byId(r, 'rc-style').props.value, 'AMATEUR');
  const options = r.root.findAll((n) => n.type === 'option' && ['INSTAGRAM', 'INSTAGRAM_STORY', 'TEASER', 'FANVUE_FEED', 'FANVUE_CHAT'].includes(n.props.value)).map((n) => n.props.value);
  assert.deepEqual(options, ['INSTAGRAM', 'INSTAGRAM_STORY', 'TEASER']);
});

test('Recrear detail: versions, another version at the shown price, and choose', async () => {
  const detail = { recreationId: 'rc-1', character: 'vesper-corvus', channel: 'INSTAGRAM', style: 'CINEMATIC', prompt: CINE, variants: 2, objectiveUrl: 'https://signed/x.jpg',
    takes: [{ id: 't1', variant: 1, takeNo: 1, status: 'SUCCEEDED', costMills: 36, error: null, chosen: false, previewUrl: 'https://signed/1.png' },
      { id: 't2', variant: 2, takeNo: 1, status: 'SUCCEEDED', costMills: 36, error: null, chosen: false, previewUrl: 'https://signed/2.png' }] };
  const { client, calls } = fakeClient(detail);
  const r = await render(<RecreateDetailPage client={client} recreationId="rc-1" />);
  assert.match(text(r), /Versión 1/); assert.match(text(r), /Versión 2/);
  const again = r.root.findAll((n) => n.type === 'button' && String(n.props.children) === 'Otra versión · $0.036');
  assert.equal(again.length, 2);
  await act(async () => { again[1].props.onClick(); await settle(); });
  assert.deepEqual(calls.at(-1), { action: 'RECREATE_RETAKE', recreationId: 'rc-1', variant: 2, expectedCostMills: 36 });
  const choose = r.root.findAll((n) => n.type === 'button' && n.props.children === 'Elegir');
  await act(async () => { choose[0].props.onClick(); await settle(); });
  assert.ok(calls.some((c) => c.action === 'RECREATE_CHOOSE' && c.takeId === 't1'));
});
