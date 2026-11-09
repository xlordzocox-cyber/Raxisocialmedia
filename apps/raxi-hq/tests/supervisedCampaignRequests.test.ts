import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { campaignDatabase } from './campaignDatabase';
import { attentionFixture, attentionOwner as owner, attentionWorkspace as workspace } from './humanAttentionFixture';
import { applyCampaignOperation, parseCampaignSnapshot, type CampaignSnapshot, type RealCampaignAction } from '../src/persistence/campaignCommands';
import { supervisedCampaignRequests, MAX_SUPERVISED_HOST_EVIDENCE_BYTES, supervisedEvidenceWithinBudget } from '../../../server/agent-runtime/supervisedCampaignRequests';
import { supabaseSupervisedAuth, type ServerRpcPort, type UserAuthPort } from '../../../server/agent-runtime/supabaseSupervisedAuth';

const projectRef = 'zzzzzzzzzzzzzzzzzzzz';
const other = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherSession = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const otherWorkspace = '99999999-9999-4999-8999-999999999999';
const actions = (snapshot: CampaignSnapshot): RealCampaignAction => ({
  type: 'APPROVE_STRATEGY', campaignId: snapshot.session.campaigns[0].id, revision: 1, confirmed: true,
});
const operation = (snapshot: CampaignSnapshot, action: RealCampaignAction) => ({
  workspaceId: workspace, operationId: crypto.randomUUID(), expectedVersion: snapshot.version, action,
});
const draft = (snapshot: CampaignSnapshot) => ({
  workspaceId: workspace, campaignId: snapshot.session.campaigns[0].id, strategyRevision: 1,
  deliverableId: snapshot.session.strategies[0].deliverables[0].id,
  expectedCampaignVersion: snapshot.version, requestKey: crypto.randomUUID(), purpose: 'PREPARE_VISUAL_BRIEF',
});
const request = (value: unknown, token: string | null = 'local-fixture') => new Request('https://fixture.invalid', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(value),
});
const identity = () => ({ provenance: 'SUPABASE_AUTH_STAGING' as const, workspaceId: workspace, actorId: owner, sessionId, projectRef,
  expiresAt: new Date(Date.now() + 60000).toISOString() });

test('supervised evidence byte ceiling is based on UTF-8, not JavaScript characters', () => {
  const limit = MAX_SUPERVISED_HOST_EVIDENCE_BYTES;
  assert.equal(supervisedEvidenceWithinBudget('a'.repeat(limit - 2)), true);
  assert.equal(supervisedEvidenceWithinBudget('a'.repeat(limit - 1)), false);
  assert.equal(supervisedEvidenceWithinBudget('界'.repeat(Math.floor((limit - 2) / 3))), true);
  assert.equal(supervisedEvidenceWithinBudget('界'.repeat(Math.floor((limit - 2) / 3) + 1)), false);
});

test('closed HTTP boundary rejects unauthenticated and forged commands before SQL', async () => {
  const s = attentionFixture(), input = draft(s);
  let calls = 0;
  const handlers = supervisedCampaignRequests({ projectRef, verify: async () => { calls++; return identity(); },
    server: { rpc: async () => { calls++; throw Error('not reached'); } } });
  assert.equal((await handlers.preflight(request(input, null))).status, 401);
  for (const extra of [{ actorId: owner }, { approved: true }, { provider: 'aria' }, { model: 'test' }, { cost: 0 },
    { credential: 'synthetic' }, { privilege: 'admin' }, { campaignId: ['CAMPAIGN-001'] },
    { expectedCampaignVersion: -1 }, { strategyRevision: 0 }, { strategyRevision: 11 }, { purpose: 'x'.repeat(4200) }]) {
    assert.equal((await handlers.preflight(request({ ...input, ...extra }))).status, 400);
  }
  assert.equal((await handlers.submit(request(input))).status, 400);
  assert.equal((await handlers.preflight(request({ ...input, snapshotHash: 'a'.repeat(64) }))).status, 400);
  assert.equal(calls, 0);
  assert.throws(() => supervisedCampaignRequests({ projectRef: 'jrkefsylpfriiqefcmzq', verify: async () => identity(),
    server: { rpc: async () => { throw Error('not reached'); } } }));
});

