-- Issue #49 / PR #50. Positive idempotency/replay with real idea transition.
-- OFFLINE PostgreSQL 17 only. Requires fake auth/storage + four base migrations
-- + candidate campaign migration installed in empty raxi_campaign_qa database.
-- The caller is local postgres on an isolated lab, NOT a production server.
-- Synthetic actor and idea data are ROLLED BACK even on a successful run.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database() IS DISTINCT FROM 'raxi_campaign_qa' THEN
   RAISE EXCEPTION 'LAB_ONLY: unexpected database';
 END IF;
 IF (SELECT count(*) FROM public.raxi_workspaces)<>0
    OR (SELECT count(*) FROM public.raxi_ideas)<>0
    OR (SELECT count(*) FROM public.raxi_audit_events)<>0 THEN
   RAISE EXCEPTION 'LAB_ONLY: expected empty workspace/ideas/audit; no writes allowed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc
                WHERE oid='public.raxi_campaign_commit(uuid,jsonb,jsonb)'::regprocedure) THEN
   RAISE EXCEPTION 'LAB_ONLY: campaign migration missing';
 END IF;
END $guard$;

INSERT INTO auth.users(id) VALUES ('77777777-7777-4777-8777-777777777777');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES ('88888888-8888-4888-8888-888888888888',
        '77777777-7777-4777-8777-777777777777',
        'idempotency-qa','Idempotency QA');
INSERT INTO public.raxi_ideas
 (id,workspace_id,external_id,kind,title,status,source,payload,updated_at)
VALUES
 ('99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888',
  'IDEA-REAL-QA','PROPOSAL','Synthetic idea','PROPOSED','MANUAL_LUIS',
  '{"id":"IDEA-REAL-QA","title":"Synthetic idea","status":"PROPOSED","updatedAt":"2026-01-01T00:00:00Z"}'::jsonb,
  '2026-01-01T00:00:00Z'::timestamptz);

-- The candidate read RPC resolves auth.uid() when the current SQL role is
-- local postgres, so set only the synthetic claim in THIS transaction.
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
SELECT set_config('request.jwt.claims','{"sub":"77777777-7777-4777-8777-777777777777","is_anonymous":false}',true);

DO $positive$
DECLARE
 actor uuid:='77777777-7777-4777-8777-777777777777';
 workspace uuid:='88888888-8888-4888-8888-888888888888';
 snap jsonb;
 next_state jsonb;
 idea_next jsonb;
 command jsonb;
 first_result jsonb;
 retry_result jsonb;
 op_conflict jsonb;
 other_op jsonb;
 code text;
BEGIN
 snap:=public.raxi_campaign_snapshot(workspace,actor);
 IF snap->>'version' IS DISTINCT FROM '0'
    OR jsonb_array_length(snap->'ideas')<>1
    OR snap->'ideas'->0->>'status' IS DISTINCT FROM 'PROPOSED' THEN
   RAISE EXCEPTION 'FAIL IDEMP-POS: initial snapshot unexpected';
 END IF;

 idea_next:=(snap->'ideas'->0) || jsonb_build_object(
     'status','UNDER_REVIEW','updatedAt','2026-01-01T00:01:00Z');
 next_state:=jsonb_set(snap,'{ideas}',jsonb_build_array(idea_next),true);
 next_state:=jsonb_set(next_state,'{version}','1'::jsonb,true);
 command:=jsonb_build_object(
     'workspaceId',workspace,
     'operationId','aaaaaaaa-1111-4111-8111-111111111111',
     'expectedVersion',0,
     'action',jsonb_build_object(
       'type','REVIEW_IDEA','ideaId','IDEA-REAL-QA',
       'expectedUpdatedAt','2026-01-01T00:00:00Z',
       'confirmed',true));

 first_result:=public.raxi_campaign_commit(actor,command,next_state);
 IF first_result->>'version' IS DISTINCT FROM '1'
   OR first_result->'ideas'->0->>'status' IS DISTINCT FROM 'UNDER_REVIEW'
   OR jsonb_array_length(first_result->'receipts')<>1
   OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=workspace AND action='CAMPAIGN_COMMAND_COMMITTED')<>1
 THEN
   RAISE EXCEPTION 'FAIL IDEMP-POS: first commit not confirmed exactly once';
 END IF;
 RAISE NOTICE 'PASS IDEMP-POS: valid idea REVIEW transitioned and receipt committed';

 retry_result:=public.raxi_campaign_commit(actor,command,next_state);
 IF retry_result->>'version' IS DISTINCT FROM '1'
    OR retry_result->'ideas'->0->>'status' IS DISTINCT FROM 'UNDER_REVIEW'
    OR jsonb_array_length(retry_result->'receipts')<>1
    OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=workspace AND action='CAMPAIGN_COMMAND_COMMITTED')<>1
 THEN
   RAISE EXCEPTION 'FAIL IDEMP-REPLAY: retry duplicated effect or changed version';
 END IF;
 RAISE NOTICE 'PASS IDEMP-REPLAY: identical operation replay returned existing receipt';

 op_conflict:=jsonb_set(command,'{action,expectedUpdatedAt}',
                          '"2026-01-01T00:09:00Z"'::jsonb);
 BEGIN
   PERFORM public.raxi_campaign_commit(actor,op_conflict,next_state);
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code IS DISTINCT FROM '23505' THEN
     RAISE EXCEPTION 'FAIL IDEMP-CONFLICT: expected 23505, received %',code;
   END IF;
 END;
 RAISE NOTICE 'PASS IDEMP-CONFLICT: same operationId with changed command rejected';

 other_op:=jsonb_set(command,'{operationId}',
                    '"bbbbbbbb-2222-4222-8222-222222222222"'::jsonb);
 BEGIN
   PERFORM public.raxi_campaign_commit(actor,other_op,next_state);
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code IS DISTINCT FROM '40001' THEN
     RAISE EXCEPTION 'FAIL CAS-POST: expected 40001, received %',code;
   END IF;
 END;
 IF (SELECT campaign_version FROM public.raxi_workspaces WHERE id=workspace)<>1
    OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=workspace AND action='CAMPAIGN_COMMAND_COMMITTED')<>1 THEN
   RAISE EXCEPTION 'FAIL CAS-POST: rejected command modified persisted state';
 END IF;
 RAISE NOTICE 'PASS CAS-POST: second operation with stale version rejected; no extra writes';
END $positive$;

ROLLBACK;
-- No synthetic idea, workspace, user or audit survives the transaction.
