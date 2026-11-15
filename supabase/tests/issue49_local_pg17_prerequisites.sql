-- Issue #49: OFFLINE SCHEMA COMPATIBILITY FIXTURE ONLY.
-- This is NOT the Supabase Auth or Storage implementation and cannot certify auth security/RLS.
-- Requires an isolated, disposable PostgreSQL 17 DB created specifically for this lab.
-- DO NOT EXECUTE on Supabase, production, staging, a shared database or existing data.
-- Intentionally does NOT create user rows, fake session grants or fake policies.

DO $$
BEGIN
  IF current_database() <> 'raxi_campaign_qa' THEN
    RAISE EXCEPTION 'LAB_ONLY: unexpected database %', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('auth','storage')) THEN
    RAISE EXCEPTION 'LAB_ONLY: auth/storage schemas already exist; refusing to overwrite';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'raxi_%') THEN
    RAISE EXCEPTION 'LAB_ONLY: Raxi schema already exists; refusing to overwrite';
  END IF;
END $$;

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END $$;

CREATE SCHEMA auth;
CREATE SCHEMA storage;

CREATE TABLE auth.users (
 id uuid PRIMARY KEY,
 is_anonymous boolean NOT NULL DEFAULT false
);

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

CREATE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;

CREATE TABLE storage.buckets (
 id text PRIMARY KEY,
 name text NOT NULL,
 public boolean NOT NULL DEFAULT false,
 file_size_limit bigint,
 allowed_mime_types text[]
);
CREATE TABLE storage.objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 bucket_id text REFERENCES storage.buckets(id),
 name text NOT NULL
);

GRANT USAGE ON SCHEMA public, auth, storage TO authenticated;
GRANT USAGE ON SCHEMA public TO anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated,anon;
GRANT SELECT ON auth.users TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'LAB_ONLY: schema-compatibility auth/storage STUBS installed. NOT Supabase Auth, NOT real RLS verification.';
END $$;