test('rate-limit boundary rejects unverified admissions before canonical snapshot or commit', async () => {
  const input = draft(attentionFixture());
  const calls: string[] = [];
  let allowance: 'deny' | 'malformed' | 'replay-conflict' = 'deny';
  const handlers = supervisedCampaignRequests({ projectRef, verify: async () => identity(),
    server: { rpc: async (name, args) => {
      calls.push(name);
      if (name === 'raxi_supervised_request_rate_admit') {
        if (allowance === 'malformed') return { data: { status: 'ALLOWED', operation: 'WRONG' }, error: null };
        if (allowance === 'replay-conflict' && args.p_operation === 'REPLAY') {
          return { data: { status: 'ALLOWED', operation: 'REPLAY' }, error: null };
        }
        return { data: { status: 'RATE_LIMITED', operation: args.p_operation, retryAfterSeconds: 17 }, error: null };
      }
      if (name === 'raxi_supervised_campaign_request_replay' && allowance === 'replay-conflict') {
        return { data: { status: 'CONFLICT' }, error: null };
      }
      throw Error('canonical query must not be reached');
    } },
  });
  const blocked = await handlers.preflight(request(input));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '17');
  assert.deepEqual(await blocked.json(), { status: 'RATE_LIMITED', reason: 'REQUEST_RATE_LIMIT', retryAfterSeconds: 17 });
  assert.deepEqual(calls, ['raxi_supervised_request_rate_admit']);
  calls.length = 0;
  const submitted = await handlers.submit(request({ ...input, snapshotHash: 'a'.repeat(64) }));
  assert.equal(submitted.status, 429);
  assert.deepEqual(calls, ['raxi_supervised_request_rate_admit']);
  calls.length = 0;
  allowance = 'malformed';
  assert.deepEqual(await (await handlers.preflight(request(input))).json(),
    { status: 'UNKNOWN', reason: 'CONFIRMATION_UNAVAILABLE' });
  assert.deepEqual(calls, ['raxi_supervised_request_rate_admit']);
  calls.length = 0;
  allowance = 'replay-conflict';
  const conflict = await handlers.submit(request({ ...input, snapshotHash: 'a'.repeat(64) }));
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { status: 'CONFLICT' });
  // A known-key result never consumes the much smaller new-SUBMIT quota.
  assert.deepEqual(calls, ['raxi_supervised_request_rate_admit', 'raxi_supervised_campaign_request_replay']);
});

test('preflight fails closed on incompatible or corrupt editorial evidence and scope', async () => {
  const fixture = attentionFixture();
  const approved = applyCampaignOperation(fixture, operation(fixture, actions(fixture)));
  const input = draft(approved);
  let current = structuredClone(approved);
  let unavailable = false;
  let currentIdentity = identity();
  const handlers = supervisedCampaignRequests({ projectRef, verify: async () => currentIdentity,
    server: { rpc: async name => {
      if (name === 'raxi_supervised_request_rate_admit') {
        return { data: { status: 'ALLOWED', operation: 'PREFLIGHT' }, error: null };
      }
      assert.equal(name, 'raxi_campaign_snapshot');
      if (unavailable) throw Error('synthetic network failure');
      return { data: structuredClone(current), error: null };
    } } });
  assert.equal((await handlers.preflight(request(input))).status, 200);
  for (const status of ['DRAFT', 'BLOCKED', 'CANCELED'] as const) {
    current = structuredClone(approved);
    current.session.campaigns[0].status = status;
    assert.equal((await handlers.preflight(request(input))).status, 422);
  }
  current = structuredClone(approved);
  current.session.strategies[0].deliverables.push(current.session.strategies[0].deliverables[0]);
  assert.equal((await handlers.preflight(request(input))).status, 503);
  current = structuredClone(approved);
  current.receipts.pop();
  assert.equal((await handlers.preflight(request(input))).status, 422);
  current = structuredClone(approved);
  current.session.audit.at(-1)!.actor = 'SYSTEM' as never;
  assert.equal((await handlers.preflight(request(input))).status, 422);
  current = structuredClone(approved);
  const approval = current.receipts.at(-1)!.command.action;
  assert.equal(approval.type, 'APPROVE_STRATEGY');
  if (approval.type === 'APPROVE_STRATEGY') approval.confirmed = false;
  assert.equal((await handlers.preflight(request(input))).status, 422);
  current = structuredClone(approved);
  current.ownerId = other;
  assert.equal((await handlers.preflight(request(input))).status, 503);
  current = structuredClone(approved);
  currentIdentity = { ...identity(), expiresAt: '2000-01-01T00:00:00Z' };
  assert.equal((await handlers.preflight(request(input))).status, 403);
  currentIdentity = identity();
  unavailable = true;
  const result = await handlers.preflight(request(input));
  assert.deepEqual(await result.json(), { status: 'UNKNOWN', reason: 'CONFIRMATION_UNAVAILABLE' });
});

