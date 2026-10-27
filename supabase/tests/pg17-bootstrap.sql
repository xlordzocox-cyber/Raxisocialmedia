-- LOCAL SYNTHETIC FIXTURE ONLY. Not Supabase Auth/Storage implementations.
-- The native runner checks an empty dedicated database before this transaction.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
