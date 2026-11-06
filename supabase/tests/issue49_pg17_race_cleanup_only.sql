\set ON_ERROR_STOP on
-- Lab-only emergency cleanup of the fixed synthetic race fixture.
BEGIN;
DO $$
BEGIN
 IF current_database()<>'raxi_campaign_qa' THEN RAISE EXCEPTION 'LAB_ONLY database mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM public.raxi_workspaces WHERE id<>'77770000-0000-4000-8000-000000000002') THEN
  RAISE EXCEPTION 'LAB_ONLY non-fixture workspaces present; no cleanup';
 END IF;
END $$;
DELETE FROM public.raxi_audit_events WHERE workspace_id='77770000-0000-4000-8000-000000000002';
DELETE FROM public.raxi_ideas WHERE workspace_id='77770000-0000-4000-8000-000000000002';
DELETE FROM public.raxi_workspaces WHERE id='77770000-0000-4000-8000-000000000002';
DELETE FROM auth.users WHERE id='77770000-0000-4000-8000-000000000001';
COMMIT;
SELECT (SELECT count(*) FROM auth.users) AS users_left,
 (SELECT count(*) FROM public.raxi_workspaces) AS workspaces_left,
 (SELECT count(*) FROM public.raxi_ideas) AS ideas_left,
 (SELECT count(*) FROM public.raxi_audit_events) AS audit_left;