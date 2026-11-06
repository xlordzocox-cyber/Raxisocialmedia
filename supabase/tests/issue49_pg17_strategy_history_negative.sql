\set ON_ERROR_STOP on
-- Issue49 Strategy/deliverable trigger and approval-history tests.
-- Isolated PostgreSQL17 raxi_campaign_qa only, entirely rolled back.
-- Does NOT establish human authentication/authorization in a real Edge flow.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'raxi_campaign_qa' THEN RAISE EXCEPTION 'LAB_ONLY wrong database'; END IF;
 IF EXISTS(SELECT 1 FROM public.raxi_workspaces) OR EXISTS(SELECT 1 FROM auth.users) THEN
  RAISE EXCEPTION 'LAB_ONLY expected empty synthetic tables';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='raxi_strategy_history' AND tgenabled='O') OR
    NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='raxi_deliverable_history' AND tgenabled='O') OR
    NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='raxi_approval_history' AND tgenabled='O') THEN
   RAISE EXCEPTION 'Missing history protection trigger';
 END IF;
END $guard$;

INSERT INTO auth.users(id) VALUES ('a1111111-1111-4111-8111-111111111111');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES ('a2222222-2222-4222-8222-222222222222','a1111111-1111-4111-8111-111111111111','strategy-local','Strategy Lab');
INSERT INTO public.raxi_ideas(id,workspace_id,external_id,kind,title,status,source,payload)
VALUES ('a3333333-3333-4333-8333-333333333333','a2222222-2222-4222-8222-222222222222','IDEA-REAL-S','PROPOSAL','Test Strategy','SENT_TO_HQ','MANUAL_LUIS','{}'::jsonb);
INSERT INTO public.raxi_campaigns(id,workspace_id,external_id,source_idea_id,title,status,provenance,payload)
VALUES ('a4444444-4444-4444-8444-444444444444','a2222222-2222-4222-8222-222222222222','CAMPAIGN-S','a3333333-3333-4333-8333-333333333333','Strategy QA','PLANNING','REAL','{}'::jsonb);
INSERT INTO public.raxi_strategy_revisions(id,workspace_id,campaign_id,revision,status,payload,approved_by,approved_at)
VALUES
 ('a5555555-5555-4555-8555-555555555551','a2222222-2222-4222-8222-222222222222','a4444444-4444-4444-8444-444444444444',1,'DRAFT','{"status":"DRAFT","revision":1}'::jsonb,null,null),
 ('a5555555-5555-4555-8555-555555555552','a2222222-2222-4222-8222-222222222222','a4444444-4444-4444-8444-444444444444',2,'DRAFT','{"status":"DRAFT","revision":2,"title":"Submitted"}'::jsonb,null,null),
 ('a5555555-5555-4555-8555-555555555553','a2222222-2222-4222-8222-222222222222','a4444444-4444-4444-8444-444444444444',3,'DRAFT','{"status":"DRAFT","revision":3}'::jsonb,null,null),
 ('a5555555-5555-4555-8555-555555555554','a2222222-2222-4222-8222-222222222222','a4444444-4444-4444-8444-444444444444',4,'DRAFT','{"status":"DRAFT","revision":4}'::jsonb,null,null);
INSERT INTO public.raxi_strategy_deliverables(id,workspace_id,strategy_id,external_id,channel,content_level,format,quantity,payload)
VALUES
 ('a6666666-6666-4666-8666-666666666661','a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555551','DEL-DRAFT','INSTAGRAM','PUBLIC','IMAGE',1,'{}'::jsonb),
 ('a6666666-6666-4666-8666-666666666662','a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555552','DEL-REVIEW','INSTAGRAM','PUBLIC','IMAGE',1,'{}'::jsonb),
 ('a6666666-6666-4666-8666-666666666663','a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555553','DEL-APPROVED','FANVIEW','PRIVATE','IMAGE',1,'{}'::jsonb);
-- Fixture sequence: attach deliverables while all parents are DRAFT, then transition.
-- This tests the allowed historical transitions instead of bypassing the trigger.
UPDATE public.raxi_strategy_revisions
SET status='IN_REVIEW',payload=jsonb_set(payload,'{status}','"IN_REVIEW"'::jsonb)
WHERE workspace_id='a2222222-2222-4222-8222-222222222222' AND revision IN (2,3,4);
UPDATE public.raxi_strategy_revisions
SET status='APPROVED',payload=jsonb_set(payload,'{status}','"APPROVED"'::jsonb),
    approved_by='a1111111-1111-4111-8111-111111111111',approved_at=now()
WHERE workspace_id='a2222222-2222-4222-8222-222222222222' AND revision=3;
UPDATE public.raxi_strategy_revisions
SET status='CHANGES_REQUESTED',payload=jsonb_set(payload,'{status}','"CHANGES_REQUESTED"'::jsonb)
WHERE workspace_id='a2222222-2222-4222-8222-222222222222' AND revision=4;
INSERT INTO public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
VALUES ('a2222222-2222-4222-8222-222222222222','STRATEGY','a5555555-5555-4555-8555-555555555553','APPROVED','a1111111-1111-4111-8111-111111111111','ST-APPROVED-ONE','{}'::jsonb);

