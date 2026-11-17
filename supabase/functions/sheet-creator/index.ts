import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createSheetHandler, type RunRow, type TakeRow } from './handler.ts';
import { createWaveSpeed } from './wavespeed.ts';
import type { Price } from './sheetPlan.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
// Service credential exists only in the managed Edge runtime. It is never returned or logged.
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = 'raxi-hq-private';
const wavespeed = createWaveSpeed(fetch);
const mills = (v: unknown) => Math.round(Number(v) * 1000);
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const capError = (e: { message?: string } | null) => (e?.message ?? '').includes('monthly cap') ? Object.assign(new Error('cap'), { cap: true }) : new Error('db');
const MAX_OUTPUT = 30 * 1024 * 1024;

Deno.serve(createSheetHandler({
  async verifyUser(token) { const { data, error } = await auth.auth.getUser(token); return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true }; },
  async workspaceOf(userId) {
    const { data, error } = await server.from('raxi_workspaces').select('id').eq('owner_user_id', userId).eq('slug', 'raxi-hq').maybeSingle();
    if (error) throw new Error('workspace');
    return (data?.id as string | undefined) ?? null;
  },
  async price(model) {
    const { data, error } = await server.from('raxi_provider_prices').select('*').eq('model', model).maybeSingle();
    if (error) throw new Error('price');
    if (!data) return null;
    const p: Price = { model: data.model, enabled: data.enabled === true, out: { '1k': mills(data.out_1k), '1.5k': mills(data.out_15k), '2k': mills(data.out_2k) }, perInput: mills(data.per_input) };
    return p;
  },
  async fixedPrompt(ws, character) {
    const { data } = await server.from('raxi_character_profiles').select('fixed_prompt').eq('workspace_id', ws).eq('character_id', character).maybeSingle();
    return typeof data?.fixed_prompt === 'string' && data.fixed_prompt.trim() ? data.fixed_prompt : null;
  },
  async sourceAssets(ws, character, ids) {
    const { data, error } = await server.from('raxi_assets').select('id,object_path,kind,metadata').eq('workspace_id', ws).in('id', ids);
    if (error) throw new Error('sources');
    const ok = (data ?? []).filter((a) => a.kind === 'REFERENCE' && a.metadata?.character_id === character && a.metadata?.content_level === 'PUBLIC');
    if (ok.length !== new Set(ids).size) return null;
    return ids.map((id) => { const a = ok.find((x) => x.id === id)!; return { id, objectPath: a.object_path as string }; });
  },
  async generalAnchors(ws, character) {
    const { data, error } = await server.from('raxi_assets').select('id,object_path,metadata,created_at').eq('workspace_id', ws).eq('kind', 'REFERENCE')
      .eq('metadata->>character_id', character).eq('metadata->>content_level', 'PUBLIC').in('metadata->>angle', ['FRONT', 'BODY_FRONT']).is('metadata->>superseded_by', null).order('created_at', { ascending: false });
    if (error) throw new Error('anchors');
    const out: Partial<Record<'FRONT' | 'BODY_FRONT', { id: string; objectPath: string }>> = {};
    for (const a of data ?? []) { const k = a.metadata?.angle as 'FRONT' | 'BODY_FRONT'; if (!out[k]) out[k] = { id: a.id, objectPath: a.object_path }; }
    return out;
  },
  async monthSpendMills(actor) {
    const { data, error } = await server.rpc('raxi_sheet_month_spend', { p_actor: actor });
    if (error) throw new Error('spend');
    return Number(data ?? 0);
  },
  async createRun(actor, run, takes) {
    const { error } = await server.rpc('raxi_sheet_create_run', { p_actor: actor, p_run: run, p_takes: takes });
    if (error) throw capError(error);
  },
  async addTake(actor, take) {
    const { error } = await server.rpc('raxi_sheet_add_take', { p_actor: actor, p_take: take });
    if (error) throw capError(error);
  },
  async latestRun(ws, character, level) {
    const { data } = await server.from('raxi_sheet_runs').select('id').eq('workspace_id', ws).eq('character_id', character).eq('level', level).order('created_at', { ascending: false }).limit(1);
    return (data?.[0]?.id as string | undefined) ?? null;
  },
  async loadRun(ws, runId) {
    const { data: run, error } = await server.from('raxi_sheet_runs').select('*').eq('workspace_id', ws).eq('id', runId).maybeSingle();
    if (error) throw new Error('run');
    if (!run) return null;
    const { data: takes, error: e2 } = await server.from('raxi_sheet_takes').select('*').eq('workspace_id', ws).eq('run_id', runId);
    if (e2) throw new Error('takes');
    return { run: run as RunRow, takes: (takes ?? []) as TakeRow[] };
  },
  async loadTake(ws, takeId) {
    const { data } = await server.from('raxi_sheet_takes').select('*').eq('workspace_id', ws).eq('id', takeId).maybeSingle();
    return (data as TakeRow | null) ?? null;
  },
  async updateTake(takeId, patch) {
    const { error } = await server.from('raxi_sheet_takes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', takeId);
    if (error) throw new Error('update');
  },
  async claimTake(takeId) {
    const { data, error } = await server.from('raxi_sheet_takes').update({ status: 'PENDING', updated_at: new Date().toISOString() }).eq('id', takeId).eq('status', 'QUEUED').select('id');
    if (error) throw new Error('claim');
    return (data ?? []).length === 1;
  },
  async signedUrl(path) {
    const { data, error } = await server.storage.from(BUCKET).createSignedUrl(path, 15 * 60);
    if (error || !data?.signedUrl) throw new Error('sign');
    return data.signedUrl;
  },
  async secret(actor) {
    const { data, error } = await server.rpc('raxi_connection_secret', { p_actor: actor, p_provider: 'WAVESPEED' });
    if (error) throw new Error('secret');
    return typeof data === 'string' && data ? data : null;
  },
  submit: (key, model, body) => wavespeed.submit(key, model, body),
  poll: (key, id) => wavespeed.poll(key, id),
  async storeOutput(outputUrl, path) {
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error('download');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_OUTPUT) throw new Error('size');
    const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : null;
    if (!mime) throw new Error('type');
    const { error } = await server.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (error) throw new Error('upload');
    return { path, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)), byteSize: bytes.length, mime };
  },
  async registerReference(row) {
    const { error } = await server.from('raxi_assets').insert({ ...row, bucket_id: BUCKET });
    if (error) throw new Error('register');
  },
  async supersede(ws, character, angle, level, keepId) {
    const { error } = await server.rpc('raxi_reference_supersede', { p_ws: ws, p_character: character, p_angle: angle, p_level: level, p_keep: keepId });
    if (error) throw new Error('supersede');
  },
  newId: () => crypto.randomUUID(),
}));
