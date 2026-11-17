import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createReferenceHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
// Service credential exists only in the managed Edge runtime. It is never returned or logged.
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = 'raxi-hq-private';
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve(createReferenceHandler({
  async verifyUser(token) { const { data, error } = await auth.auth.getUser(token); return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true }; },
  async workspaceOf(userId) {
    const { data, error } = await server.from('raxi_workspaces').select('id').eq('owner_user_id', userId).eq('slug', 'raxi-hq').maybeSingle();
    if (error) throw new Error('workspace');
    return (data?.id as string | undefined) ?? null;
  },
  async findBySha(workspaceId, sha256) {
    const { data, error } = await server.from('raxi_assets').select('id,kind,metadata').eq('workspace_id', workspaceId).eq('sha256', sha256).order('kind', { ascending: false }).limit(1); // REFERENCE before ORIGINAL
    if (error) throw new Error('lookup');
    const row = data?.[0] as { id: string; kind: string; metadata: Record<string, unknown> } | undefined;
    return row ? { id: row.id, kind: row.kind, characterId: typeof row.metadata?.character_id === 'string' ? row.metadata.character_id : null } : null;
  },
  async upload(path, bytes, mime) { const { error } = await server.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false }); if (error) throw new Error('upload'); },
  async register(row) { const { error } = await server.from('raxi_assets').insert({ ...row, bucket_id: BUCKET }); if (error) throw new Error('register'); },
  async removeObject(path) { await server.storage.from(BUCKET).remove([path]); },
  async supersede(workspaceId, character, angle, level, keepId) {
    const { error } = await server.rpc('raxi_reference_supersede', { p_ws: workspaceId, p_character: character, p_angle: angle, p_level: level, p_keep: keepId });
    if (error) throw new Error('supersede');
  },
  newId: () => crypto.randomUUID(),
  async sha256(bytes) { return hex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))); },
}));
