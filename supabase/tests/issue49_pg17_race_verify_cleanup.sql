\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','77770000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"77770000-0000-4000-8000-000000000001","is_anonymous":false}',true);
DO $$
DECLARE v bigint; audits int; receipts int; s text;
BEGIN
 IF current_database()<>'raxi_campaign_qa' THEN RAISE EXCEPTION 'LAB_ONLY database mismatch'; END IF;
 SELECT campaign_version INTO v FROM public.raxi_workspaces WHERE id='77770000-0000-4000-8000-000000000002';
 SELECT count(*) INTO audits FROM public.raxi_audit_events WHERE workspace_id='77770000-0000-4000-8000-000000000002' AND action='CAMPAIGN_COMMAND_COMMITTED';
 SELECT status INTO s FROM public.raxi_ideas WHERE id='77770000-0000-4000-8000-000000000003';
 IF v IS DISTINCT FROM 1 OR audits<>1 OR s IS DISTINCT FROM 'UNDER_REVIEW' THEN
  RAISE EXCEPTION 'FAIL RACE VERIFY: version %, audits %, status %',v,audits,s;
 END IF;
 SELECT jsonb_array_length(public.raxi_campaign_snapshot('77770000-0000-4000-8000-000000000002'::uuid)->'receipts') INTO receipts;
 IF receipts<>1 THEN RAISE EXCEPTION 'FAIL RACE VERIFY: receipts %',receipts; END IF;
 RAISE NOTICE 'PASS RACE VERIFY: one version increment, one audit, one receipt, one transition';
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