-- Issue #49: read-only catalog preflight for campaign/runtime migrations.
-- This file does not change schema, grants, RLS or application data.
-- Run only with an authorized read-only connection; results contain metadata only.
-- Do NOT interpret row existence or RLS enabled as proof of tenant isolation.

-- 1. Migration versions currently registered (no user data).
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- 2. Public Raxi RPC signatures, invoker/definer and frontend EXECUTE capability.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'raxi_%'
ORDER BY 1,2;

-- 3. Presence only: required columns and their types.
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND (c.table_name='raxi_workspaces' AND c.column_name IN ('id','owner_user_id','campaign_version')
    OR c.table_name='raxi_campaigns' AND c.column_name IN ('workspace_id','source_idea_id','provenance')
    OR c.table_name='raxi_agent_tasks' AND c.column_name IN ('workspace_id','input_snapshot')
    OR c.table_name='raxi_agent_events' AND c.column_name IN ('workspace_id','source_ref'))
ORDER BY c.table_name,c.column_name;

-- 4. RLS flags and policy counts (not a security proof).
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls, COUNT(p.oid) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid=c.oid
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'raxi_%'
GROUP BY c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;

-- 5. Constraints used by the campaigns migration and prior PG17 attestation.
SELECT c.conname, c.contype, c.conrelid::regclass AS relation,
       pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint c
JOIN pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname='public'
 AND c.conname IN ('raxi_campaigns_provenance_check','raxi_workspaces_slug_check')
ORDER BY c.conname;

-- 6. Index and trigger names likely to conflict with candidate migration.
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname='public' AND indexname LIKE 'raxi_%'
  AND (indexname LIKE '%campaign%' OR indexname LIKE '%strategy%' OR indexname LIKE '%approval%')
ORDER BY indexname;

SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname LIKE 'raxi_%'
ORDER BY c.relname,t.tgname;
