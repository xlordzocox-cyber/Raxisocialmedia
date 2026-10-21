import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagingTarget } from '../scripts/staging-target.mjs';
const ref='abcdefghijklmnopqrst';
const env={RAXI_STAGING_REF:ref,RAXI_STAGING_URL:`https://${ref}.supabase.co`,RAXI_STAGING_DATABASE_URL:`postgresql://postgres:fixture-only@db.${ref}.supabase.co:5432/postgres`,RAXI_STAGING_ACK:'RUN_ISOLATED_STAGING_ACCEPTANCE'};
test('staging guard rejects production, mismatched endpoints, poolers and missing consent before connecting',()=>{
 assert.equal(stagingTarget(env).ref,ref);
 for(const patch of [{RAXI_STAGING_REF:'jrkefsylpfriiqefcmzq'},{RAXI_STAGING_URL:'https://jrkefsylpfriiqefcmzq.supabase.co'},{RAXI_STAGING_DATABASE_URL:'postgresql://postgres:fixture-only@pooler.supabase.com:5432/postgres'},{RAXI_STAGING_ACK:''},{RAXI_STAGING_DATABASE_URL:`postgresql://postgres:fixture-only@db.${ref}.supabase.co:5432/postgres?host=evil.example`}]) assert.throws(()=>stagingTarget({...env,...patch}));
});
