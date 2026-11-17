import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConnections, validateProviderKey, PROVIDERS } from '../src/connections/connectionsModel';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnectionHandler, type ConnectionDependencies } from '../../../supabase/functions/provider-connection/handler';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConexionesPage } from '../src/connections/ConexionesPage';

const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAKE_KEY = 'wsk_test_0000000000000000ABCD';

test('connections model: key validation trims and rejects junk', () => {
  assert.equal(validateProviderKey(`  ${FAKE_KEY}\n`), FAKE_KEY);
  assert.throws(() => validateProviderKey(''), /clave/i);
  assert.throws(() => validateProviderKey('short'), /clave/i);
  assert.throws(() => validateProviderKey('has space inside 0000000000'), /clave/i);
  assert.throws(() => validateProviderKey('x'.repeat(513)), /clave/i);
});

test('connections model: rows are validated and never carry a secret', () => {
  const view = buildConnections(ws, [
    { workspace_id: ws, provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED', verified_at: '2026-11-17T01:00:00Z', updated_at: '2026-11-17T01:00:00Z' },
  ]);
  assert.deepEqual(view, [{ provider: 'WAVESPEED', label: 'WaveSpeed', last4: 'ABCD', status: 'CONNECTED', verifiedAt: '2026-11-17T01:00:00Z' }]);
  assert.deepEqual(buildConnections(ws, []), [{ provider: 'WAVESPEED', label: 'WaveSpeed', last4: null, status: 'NOT_CONNECTED', verifiedAt: null }]);
  assert.throws(() => buildConnections(ws, [{ workspace_id: 'other', provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED' }]));
  assert.throws(() => buildConnections(ws, [{ workspace_id: ws, provider: 'WAVESPEED', last4: 'TOOLONG', status: 'CONNECTED' }]));
  assert.throws(() => buildConnections(ws, [{ workspace_id: ws, provider: 'OTHER', last4: 'ABCD', status: 'CONNECTED' }]));
  assert.deepEqual(PROVIDERS, ['WAVESPEED']);
});


test('connections migration: no client role can reach the secret', () => {
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261117000000_raxi_hq_provider_connections.sql'), 'utf8');
  assert.match(sql, /alter table public\.raxi_provider_connections enable row level security/);
  assert.match(sql, /revoke all on public\.raxi_provider_connections from anon, authenticated/);
  assert.match(sql, /grant select \(workspace_id, provider, last4, status, verified_at, updated_at\) on public\.raxi_provider_connections to authenticated/);
  for (const fn of ['raxi_connection_store', 'raxi_connection_remove', 'raxi_connection_secret']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`), fn);
  }
  assert.doesNotMatch(sql, /grant[^;]*vault[^;]*to (anon|authenticated)/i);
  assert.doesNotMatch(sql, /jsonb_build_object\([^)]*p_secret/i, 'the secret must never be written to audit details');
});


const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function deps(over: Partial<ConnectionDependencies> = {}) {
  const calls: string[] = [];
  const d: ConnectionDependencies = {
    async verifyUser(token) { return token === 'good' ? { id: owner, isAnonymous: false } : token === 'anon' ? { id: owner, isAnonymous: true } : null; },
    async checkKey(_provider, key) { calls.push('check'); return key === FAKE_KEY ? 'VALID' : 'REJECTED'; },
    async store(actor, provider, key) { calls.push(`store:${actor}:${provider}:${key.length}`); return { provider, last4: key.slice(-4), status: 'CONNECTED' }; },
    async readKey() { calls.push('read'); return FAKE_KEY; },
    async mark(_a, _p, status) { calls.push(`mark:${status}`); },
    async remove(actor, provider) { calls.push(`remove:${actor}:${provider}`); return { provider, status: 'NOT_CONNECTED' }; },
    ...over,
  };
  return { d, calls };
}
const post = (body: unknown, token = 'good') => new Request('https://x/functions/v1/provider-connection', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('connection handler: auth is required and anonymous users are rejected', async () => {
  const { d, calls } = deps();
  const h = createConnectionHandler(d);
  assert.equal((await h(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }, 'bad'))).status, 401);
  assert.equal((await h(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }, 'anon'))).status, 401);
  assert.equal((await h(new Request('https://x', { method: 'GET' }))).status, 405);
  assert.deepEqual(calls, []);
});

test('connection handler: SET verifies first, stores, and never echoes the key', async () => {
  const { d, calls } = deps();
  const res = await createConnectionHandler(d)(post({ action: 'SET', provider: 'WAVESPEED', key: `  ${FAKE_KEY} ` }));
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED' });
  assert.ok(!text.includes(FAKE_KEY));
  assert.deepEqual(calls, ['check', `store:${owner}:WAVESPEED:${FAKE_KEY.length}`]);
});

test('connection handler: a rejected or unverifiable key is not stored', async () => {
  const a = deps();
  const bad = await createConnectionHandler(a.d)(post({ action: 'SET', provider: 'WAVESPEED', key: 'wsk_test_0000000000000000XXXX' }));
  assert.equal(bad.status, 422);
  assert.deepEqual(a.calls, ['check']);
  const b = deps({ async checkKey() { return 'UNAVAILABLE'; } });
  assert.equal((await createConnectionHandler(b.d)(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }))).status, 503);
  assert.deepEqual(b.calls, []);
});

test('connection handler: invalid bodies are rejected without side effects', async () => {
  const { d, calls } = deps();
  const h = createConnectionHandler(d);
  for (const body of [{}, { action: 'SET', provider: 'OTHER', key: FAKE_KEY }, { action: 'SET', provider: 'WAVESPEED', key: 'short' }, { action: 'NOPE', provider: 'WAVESPEED' }, { action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY, extra: 1 }]) {
    assert.equal((await h(post(body))).status, 400);
  }
  assert.deepEqual(calls, []);
});

test('connection handler: TEST re-checks the stored key and REMOVE deletes it', async () => {
  const ok = deps();
  const t = await createConnectionHandler(ok.d)(post({ action: 'TEST', provider: 'WAVESPEED' }));
  assert.deepEqual(await t.json(), { provider: 'WAVESPEED', status: 'CONNECTED' });
  assert.deepEqual(ok.calls, ['read', 'check', 'mark:CONNECTED']);
  const none = deps({ async readKey() { return null; } });
  assert.equal((await createConnectionHandler(none.d)(post({ action: 'TEST', provider: 'WAVESPEED' }))).status, 404);
  const rm = deps();
  assert.deepEqual(await (await createConnectionHandler(rm.d)(post({ action: 'REMOVE', provider: 'WAVESPEED' }))).json(), { provider: 'WAVESPEED', status: 'NOT_CONNECTED' });
  assert.deepEqual(rm.calls, [`remove:${owner}:WAVESPEED`]);
});

test('connection handler: internal errors never leak details or the key', async () => {
  const { d } = deps({ async store() { throw new Error(`boom ${FAKE_KEY}`); } });
  const res = await createConnectionHandler(d)(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }));
  const text = await res.text();
  assert.equal(res.status, 503);
  assert.ok(!text.includes(FAKE_KEY) && !text.includes('boom'));
});


Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

function fakeClient(rows: unknown[], invoke: (body: unknown) => { data?: unknown; error?: unknown }) {
  const sent: unknown[] = [];
  const client = {
    rpc: async () => ({ data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null }),
    from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }),
    functions: { invoke: async (_name: string, opts: { body: unknown }) => { sent.push(opts.body); return invoke(opts.body); } },
  } as unknown as SupabaseClient;
  return { client, sent };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const textOf = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

test('Conexiones page: shows not-connected, saves once, clears the field, never renders the key', async () => {
  const { client, sent } = fakeClient([], () => ({ data: { provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED' }, error: null }));
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><ConexionesPage client={client} ownerId={owner} /></MemoryRouter>); });
  await flush();
  assert.match(textOf(r), /Sin conectar/);
  const input = r.root.findByProps({ id: 'wavespeed-key' });
  assert.equal(input.props.type, 'password');
  assert.equal(input.props.autoComplete, 'off');
  await act(async () => { input.props.onChange({ target: { value: FAKE_KEY } }); });
  await act(async () => { r.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await flush();
  assert.deepEqual(sent, [{ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }]);
  assert.equal(r.root.findByProps({ id: 'wavespeed-key' }).props.value, '');
  assert.ok(!textOf(r).includes(FAKE_KEY));
});

test('Conexiones page: connected state shows only the last four and offers test and disconnect', async () => {
  const { client, sent } = fakeClient(
    [{ workspace_id: ws, provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED', verified_at: '2026-11-17T01:00:00Z', updated_at: '2026-11-17T01:00:00Z' }],
    (body) => ({ data: { provider: 'WAVESPEED', status: (body as { action: string }).action === 'TEST' ? 'CONNECTED' : 'NOT_CONNECTED' }, error: null }),
  );
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><ConexionesPage client={client} ownerId={owner} /></MemoryRouter>); });
  await flush();
  assert.match(textOf(r), /Conectada/);
  assert.match(textOf(r), /ABCD/);
  const button = (label: string) => r.root.findAllByType('button').find((b) => b.children.join('') === label)!;
  await act(async () => { button('Probar conexión').props.onClick(); });
  await flush();
  assert.deepEqual(sent, [{ action: 'TEST', provider: 'WAVESPEED' }]);
});

test('Conexiones page: an invalid key shows an error and still clears the field', async () => {
  const { client } = fakeClient([], () => ({ data: null, error: { message: 'rejected' } }));
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><ConexionesPage client={client} ownerId={owner} /></MemoryRouter>); });
  await flush();
  await act(async () => { r.root.findByProps({ id: 'wavespeed-key' }).props.onChange({ target: { value: FAKE_KEY } }); });
  await act(async () => { r.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await flush();
  assert.equal(r.root.findByProps({ id: 'wavespeed-key' }).props.value, '');
  assert.ok(r.root.findAllByProps({ role: 'alert' }).length > 0);
});