DO $tests$
DECLARE code text; check_count int;
BEGIN
 -- Baseline: draft remains editable.
 UPDATE public.raxi_strategy_revisions SET payload='{"status":"DRAFT","revision":1,"note":"edit"}'::jsonb
 WHERE id='a5555555-5555-4555-8555-555555555551';
 UPDATE public.raxi_strategy_deliverables SET quantity=2 WHERE id='a6666666-6666-4666-8666-666666666661';
 IF (SELECT quantity FROM public.raxi_strategy_deliverables WHERE id='a6666666-6666-4666-8666-666666666661')<>2
 THEN RAISE EXCEPTION 'FAIL STRATEGY DRAFT: edits not persisted'; END IF;
 RAISE NOTICE 'PASS STRATEGY DRAFT: mutable until submission';

 -- Under review: changing submitted content is refused.
 BEGIN
  UPDATE public.raxi_strategy_revisions SET payload='{"status":"IN_REVIEW","revision":2,"title":"Tampered"}'::jsonb
  WHERE id='a5555555-5555-4555-8555-555555555552';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL STRATEGY REVIEW content expected 23514, got %',code; END IF;
 END;
 RAISE NOTICE 'PASS STRATEGY REVIEW: submitted content immutable';

 -- Under review: going directly backwards or deleting cannot succeed.
 BEGIN
  UPDATE public.raxi_strategy_revisions SET status='DRAFT' WHERE id='a5555555-5555-4555-8555-555555555552';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL STRATEGY REVIEW regression expected 23514, got %',code; END IF;
 END;
 RAISE NOTICE 'PASS STRATEGY REVIEW: no return to draft';

 -- Approved and changes-requested revisions: cannot alter/delete.
 BEGIN
  UPDATE public.raxi_strategy_revisions SET payload='{"forged":true}'::jsonb
  WHERE id='a5555555-5555-4555-8555-555555555553';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL STRATEGY APPROVED expected 23514, got %',code; END IF;
 END;
 BEGIN
  DELETE FROM public.raxi_strategy_revisions WHERE id='a5555555-5555-4555-8555-555555555554';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL STRATEGY CHANGES_REQUESTED expected 23514, got %',code; END IF;
 END;
 RAISE NOTICE 'PASS STRATEGY HISTORY: approved/changes-requested revisions protected';

 -- Deliverable identity immutable even for draft.
 BEGIN
  UPDATE public.raxi_strategy_deliverables SET strategy_id='a5555555-5555-4555-8555-555555555552'
  WHERE id='a6666666-6666-4666-8666-666666666661';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL DELIVERABLE identity expected 23514, got %',code; END IF;
 END;
 -- Frozen deliverables: UPDATE, DELETE and INSERT on submitted parents.
 BEGIN
  UPDATE public.raxi_strategy_deliverables SET quantity=3 WHERE id='a6666666-6666-4666-8666-666666666662';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL DELIVERABLE REVIEW expected 23514, got %',code; END IF;
 END;
 BEGIN
  DELETE FROM public.raxi_strategy_deliverables WHERE id='a6666666-6666-4666-8666-666666666663';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL DELIVERABLE APPROVED expected 23514, got %',code; END IF;
 END;
 BEGIN
  INSERT INTO public.raxi_strategy_deliverables(workspace_id,strategy_id,external_id,channel,content_level,format,quantity)
  VALUES ('a2222222-2222-4222-8222-222222222222','a5555555-5555-4555-8555-555555555552','FORGED-DELIVERABLE','INSTAGRAM','PUBLIC','IMAGE',1);
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL DELIVERABLE INSERT expected 23514, got %',code; END IF;
 END;
 RAISE NOTICE 'PASS DELIVERABLE HISTORY: identity and submitted assets protected';

 -- Human approval history protection + uniqueness for approved strategy.
 BEGIN
  UPDATE public.raxi_approvals SET context='{"edited":true}'::jsonb WHERE idempotency_key='ST-APPROVED-ONE';
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL APPROVAL HISTORY expected 23514, got %',code; END IF;
 END;
 BEGIN
  INSERT INTO public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key)
  VALUES ('a2222222-2222-4222-8222-222222222222','STRATEGY','a5555555-5555-4555-8555-555555555553','APPROVED','a1111111-1111-4111-8111-111111111111','ST-APPROVED-TWO');
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23505' THEN RAISE EXCEPTION 'FAIL APPROVAL DUPLICATE expected 23505, got %',code; END IF;
 END;
 SELECT count(*) INTO check_count FROM public.raxi_approvals WHERE subject_id='a5555555-5555-4555-8555-555555555553';
 IF check_count<>1 THEN RAISE EXCEPTION 'FAIL APPROVAL COUNT %',check_count; END IF;
 RAISE NOTICE 'PASS APPROVAL HISTORY: immutable and one approved strategy decision';
END $tests$;
ROLLBACK;