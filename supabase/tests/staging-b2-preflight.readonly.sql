-- Raxi HQ staging B2 preflight: catalog-only, read-only.
-- Run ONLY after independently verifying project ref zvhxjindgyvtasstfjut.
-- No tables are read for rows; no DDL/DML, transactions, users, seeds or provider calls.
-- A passing result is NOT permission to apply migrations or run B2.
WITH checks AS (
 SELECT 'postgres_major_17' name,
   current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 ok
 UNION ALL SELECT 'auth_schema',to_regnamespace('auth') IS NOT NULL
 UNION ALL SELECT 'storage_schema',to_regnamespace('storage') IS NOT NULL
 UNION ALL SELECT 'public_no_raxi_tables',
   NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
   AND starts_with(c.relname,'raxi_'))
 UNION ALL SELECT 'auth_uid_uuid',
   EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='auth' AND p.proname='uid' AND p.pronargs=0
           AND p.prorettype='uuid'::regtype)
 UNION ALL SELECT 'auth_jwt_jsonb',
   EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='auth' AND p.proname='jwt' AND p.pronargs=0
           AND p.prorettype='jsonb'::regtype)
 UNION ALL SELECT 'auth_users_columns',
   (SELECT count(*)=2 FROM information_schema.columns
     WHERE table_schema='auth' AND table_name='users'
     AND ((column_name='id' AND data_type='uuid') OR
          (column_name='is_anonymous' AND data_type='boolean')))
 UNION ALL SELECT 'auth_sessions_columns',
   (SELECT count(*)=3 FROM information_schema.columns
     WHERE table_schema='auth' AND table_name='sessions'
     AND ((column_name='id' AND data_type='uuid') OR
          (column_name='user_id' AND data_type='uuid') OR
          (column_name='not_after' AND data_type='timestamp with time zone')))
 UNION ALL SELECT 'anon_no_bypassrls',
   EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon' AND NOT rolbypassrls)
 UNION ALL SELECT 'authenticated_no_bypassrls',
   EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolbypassrls)
 UNION ALL SELECT 'service_role_bypassrls',
   EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls)
 UNION ALL SELECT 'service_role_select_auth_sessions_required_columns',
   EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
   AND has_schema_privilege('service_role','auth','USAGE')
   AND has_column_privilege('service_role','auth.sessions','id','SELECT')
   AND has_column_privilege('service_role','auth.sessions','user_id','SELECT')
   AND has_column_privilege('service_role','auth.sessions','not_after','SELECT')
 UNION ALL SELECT 'service_role_select_auth_users_required_columns',
   EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
   AND has_schema_privilege('service_role','auth','USAGE')
   AND has_column_privilege('service_role','auth.users','id','SELECT')
   AND has_column_privilege('service_role','auth.users','is_anonymous','SELECT')
)
SELECT name,CASE WHEN ok THEN 'PASS' ELSE 'BLOCK' END status
FROM checks ORDER BY name;
