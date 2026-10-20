import { createClient } from '@supabase/supabase-js';
import { readAuthConfig } from './config';

const config = readAuthConfig(import.meta.env);
export const supabase = config ? createClient(config.url, config.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;
