import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createCampaignHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createCampaignHandler({
  async verifyUser(token) { const { data, error } = await auth.auth.getUser(token); return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true }; },
  async read(ownerId, workspaceId) { const { data, error } = await server.rpc('raxi_campaign_snapshot', { p_workspace: workspaceId, p_actor: ownerId }); if (error) throw new Error('Read denied'); return data; },
  async commit(ownerId, command, next) { const { data, error } = await server.rpc('raxi_campaign_commit', { p_actor: ownerId, p_command: command, p_next: next }); if (error) throw new Error('Commit not confirmed'); return data; },
}));
