-- Issue #49 / PR #50. NEGATIVE isolated PG17 campaign permissions.
-- OFFLINE ONLY. Do not run on Supabase staging/production or shared databases.
-- Requires the four v0.9 baseline migrations, local fake Auth/Storage prerequisites
-- and pending campaign strategy migration already applied to raxi_campaign_qa.
-- All inserted accounts/workspaces/campaigns are synthetic and ROLLED BACK.
-- This tests PostgreSQL RLS/GRANT behavior with local CLAIM STUBS, NOT Supabase JWT validation.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database() IS DISTINCT FROM 'raxi_campaign_qa' THEN
   RAISE EXCEPTION 'LAB_ONLY: wrong database';
 END IF;
 IF (SELECT count(*) FROM public.raxi_workspaces)<>0 THEN
   RAISE EXCEPTION 'LAB_ONLY: workspaces already present; do not overwrite';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='raxi_campaign_snapshot'
 ) THEN RAISE EXCEPTION 'LAB_ONLY: campaign migration missing'; END IF;
 IF has_function_privilege('anon','public.raxi_campaign_snapshot(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'FAIL SEC-01: anon can execute campaign snapshot';
 END IF;
 IF has_function_privilege('anon','public.raxi_campaign_commit(uuid,jsonb,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'FAIL SEC-01: anon can execute campaign commit';
 END IF;
 IF has_function_privilege('authenticated','public.raxi_campaign_commit(uuid,jsonb,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'FAIL SEC-03: authenticated can execute privileged commit';
 END IF;
 IF NOT has_function_privilege('authenticated','public.raxi_campaign_snapshot(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'FAIL SEC-02: authenticated cannot execute snapshot';
 END IF;
 RAISE NOTICE 'PASS GRANTS: anon denied; authenticated read-only RPC; commit service-only';
END $guard$;

-- Names and identities below are TEST FIXTURES, not actual user accounts.
INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','qa-owner-a','QA Owner A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','qa-owner-b','QA Owner B');

-- Tenant B data to demonstrate that RLS on child tables also filters correctly.
INSERT INTO public.raxi_ideas(id,workspace_id,external_id,kind,title,status,source,payload)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','IDEA-REAL-B','PROPOSAL','Synthetic B idea','SENT_TO_HQ','MANUAL_LUIS','{"id":"IDEA-REAL-B"}'::jsonb);
INSERT INTO public.raxi_campaigns(id,workspace_id,external_id,source_idea_id,title,status,provenance,payload)
VALUES ('bbbbbbbb-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CAMPAIGN-B','bbbbbbbb-0000-4000-8000-000000000001','Synthetic B campaign','DRAFT','REAL','{"id":"CAMPAIGN-B"}'::jsonb);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","is_anonymous":false}',true);

DO $test$
DECLARE
 snap jsonb;
 errcode text;
BEGIN
 IF (SELECT count(*) FROM public.raxi_workspaces)<>1 THEN
   RAISE EXCEPTION 'FAIL SEC-02: workspace RLS visible count is wrong';
 END IF;
 IF (SELECT count(*) FROM public.raxi_campaigns)<>0 THEN
   RAISE EXCEPTION 'FAIL SEC-02: foreign campaign leaked via table RLS';
 END IF;
 snap:=public.raxi_campaign_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,'22222222-2222-4222-8222-222222222222'::uuid);
 IF snap->>'ownerId' IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'
    OR snap->>'workspaceId' IS DISTINCT FROM 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' THEN
   RAISE EXCEPTION 'FAIL SEC-02: forged p_actor influenced caller ownership';
 END IF;
 RAISE NOTICE 'PASS SEC-02: tenant A sees only own workspace; forged p_actor ignored';

 BEGIN
   PERFORM public.raxi_campaign_snapshot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
                                         '22222222-2222-4222-8222-222222222222'::uuid);
   RAISE EXCEPTION 'FAIL SEC-02: cross-tenant snapshot succeeded';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS errcode=RETURNED_SQLSTATE;
   IF errcode<>'42501' THEN
     RAISE EXCEPTION 'FAIL SEC-02: expected 42501, got %',errcode;
   END IF;
 END;
 RAISE NOTICE 'PASS SEC-02: foreign workspace snapshot denied (42501)';
END $test$;

ROLLBACK;
-- A psql run completes without COMMIT; no synthetic rows survive.
