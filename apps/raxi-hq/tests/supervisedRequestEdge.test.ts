import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupervisedCampaignEdgeHandler } from '../../../supabase/functions/supervised-campaign-request/handler';

const url = 'https://zvhxjindgyvtasstfjut.supabase.co/functions/v1/supervised-campaign-request';
const origin = 'http://127.0.0.1:5175';
const make = (operation = 'preflight', from = origin, method = 'POST') =>
  new Request(url, { method, headers: { Origin: from, 'x-raxi-operation': operation, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}) });

test('Edge route remains disabled with no configured privileged handlers', async () => {
  const disabled = createSupervisedCampaignEdgeHandler({ enabled: false, handlers: null, allowedOrigins: [origin] });
  const r = await disabled(make());
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await r.json(), { status: 'DISABLED', reason: 'STAGING_APPROVAL_REQUIRED' });
});

test('Edge CORS and closed route reject unexpected methods, origins and operations before dispatch', async () => {
  let calls = 0;
  const handler = createSupervisedCampaignEdgeHandler({ enabled: true, allowedOrigins: [origin],
    handlers: {
      async preflight() { calls++; return Response.json({ status: 'ELIGIBLE', snapshotHash: 'a'.repeat(64) }); },
      async submit() { calls++; return Response.json({ status: 'REQUESTED' }); },
    } });
  assert.equal((await handler(make('preflight', 'https://untrusted.test'))).status, 403);
  assert.equal((await handler(make('delete'))).status, 400);
  assert.equal((await handler(make('preflight', origin, 'GET'))).status, 405);
  assert.equal((await handler(new Request('https://example.test/other', {
    method: 'POST', headers: { Origin: origin, 'x-raxi-operation': 'preflight' }, body: '{}' }))).status, 404);
  const cors = await handler(make('preflight', origin, 'OPTIONS'));
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('Access-Control-Allow-Origin'), origin);
  assert.match(cors.headers.get('Access-Control-Allow-Headers') ?? '', /x-raxi-operation/);
  assert.equal(calls, 0);
  const preflight = await handler(make());
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(preflight.headers.get('Cache-Control'), 'no-store');
  assert.equal((await preflight.json() as { status: string }).status, 'ELIGIBLE');
  const submit = await handler(make('submit'));
  assert.equal(submit.status, 200);
  assert.equal((await submit.json() as { status: string }).status, 'REQUESTED');
  assert.equal(calls, 2);
});

test('Edge boundary cannot claim a privileged commit on handler failures', async () => {
  const handler = createSupervisedCampaignEdgeHandler({
    enabled: true, allowedOrigins: [origin],
    handlers: { async preflight() { throw Error('private key should not leak'); },
      async submit() { throw Error('private key should not leak'); } },
  });
  const result = await handler(make('submit'));
  assert.equal(result.status, 503);
  const text = await result.text();
  assert.equal(text.includes('private key'), false);
  assert.deepEqual(JSON.parse(text), { status: 'UNKNOWN', reason: 'CONFIRMATION_UNAVAILABLE' });
});