test('isolated PostgreSQL accepts only canonical intent, and reconciles concurrent duplicate and lost response', async () => {
  const db = await campaignDatabase();
  try {
    const stageB = readFileSync('../../supabase/proposals/supervised_host_stage_b.sql', 'utf8');
    const identitySql = stageB.slice(stageB.indexOf('create function public.raxi_supervised_host_identity('),
      stageB.indexOf('create or replace function public.raxi_supervised_identity()'));
    await db.exec(`alter table auth.users add column is_anonymous boolean not null default false;
      create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
      grant select on auth.sessions,auth.users to service_role;
      ${identitySql}
      revoke all on function public.raxi_supervised_host_identity(jsonb) from public,anon,authenticated;
      grant execute on function public.raxi_supervised_host_identity(jsonb) to service_role;`);
    await db.exec(readFileSync('../../supabase/proposals/supervised_campaign_requests.sql', 'utf8'));
    await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sessionId, owner]);
    await db.query("insert into public.raxi_workspaces(id,owner_user_id,slug,name) values($1,$2,'raxi-hq','Synthetic')", [workspace, owner]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [otherSession, other]);
    await db.query("insert into public.raxi_workspaces(id,owner_user_id,slug,name) values($1,$2,'raxi-hq','Other synthetic workspace')", [otherWorkspace, other]);
    const fixture = attentionFixture();
    const idea = fixture.ideas[0];
    await db.query("insert into public.raxi_ideas(workspace_id,external_id,kind,title,status,source,summary,priority,payload) values($1,$2,'PROPOSAL',$3,$4,'MANUAL_LUIS',$5,$6,$7)",
      [workspace, idea.id, idea.title, 'PROPOSED', idea.summary, idea.priority,
        JSON.stringify({ ...idea, status: 'PROPOSED', approvedAt: undefined, sentToHqAt: undefined, sentAt: undefined })]);
    await db.exec('set role service_role');
    const read = async () => parseCampaignSnapshot((await db.query<{ v: unknown }>('select public.raxi_campaign_snapshot($1,$2) v', [workspace, owner])).rows[0].v, owner, workspace);
    const run = async (action: RealCampaignAction) => {
      const snapshot = await read(), op = operation(snapshot, action);
      await db.query('select public.raxi_campaign_commit($1,$2,$3)', [owner, JSON.stringify(op), JSON.stringify(applyCampaignOperation(snapshot, op))]);
    };
    for (const type of ['REVIEW_IDEA', 'APPROVE_IDEA', 'HANDOFF_IDEA'] as const) {
      await run({ type, ideaId: idea.id, expectedUpdatedAt: (await read()).ideas[0].updatedAt, confirmed: true });
    }
    const campaign = fixture.session.campaigns[0], revision = fixture.session.strategies[0];
    await run({ type: 'CREATE_CAMPAIGN', ideaId: idea.id, brief: {
      title: campaign.title, objective: campaign.objective, priority: campaign.priority,
      channels: campaign.channels, contentLevels: campaign.contentLevels, keyMessage: campaign.keyMessage,
    } });
    await run({ type: 'TRANSITION_CAMPAIGN', campaignId: campaign.id, to: 'PLANNING' });
    // Valid editorial data can exceed 64 KiB when encoded as UTF-8.
    const max = '界'.repeat(1500);
    const deliverables = Array.from({ length: 12 }, (_, index) => ({
      ...revision.deliverables[0], id: 'STRATEGY-ITEM-' + String(index + 1).padStart(3, '0'),
      purpose: '界'.repeat(500), creativeAngle: '界'.repeat(500),
    }));
    await run({ type: 'SAVE_STRATEGY', campaignId: campaign.id, input: {
      audience: max, audienceNeed: max, creativeConcept: max, narrativeApproach: max, visualDirection: max,
      toneOfVoice: max, desiredAudienceResponse: max, successCriteria: max, notes: '界'.repeat(2000), deliverables,
    } });
    await run({ type: 'SUBMIT_STRATEGY', campaignId: campaign.id, revision: 1 });
    await run(actions(await read()));
    const initial = await read();
    const input = draft(initial);
    let lose = false;
    let corruptReceipt = false;
    let beforeCommit: ((args: Record<string, unknown>) => Promise<void>) | undefined;
    const server: ServerRpcPort = { rpc: async (name, args) => {
      if (name === 'raxi_campaign_snapshot') {
        return { data: (await db.query<{ v: unknown }>('select public.raxi_campaign_snapshot($1,$2) v', [args.p_workspace, args.p_actor])).rows[0].v, error: null };
      }
      if (name === 'raxi_supervised_request_rate_admit') {
        // Existing canonical scenario exercises an admissible request without
        // exhausting the trial quota. Native SQL admission is tested below.
        return { data: { status: 'ALLOWED', operation: args.p_operation }, error: null };
      }
      assert.ok(['raxi_supervised_host_identity', 'raxi_supervised_campaign_request_replay', 'raxi_supervised_campaign_request_commit'].includes(name));
      const arity = name.endsWith('_commit') ? '$1,$2,$3,$4' : name.endsWith('_replay') ? '$1,$2' : '$1';
      if (name.endsWith('_commit')) await beforeCommit?.(args);
      const params = [args.p_identity, args.p_command, args.p_expected, args.p_evidence].filter(value => value !== undefined).map(value => JSON.stringify(value));
      const data = (await db.query<{ v: unknown }>(`select public.${name}(${arity}) v`, params)).rows[0].v;
      if (name.endsWith('_commit') && lose) throw Error('response lost after SQL commit');
      return { data: corruptReceipt && name.endsWith('_replay') && data && typeof data === 'object'
        ? { ...data, evidence: {} } : data, error: null };
    } };
    const auth: UserAuthPort = {
      getClaims: async token => ({ error: token === 'invalid' ? 'fixture rejected' : null, data: { claims: {
        iss: `https://${projectRef}.supabase.co/auth/v1`, aud: 'authenticated', role: 'authenticated',
        is_anonymous: token === 'anonymous', exp: Math.floor(Date.now()/1000) + (token === 'expired' ? -10 : 60),
        iat: Math.floor(Date.now()/1000) - 30, sub: token === 'other' ? other : owner, session_id: token === 'other' ? otherSession : sessionId,
      } } }),
      getUser: async token => ({ error: null, data: { user: { id: token === 'other' ? other : owner, is_anonymous: false } } }),
    };
    const mount = () => supervisedCampaignRequests({ projectRef, verify: supabaseSupervisedAuth({ projectRef, auth, server }), server });
    const handlers = mount();
    // Native SQL counter logic, with independent quotas sharing the same
    // verified workspace and actor; seed near each fixed-window boundary.
    await db.exec('reset role');
    for (const [operation, initial] of [['PREFLIGHT', 29], ['SUBMIT', 2], ['REPLAY', 59]] as const) {
      await db.query(`insert into public.raxi_supervised_request_rate_counters
        (workspace_id,actor_user_id,operation,window_start,request_count)
        values($1,$2,$3,to_timestamp((floor(extract(epoch from clock_timestamp()) / 60)::bigint * 60)::double precision),$4)
        `, [workspace, owner, operation, initial]);
    }
    await db.exec('set role service_role');
    const rate = async (operation: string, subject = identity()) =>
      (await db.query<{ v: { status: string; operation: string; retryAfterSeconds?: number } }>(
        'select public.raxi_supervised_request_rate_admit($1,$2) v', [JSON.stringify(subject), operation])).rows[0].v;
    for (const operation of ['PREFLIGHT', 'SUBMIT', 'REPLAY'] as const) {
      assert.deepEqual(await rate(operation), { status: 'ALLOWED', operation });
      const blocked = await rate(operation);
      assert.equal(blocked.status, 'RATE_LIMITED');
      assert.equal(blocked.operation, operation);
      assert.ok(Number.isInteger(blocked.retryAfterSeconds) && blocked.retryAfterSeconds! >= 1 && blocked.retryAfterSeconds! <= 60);
    }
    assert.equal((await db.query<{ total: number }>(
      'select coalesce(sum(request_count),0)::int total from public.raxi_supervised_request_rate_counters')).rows[0].total, 93);
    await assert.rejects(rate('UNTRUSTED'), error => !!error && typeof error === 'object' &&
      'code' in error && error.code === '22023');
    // No production quota is authorized yet. The remainder of this integration
    // test uses an explicitly stubbed, independently tested admission port.
    const count = async () => (await db.query<{ n: number }>("select count(*)::int n from public.raxi_audit_events where action='SUPERVISED_CAMPAIGN_REQUESTED'")).rows[0].n;
    for (const token of ['anonymous', 'expired', 'other', 'invalid']) {
      assert.ok((await handlers.preflight(request(input, token))).status >= 400);
    }
    assert.ok((await handlers.preflight(request({ ...input, workspaceId: otherWorkspace }))).status >= 400);
    assert.equal((await handlers.preflight(request({ ...input, workspaceId: otherWorkspace, expectedCampaignVersion: 0 }, 'other'))).status, 422);
    const preflight = await handlers.preflight(request(input));
    assert.equal(preflight.status, 200, await preflight.clone().text());
    const { snapshotHash } = await preflight.json();
    assert.match(snapshotHash, /^[a-f0-9]{64}$/);
    assert.equal(await count(), 0);
    const command = { ...input, snapshotHash };
    assert.equal((await handlers.submit(request({ ...command, snapshotHash: '0'.repeat(64) }))).status, 409);
    // Exercise the database boundary directly, bypassing the editorial evaluator.
    let captured: Record<string, unknown> = {};
    beforeCommit = async args => {
      beforeCommit = undefined;
      captured = structuredClone(args);
      throw Error('synthetic failure before SQL');
    };
    assert.equal((await handlers.submit(request(command))).status, 503);
    const evidence = captured.p_evidence as Record<string, unknown>;
    const direct = (candidate: unknown = command, proof: unknown = evidence, expected: unknown = captured.p_expected) =>
      db.query<{ v: { status: string } }>('select public.raxi_supervised_campaign_request_commit($1,$2,$3,$4) v',
        [identity(), candidate, expected, proof].map(value => JSON.stringify(value)));
    const hasCode = (code: string) => (error: unknown) =>
      !!error && typeof error === 'object' && 'code' in error && error.code === code;
    for (const proof of [
      { ...evidence, approvalReceipt: initial.receipts[0] },
      { ...evidence, approvalEvent: initial.session.audit[0] },
      { ...evidence, approvalEvent: null },
    ]) await assert.rejects(direct(command, proof), hasCode('23514'));
    await assert.rejects(direct({ ...command, deliverableId: 'STRATEGY-ITEM-999' }), hasCode('23514'));
    await assert.rejects(direct({ ...command, purpose: 'RUN_PROVIDER' }), hasCode('22023'));
    await assert.rejects(direct({ ...command, approved: true }), hasCode('22023'));
    // Even the trusted service-role RPC must refuse oversized data without a write.
    await assert.rejects(direct(command, { ...evidence, padding: 'x'.repeat(262144) }), hasCode('22023'));
    await assert.rejects(db.exec('truncate table public.raxi_audit_events'), hasCode('42501'));
    assert.equal(await count(), 0);
    await db.exec('begin isolation level repeatable read');
    try { await assert.rejects(direct(), hasCode('25001')); }
    finally { await db.exec('rollback'); }
    await db.exec('begin');
    try {
      assert.equal((await direct()).rows[0].v.status, 'REQUESTED');
      assert.equal(await count(), 1);
    } finally { await db.exec('rollback'); }
    assert.equal(await count(), 0);
    beforeCommit = async () => {
      beforeCommit = undefined;
      await db.exec('reset role');
      await db.query('delete from auth.sessions where id=$1', [sessionId]);
      await db.exec('set role service_role');
    };
    assert.equal((await handlers.submit(request(command))).status, 403);
    assert.equal(await count(), 0);
    await db.exec('reset role');
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sessionId, owner]);
    await db.exec('set role service_role');
    lose = true;
    let waiting = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    beforeCommit = async () => {
      if (++waiting === 2) release();
      await barrier;
    };
    const concurrent = await Promise.all([handlers, mount()].map(async h => (await h.submit(request(command))).json()));
    assert.deepEqual(concurrent, Array(2).fill({ status: 'UNKNOWN', reason: 'CONFIRMATION_UNAVAILABLE' }));
    assert.equal(waiting, 2);
    beforeCommit = undefined;
    assert.equal(await count(), 1);
    assert.ok((await db.query<{ bytes: number }>("select octet_length((details->'evidence')::text) bytes from public.raxi_audit_events where action='SUPERVISED_CAMPAIGN_REQUESTED'")).rows[0].bytes > 65536);
    assert.ok((await db.query<{ bytes: number }>("select octet_length(details::text) bytes from public.raxi_audit_events where action='SUPERVISED_CAMPAIGN_REQUESTED'")).rows[0].bytes <= 262144);
    lose = false;
    const recovered = await mount().submit(request(command));
    assert.equal(recovered.status, 200, await recovered.clone().text());
    const receipt = await recovered.json();
    assert.equal(receipt.status, 'REQUESTED');
    assert.equal(receipt.actorId, owner);
    assert.equal(receipt.authorization, 'PENDING_HUMAN_EXECUTION_AUTH');
    assert.deepEqual(receipt.command, command);
    assert.equal(Object.hasOwn(receipt, 'evidence'), false);
    corruptReceipt = true;
    assert.equal((await handlers.submit(request(command))).status, 503);
    corruptReceipt = false;
    assert.deepEqual(await Promise.all([handlers, mount()].map(async h => (await h.submit(request(command))).json())), [receipt, receipt]);
    const newKey = { ...input, requestKey: crypto.randomUUID() };
    const second = await (await handlers.preflight(request(newKey))).json();
    assert.deepEqual(await (await handlers.submit(request({ ...newKey, snapshotHash: second.snapshotHash }))).json(), { status: 'CONFLICT' });
    assert.deepEqual(await (await handlers.submit(request({ ...command, snapshotHash: '1'.repeat(64) }))).json(), { status: 'CONFLICT' });

    const racingKey = { ...input, requestKey: crypto.randomUUID() };
    const racing = await (await handlers.preflight(request(racingKey))).json();
    beforeCommit = async () => {
      beforeCommit = undefined;
      await run({ type: 'START_STRATEGY_REVISION', campaignId: campaign.id, revision: 1, confirmed: true, reason: 'Synthetic revision' });
    };
    assert.equal((await handlers.submit(request({ ...racingKey, snapshotHash: racing.snapshotHash }))).status, 409);
    const { serverTime: _serverTime, ...superseded } = await read();
    assert.equal((await handlers.preflight(request({ ...racingKey, expectedCampaignVersion: superseded.version }))).status, 422);
    await assert.rejects(direct({ ...command, requestKey: crypto.randomUUID(), deliverableId: 'STRATEGY-ITEM-002',
      expectedCampaignVersion: superseded.version }, evidence, superseded), hasCode('23514'));
    assert.deepEqual(await (await handlers.submit(request(command))).json(), receipt);
    assert.equal(await count(), 1);
    assert.ok((await db.query<{ bytes: number }>("select octet_length((details->'evidence')::text) bytes from public.raxi_audit_events where action='SUPERVISED_CAMPAIGN_REQUESTED'")).rows[0].bytes > 65536);
    for (const table of ['raxi_agent_tasks', 'raxi_agent_events', 'raxi_assets', 'raxi_production_jobs', 'raxi_publication_plans']) {
      assert.equal((await db.query<{ n: number }>(`select count(*)::int n from public.${table}`)).rows[0].n, 0);
    }
    await assert.rejects(db.exec("update public.raxi_audit_events set details='{}' where action='SUPERVISED_CAMPAIGN_REQUESTED'"));
    await assert.rejects(db.exec("delete from public.raxi_audit_events where action='SUPERVISED_CAMPAIGN_REQUESTED'"));
    await db.exec('reset role');
    await db.query('delete from auth.sessions where id=$1', [sessionId]);
    await db.exec('set role service_role');
    assert.ok((await mount().submit(request(command))).status >= 400);
    assert.ok((await mount().submit(request(command, 'other'))).status >= 400);
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other })]);
    assert.equal(await count(), 0);
    await assert.rejects(db.query('select public.raxi_supervised_campaign_request_replay($1,$2)', [JSON.stringify(identity()), JSON.stringify(command)]));
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select public.raxi_supervised_campaign_request_commit($1,$2,$3,$4)', [JSON.stringify(identity()), JSON.stringify(command), '{}', '{}']));
  } finally { await db.close(); }
});
