import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
export async function campaignDatabase(includeCampaignProposal = true, dataDir?: string) {
  const db = new PGlite(dataDir);
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
  `);
  await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
  `);
  // This PGlite campaign fixture does not install the separately hosted
  // PR59/Issue60 runtime dependencies. The Director REAL gate migration was
  // applied AFTER those dependencies on staging and must be replayed only by
  // the native isolated PG17 workflow that reconstructs them in proper order.
  // Do NOT silently exclude any other versioned migrations here.
  const stagedRuntimeOnly = '20261115040235_raxi_hq_issue49_director_real_gate_schema_only.sql';
  // Post-freeze product migrations (Claude-led v2): the Fototeca migration depends on
  // Supabase Storage policies and pg_net (absent in PGlite), and both change the schema
  // frozen by the earlier B2 staging-preparation digest. They are verified against
  // raxi-hq-staging directly. Listed explicitly so nothing else is skipped silently.
  const postFreezeProduct = new Set([
    '20261115083451_raxi_hq_fototeca_v1.sql',
    '20261115154028_raxi_hq_team_proposals.sql',
    '20261115170000_raxi_hq_agent_jobs.sql',
    '20261115172000_raxi_hq_director_review.sql',
    '20261115180000_raxi_hq_campaign_pipeline.sql',
    '20261115190000_raxi_hq_pipeline_savings.sql',
    '20261115200000_raxi_hq_copy_qa_publish.sql',
    '20261115210000_raxi_hq_production_archive.sql',
    '20261115211000_raxi_hq_generate_loop.sql',
    '20261115220000_raxi_hq_photo_redo.sql',
    '20261115230000_raxi_hq_character_fixed_prompt.sql',
    // Conexiones v1 depends on Supabase Vault (absent in PGlite); its grants are covered by connections.test.tsx.
    '20261117000000_raxi_hq_provider_connections.sql',
    // Talento v1 depends on raxi_character_profiles (post-freeze product schema); covered by talent.test.tsx.
    '20261117100000_raxi_hq_talent_identity.sql',
    // Creador de ficha 360 (M2): post-freeze product schema; its cap and grants are covered by sheetCreator.test.ts with its own PGlite.
    '20261118000000_raxi_hq_sheet_creator.sql',
    '20261118010000_raxi_hq_reference_supersede.sql',
    '20261118020000_raxi_hq_identity_general_only.sql',
    // Series de continuidad (M3): depends on the post-freeze portfolio and identity schema; covered by series.test.ts.
    '20261118030000_raxi_hq_continuity_series.sql',
    '20261118040000_raxi_hq_recreate.sql',
    '20261118050000_raxi_hq_recreate_fanvue.sql',
    '20261118060000_raxi_hq_model_test.sql',
    '20261118070000_raxi_hq_disable_flux_pulid.sql',
  ]);
  for (const file of readdirSync('../../supabase/migrations').filter(f =>
    f.endsWith('.sql') && f !== stagedRuntimeOnly && !postFreezeProduct.has(f) &&
    (includeCampaignProposal || !f.includes('campaign_strategy_pending_review'))
  ).sort()) await db.exec(readFileSync(`../../supabase/migrations/${file}`, 'utf8'));
  return db;
}
