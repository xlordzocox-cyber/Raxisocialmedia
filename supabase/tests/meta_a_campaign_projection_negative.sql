-- Meta A / PR53 - adversarial JSON projection test, isolated PostgreSQL 17 ONLY.
-- Requires the four base v0.9 migrations PLUS campaign_strategy_pending_review in
-- a fresh local disposable database named raxi_campaign_qa, with synthetic auth.users.
-- NEVER execute against Supabase staging/production or a shared database.
-- Tests assert SQLSTATE and no persistent mutation; the entire file ROLLBACKs.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'raxi_campaign_qa' THEN RAISE EXCEPTION 'LAB_ONLY wrong database'; END IF;
 IF (SELECT count(*) FROM public.raxi_workspaces) <> 0 THEN RAISE EXCEPTION 'LAB_ONLY database not empty'; END IF;
 IF to_regprocedure('public.raxi_campaign_commit(uuid,jsonb,jsonb)') IS NULL THEN RAISE EXCEPTION 'LAB_ONLY missing campaign RPC'; END IF;
 IF has_function_privilege('authenticated','public.raxi_campaign_commit(uuid,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: authenticated can invoke privileged commit'; END IF;
 IF has_function_privilege('anon','public.raxi_campaign_commit(uuid,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can invoke privileged commit'; END IF;
END $guard$;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','meta-a-negative','Meta A negative');
-- Caller identity is trusted only inside this offline synthetic role; not an Auth/JWT proof.
-- The privileged commit RPC is GRANTed exclusively to service_role.
SET LOCAL ROLE service_role;
DO $cases$
DECLARE
  actor uuid := '11111111-1111-4111-8111-111111111111';
  ws uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  operation_id uuid := '22222222-2222-4222-8222-222222222222';
  command jsonb;
  proposed jsonb;
  sqlstate_value text;
  changed boolean;
BEGIN
  command := jsonb_build_object('workspaceId',ws,'operationId',operation_id,'expectedVersion',0,
    'action',jsonb_build_object('type','REVIEW_IDEA','ideaId','IDEA-REAL-NOT-EXISTING','expectedUpdatedAt','2026-10-19T20:00:00Z','confirmed',true));
  proposed := jsonb_build_object('workspaceId',ws,'ownerId',actor,'version',1,
      'ideas',jsonb_build_array(jsonb_build_object('id','IDEA-REAL-NOT-EXISTING','status','APPROVED_FOR_HQ')),
      'handoffs','[]'::jsonb,
      'session',jsonb_build_object('campaigns','[]'::jsonb,'strategies','[]'::jsonb,'decisions','[]'::jsonb,'audit','[]'::jsonb),
      'receipts','[]'::jsonb);
  changed := false;
  BEGIN
    PERFORM public.raxi_campaign_commit(actor,command,proposed);
    changed := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS sqlstate_value=RETURNED_SQLSTATE;
    IF sqlstate_value <> '23514' THEN
      RAISE EXCEPTION 'FAIL forged unknown idea: expected 23514 got %',sqlstate_value;
    END IF;
  END;
  IF changed THEN RAISE EXCEPTION 'FAIL forged unknown idea committed'; END IF;
  IF (SELECT campaign_version FROM public.raxi_workspaces WHERE id=ws)<>0
     OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=ws)<>0 THEN
    RAISE EXCEPTION 'FAIL forged unknown idea changed DB';
  END IF;
  RAISE NOTICE 'PASS forged unknown idea projection rejected atomically';

  -- Same command cannot fabricate an identity from another workspace.
  changed := false;
  BEGIN
    PERFORM public.raxi_campaign_commit('33333333-3333-4333-8333-333333333333',command,proposed);
    changed := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS sqlstate_value=RETURNED_SQLSTATE;
    IF sqlstate_value <> '42501' THEN RAISE EXCEPTION 'FAIL foreign actor: expected 42501 got %',sqlstate_value; END IF;
  END;
  IF changed THEN RAISE EXCEPTION 'FAIL foreign actor committed'; END IF;
  RAISE NOTICE 'PASS foreign actor denied';

  -- An explicitly stale expected version must be rejected prior to any projection writes.
  changed := false;
  BEGIN
    PERFORM public.raxi_campaign_commit(actor,command || '{"expectedVersion":9}'::jsonb,proposed);
    changed := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS sqlstate_value=RETURNED_SQLSTATE;
    IF sqlstate_value <> '40001' THEN RAISE EXCEPTION 'FAIL stale expectedVersion: expected 40001 got %',sqlstate_value; END IF;
  END;
  IF changed THEN RAISE EXCEPTION 'FAIL stale command committed'; END IF;
  IF (SELECT campaign_version FROM public.raxi_workspaces WHERE id=ws)<>0
     OR EXISTS (SELECT 1 FROM public.raxi_approvals WHERE workspace_id=ws)
     OR EXISTS (SELECT 1 FROM public.raxi_audit_events WHERE workspace_id=ws) THEN
    RAISE EXCEPTION 'FAIL negative cases mutated approval/version/audit';
  END IF;
  RAISE NOTICE 'PASS stale version denied with no approval or audit mutation';
END $cases$;
ROLLBACK;
