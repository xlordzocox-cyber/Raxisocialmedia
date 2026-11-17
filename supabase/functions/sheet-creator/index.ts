import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createSheetHandler } from './handler.ts';
import { makeCreatorDeps } from './deps.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
// Service credential exists only in the managed Edge runtime. It is never returned or logged.
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(createSheetHandler(makeCreatorDeps(auth, server)));
