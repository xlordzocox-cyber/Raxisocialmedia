import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const workspace = '59000000-0000-4000-8000-000000000001';
const actor = '59000000-0000-4000-8000-000000000002';
const session = '59000000-0000-4000-8000-000000000003';
const ref = 'zvhxjindgyvtasstfjut';
const identity = () => ({
  provenance: 'SUPABASE_AUTH_STAGING',
  actorId: actor, sessionId: session, workspaceId: workspace,
  projectRef: ref, expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const denied = (err: unknown) => !!err && typeof err === 'object' && 'code' in err && err.code === '42501';

test('minimal staging-only identity RPC checks project, live session, ownership and revoked session', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
      create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id), not_after timestamptz);
      create table public.raxi_workspaces (id uuid primary key, owner_user_id uuid not null);
      grant usage on schema public to service_role;
      grant select on public.raxi_workspaces to service_role;
    `);
    await db.exec(readFileSync('../../supabase/proposals/supervised_campaign_staging_identity.sql','utf8'));
    await db.query('insert into auth.users(id,is_anonymous) values($1,false)', [actor]);
    await db.query('insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval \'2 minutes\')', [session,actor]);
    await db.query('insert into public.raxi_workspaces(id,owner_user_id) values($1,$2)', [workspace,actor]);
    const call = async (value: unknown) =>
      db.query<{v:boolean}>('select public.raxi_supervised_host_identity($1) v',[JSON.stringify(value)]);
    await db.exec('set role service_role');
    assert.equal((await call(identity())).rows[0].v,true);
    await assert.rejects(call({ ...identity(), projectRef:'jrkefsylpfriiqefcmzq' }),denied);
    await assert.rejects(call({ ...identity(), expiresAt:'2020-01-01T00:00:00Z' }),denied);
    await assert.rejects(call({ ...identity(), sessionId:'59000000-0000-4000-8000-000000000099' }),denied);
    await assert.rejects(call({ ...identity(), workspaceId:'59000000-0000-4000-8000-000000000099' }),denied);
    await assert.rejects(call({ ...identity(), actorId:'59000000-0000-4000-8000-000000000099' }),denied);
    await assert.rejects(call({ ...identity(), actorId:'injected' }),denied);
    await assert.rejects(call({ ...identity(), extra:true }),denied);
    await db.exec('set role authenticated');
    await assert.rejects(call(identity()),denied);
    await db.exec('set role anon');
    await assert.rejects(call(identity()),denied);
    await db.exec('reset role');
    await db.query('delete from auth.sessions where id=$1',[session]);
    await db.exec('set role service_role');
    await assert.rejects(call(identity()),denied);
  } finally { await db.close(); }
});
