-- Issue #49. OFFLINE NEGATIVE TESTS: stale CAS, ownership and immutable approval.
-- Not a full concurrency or idempotent success/replay test.
-- Isolated PostgreSQL 17 lab ONLY. No Supabase, no network.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database() IS DISTINCT FROM 'raxi_campaign_qa' THEN RAISE EXCEPTION 'LAB_ONLY database mismatch'; END IF;
 IF (SELECT count(*) FROM public.raxi_workspaces)<>0 THEN RAISE EXCEPTION 'LAB_ONLY expected empty workspace table'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.raxi_campaign_commit(uuid,jsonb,jsonb)'::regprocedure) THEN
   RAISE EXCEPTION 'LAB_ONLY campaign RPC missing';
 END IF;
END $guard$;

INSERT INTO auth.users(id) VALUES ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','campaign-qa','Campaign QA');

DO $test$
DECLARE
 actor uuid:='33333333-3333-4333-8333-333333333333';
 workspace uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 command jsonb;
 next_state jsonb;
 code text;
BEGIN
 command:=jsonb_build_object(
   'workspaceId',workspace,'operationId','44444444-4444-4444-8444-444444444444',
   'expectedVersion',1,'action',jsonb_build_object('type','REVIEW_IDEA'));
 next_state:=jsonb_build_object(
   'workspaceId',workspace,'ownerId',actor,'version',2,
   'ideas','[]'::jsonb,'session',jsonb_build_object('campaigns','[]'::jsonb,'strategies','[]'::jsonb));
 BEGIN
   PERFORM public.raxi_campaign_commit(actor,command,next_state);
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code IS DISTINCT FROM '40001' THEN
     RAISE EXCEPTION 'FAIL CAS-NEG: expected stale version 40001, received %',code;
   END IF;
 END;
 IF (SELECT campaign_version FROM public.raxi_workspaces WHERE id=workspace)<>0
   OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=workspace)<>0 THEN
   RAISE EXCEPTION 'FAIL CAS-NEG: stale command modified state';
 END IF;
 RAISE NOTICE 'PASS CAS-NEG: stale expectedVersion rejected, no writes';

 BEGIN
   PERFORM public.raxi_campaign_commit(
       '55555555-5555-4555-8555-555555555555'::uuid,
       command || jsonb_build_object('expectedVersion',0),
       next_state || jsonb_build_object('version',1));
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code IS DISTINCT FROM '42501' THEN
     RAISE EXCEPTION 'FAIL OWNER-NEG: expected ownership 42501, received %',code;
   END IF;
 END;
 RAISE NOTICE 'PASS OWNER-NEG: forged server actor without workspace ownership denied';
END $test$;

-- Test the immutable approval trigger independently of client/Edge domain.
INSERT INTO public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
VALUES (
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'IDEA','66666666-6666-4666-8666-666666666666',
 'APPROVED','33333333-3333-4333-8333-333333333333',
 'campaign-qa-approval-1','{}'::jsonb
);

DO $test$
DECLARE
 code text;
BEGIN
 BEGIN
   UPDATE public.raxi_approvals
      SET context='{"forged":true}'::jsonb
    WHERE idempotency_key='campaign-qa-approval-1';
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code IS DISTINCT FROM '23514' THEN
     RAISE EXCEPTION 'FAIL APPR-NEG UPDATE: expected 23514, got %',code;
   END IF;
 END;
 RAISE NOTICE 'PASS APPR-NEG: approval UPDATE rejected';
 BEGIN
   DELETE FROM public.raxi_approvals WHERE idempotency_key='campaign-qa-approval-1';
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code IS DISTINCT FROM '23514' THEN
     RAISE EXCEPTION 'FAIL APPR-NEG DELETE: expected 23514, got %',code;
   END IF;
 END;
 IF (SELECT count(*) FROM public.raxi_approvals WHERE idempotency_key='campaign-qa-approval-1')<>1 THEN
   RAISE EXCEPTION 'FAIL APPR-NEG: approval history lost';
 END IF;
 RAISE NOTICE 'PASS APPR-NEG: approval DELETE rejected; history remains';
END $test$;
ROLLBACK;
