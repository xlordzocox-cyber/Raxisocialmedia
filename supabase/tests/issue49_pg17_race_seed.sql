\set ON_ERROR_STOP on
-- OFFLINE ONLY. This fixture commits temporarily; run cleanup after both workers.
BEGIN;
DO $$
BEGIN
 IF current_database()<>'raxi_campaign_qa'
 OR EXISTS(SELECT 1 FROM public.raxi_workspaces)
 OR EXISTS(SELECT 1 FROM auth.users)
 OR EXISTS(SELECT 1 FROM public.raxi_audit_events)
 THEN RAISE EXCEPTION 'LAB_ONLY expected completely empty test database'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('77770000-0000-4000-8000-000000000001');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES ('77770000-0000-4000-8000-000000000002','77770000-0000-4000-8000-000000000001','cas-race-qa','CAS Race QA');
INSERT INTO public.raxi_ideas(id,workspace_id,external_id,kind,title,status,source,payload,updated_at)
VALUES ('77770000-0000-4000-8000-000000000003',
'77770000-0000-4000-8000-000000000002','IDEA-REAL-RACE','PROPOSAL','Synthetic race',
'PROPOSED','MANUAL_LUIS',
'{"id":"IDEA-REAL-RACE","status":"PROPOSED","updatedAt":"2026-01-01T00:00:00Z"}'::jsonb,
'2026-01-01T00:00:00Z');
COMMIT;