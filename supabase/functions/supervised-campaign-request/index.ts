import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { supervisedCampaignRequests, supabaseSupervisedAuth } from '../_shared/supervised-campaign-domain.js';
import { createSupervisedCampaignEdgeHandler } from './handler.ts';

// Pin the staging project independently of client-supplied workspace/host values.
// NO connection to the production project and no provider/agent execution imports.
const stagingProjectRef = 'zvhxjindgyvtasstfjut';
const stagingUrl = 'https://' + stagingProjectRef + '.supabase.co';
if (Deno.env.get('SUPABASE_URL') !== stagingUrl) throw Error('Staging project mismatch');

const enabled = Deno.env.get('RAXI_SUPERVISED_REQUESTS_ENABLED') === 'true';
const allowedOrigins = (Deno.env.get('RAXI_SUPERVISED_ALLOWED_ORIGINS') ?? '')
  .split(',').map(value => value.trim()).filter(Boolean);

let handlers: ReturnType<typeof supervisedCampaignRequests> | null = null;
if (enabled) {
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!anonKey || !serviceKey || allowedOrigins.length === 0) {
    throw Error('Staging auth and explicit allowed origins required');
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const auth = createClient(stagingUrl, anonKey, options);
  const server = createClient(stagingUrl, serviceKey, options);
  const verify = supabaseSupervisedAuth({
    projectRef: stagingProjectRef,
    auth: auth.auth,
    server,
  });
  handlers = supervisedCampaignRequests({
    projectRef: stagingProjectRef,
    verify,
    server,
  });
}
Deno.serve(createSupervisedCampaignEdgeHandler({ enabled, allowedOrigins, handlers }));
