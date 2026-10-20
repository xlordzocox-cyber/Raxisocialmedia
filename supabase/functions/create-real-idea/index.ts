import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createIdeaHandler } from './handler.ts';
import { RequestError } from '../_shared/ideaCommand.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonymousKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const auth = createClient(url, anonymousKey, { auth: { persistSession: false, autoRefreshToken: false } });
// This credential exists only in the managed Edge runtime. It is never returned or logged.
const writer = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(createIdeaHandler({
  async verifyUser(token) {
    const { data, error } = await auth.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
  },
  async commit(userId, command) {
    const { data, error } = await writer.rpc('raxi_create_manual_idea', { p_actor: userId, p_command: command });
    if (error) {
      if (error.code === '42501') throw new RequestError(403, 'No tienes acceso a este workspace.');
      if (error.code === '23505' || error.code === '40001') throw new RequestError(409, 'La operación o el ID ya existe con otro contenido.');
      if (error.code === '22023' || error.code === '23514') throw new RequestError(400, 'La idea o su estado no son válidos.');
      throw new RequestError(503, 'PostgreSQL no confirmó el guardado. Reintenta la misma operación.');
    }
    if (!data) throw new RequestError(503, 'Falta la confirmación canónica de PostgreSQL.');
    return data;
  },
}));
