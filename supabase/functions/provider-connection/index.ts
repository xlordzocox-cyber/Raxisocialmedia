import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createConnectionHandler, type KeyCheck } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
// Service credential exists only in the managed Edge runtime. It is never returned or logged.
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

// Verified 2026-11-16: https://wavespeed.ai/docs/check-balance documents /account/balance;
// https://wavespeed.ai/docs/docs-common-api/balance documents /balance. Try the first, fall back on 404.
const BALANCE_URLS = ['https://api.wavespeed.ai/api/v3/account/balance', 'https://api.wavespeed.ai/api/v3/balance'];

async function checkWaveSpeed(key: string): Promise<KeyCheck> {
  for (const endpoint of BALANCE_URLS) {
    let res: Response;
    try { res = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }); }
    catch { return 'UNAVAILABLE'; }
    await res.body?.cancel();
    if (res.ok) return 'VALID';
    if (res.status === 401 || res.status === 403) return 'REJECTED';
    if (res.status !== 404) return 'UNAVAILABLE';
  }
  return 'UNAVAILABLE';
}

Deno.serve(createConnectionHandler({
  async verifyUser(token) { const { data, error } = await auth.auth.getUser(token); return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true }; },
  async checkKey(_provider, key) { return checkWaveSpeed(key); },
  async store(actor, provider, key) { const { data, error } = await server.rpc('raxi_connection_store', { p_actor: actor, p_provider: provider, p_secret: key }); if (error || !data) throw new Error('store failed'); return data; },
  async readKey(actor, provider) { const { data, error } = await server.rpc('raxi_connection_secret', { p_actor: actor, p_provider: provider }); if (error) throw new Error('read failed'); return typeof data === 'string' && data ? data : null; },
  async mark(actor, provider, status) { const { error } = await server.rpc('raxi_connection_mark', { p_actor: actor, p_provider: provider, p_status: status }); if (error) throw new Error('mark failed'); },
  async remove(actor, provider) { const { data, error } = await server.rpc('raxi_connection_remove', { p_actor: actor, p_provider: provider }); if (error || !data) throw new Error('remove failed'); return data; },
}));
