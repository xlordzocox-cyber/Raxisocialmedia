\set ON_ERROR_STOP on
-- Issue49 local PG17 ONLY: SAVE -> SUBMIT -> APPROVE via campaign RPC.
-- Synthetic fixtures. The entire test is inside a single ROLLBACK transaction.
-- This tests RPC state transitions, not real Supabase JWT or human authorization.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'raxi_campaign_qa'
 OR EXISTS(SELECT 1 FROM public.raxi_workspaces)
 OR EXISTS(SELECT 1 FROM auth.users)
 OR EXISTS(SELECT 1 FROM public.raxi_audit_events)
 THEN RAISE EXCEPTION 'LAB_ONLY requires empty isolated database'; END IF;
END $guard$;
INSERT INTO auth.users(id) VALUES ('b1111111-1111-4111-8111-111111111111');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES ('b2222222-2222-4222-8222-222222222222',
'b1111111-1111-4111-8111-111111111111','strategy-rpc-qa','Strategy RPC QA');
INSERT INTO public.raxi_ideas(id,workspace_id,external_id,kind,title,status,source,payload)
VALUES ('b3333333-3333-4333-8333-333333333333',
'b2222222-2222-4222-8222-222222222222','IDEA-RPC-TEST',
'PROPOSAL','Strategy RPC fixture','SENT_TO_HQ','LAB_ONLY','{}'::jsonb);
INSERT INTO public.raxi_campaigns(id,workspace_id,external_id,source_idea_id,title,status,provenance,payload)
VALUES ('b4444444-4444-4444-8444-444444444444',
'b2222222-2222-4222-8222-222222222222','CAMPAIGN-STRATEGY-RPC',
'b3333333-3333-4333-8333-333333333333','Strategy RPC fixture','PLANNING','REAL',
'{"id":"CAMPAIGN-STRATEGY-RPC","status":"PLANNING","provenance":"REAL"}'::jsonb);
SELECT set_config('request.jwt.claim.sub','b1111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","is_anonymous":false}',true);

DO $tests$
DECLARE
 actor uuid:='b1111111-1111-4111-8111-111111111111';
 ws uuid:='b2222222-2222-4222-8222-222222222222';
 snap jsonb; next_state jsonb; proposal jsonb; cmd jsonb; receipt jsonb; decision_op jsonb;
 code text; revision_id uuid; approved_count integer;
BEGIN
 snap:=public.raxi_campaign_snapshot(ws,actor);
 IF snap->>'version'<>'0'
  OR jsonb_array_length(snap->'session'->'campaigns')<>1
  OR jsonb_array_length(snap->'session'->'strategies')<>0
 THEN RAISE EXCEPTION 'FAIL RPC STRATEGY initial snapshot invalid'; END IF;

 -- CREATE DRAFT strategy through the actual RPC.
 proposal:=jsonb_build_object(
  'campaignId','CAMPAIGN-STRATEGY-RPC','revision',1,'status','DRAFT',
  'title','Synthetic strategy','createdAt','2026-01-01T00:00:00Z',
  'updatedAt','2026-01-01T00:00:00Z',
  'deliverables',jsonb_build_array(jsonb_build_object(
    'id','DEL-STRATEGY-RPC','channel','INSTAGRAM','contentLevel','PUBLIC',
    'format','IMAGE','quantity',1)));
 next_state:=jsonb_set(snap,'{session,strategies}',jsonb_build_array(proposal));
 next_state:=jsonb_set(next_state,'{version}','1'::jsonb);
 cmd:=jsonb_build_object(
  'workspaceId',ws,'expectedVersion',0,
  'operationId','b5555555-5555-4555-8555-555555555551',
  'action',jsonb_build_object('type','SAVE_STRATEGY','campaignId','CAMPAIGN-STRATEGY-RPC','revision',1));
 receipt:=public.raxi_campaign_commit(actor,cmd,next_state);
 IF receipt->>'version'<>'1'
   OR (SELECT count(*) FROM public.raxi_strategy_revisions WHERE workspace_id=ws AND status='DRAFT')<>1
   OR (SELECT count(*) FROM public.raxi_strategy_deliverables WHERE workspace_id=ws)<>1
 THEN RAISE EXCEPTION 'FAIL RPC STRATEGY save/deliverable'; END IF;
 RAISE NOTICE 'PASS RPC STRATEGY SAVE: draft strategy and deliverable persisted';

 -- SUBMIT DRAFT to IN_REVIEW.
 snap:=receipt;
 proposal:=jsonb_set(snap->'session'->'strategies'->0,'{status}','"IN_REVIEW"'::jsonb);
 proposal:=jsonb_set(proposal,'{updatedAt}','"2026-01-01T00:01:00Z"'::jsonb);
 next_state:=jsonb_set(snap,'{session,strategies}',jsonb_build_array(proposal));
 next_state:=jsonb_set(next_state,'{version}','2'::jsonb);
 cmd:=jsonb_build_object(
  'workspaceId',ws,'expectedVersion',1,
  'operationId','b5555555-5555-4555-8555-555555555552',
  'action',jsonb_build_object('type','SUBMIT_STRATEGY','campaignId','CAMPAIGN-STRATEGY-RPC','revision',1));
 receipt:=public.raxi_campaign_commit(actor,cmd,next_state);
 IF receipt->>'version'<>'2'
   OR (SELECT count(*) FROM public.raxi_strategy_revisions WHERE workspace_id=ws AND status='IN_REVIEW')<>1
 THEN RAISE EXCEPTION 'FAIL RPC STRATEGY submit'; END IF;
 RAISE NOTICE 'PASS RPC STRATEGY SUBMIT: draft became review';

 -- Reject a retroactive edit of a submitted deliverable through SAVE_STRATEGY.
 snap:=receipt;
 proposal:=jsonb_set(snap->'session'->'strategies'->0,
  '{deliverables,0,quantity}','9'::jsonb);
 next_state:=jsonb_set(snap,'{session,strategies}',jsonb_build_array(proposal));
 next_state:=jsonb_set(next_state,'{version}','3'::jsonb);
 cmd:=jsonb_build_object(
  'workspaceId',ws,'expectedVersion',2,
  'operationId','b5555555-5555-4555-8555-555555555553',
  'action',jsonb_build_object('type','SAVE_STRATEGY','campaignId','CAMPAIGN-STRATEGY-RPC','revision',1));
 BEGIN
   PERFORM public.raxi_campaign_commit(actor,cmd,next_state);
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code<>'23514' THEN RAISE EXCEPTION 'FAIL RPC STRATEGY tamper expected 23514, got %',code; END IF;
 END;
 IF (SELECT campaign_version FROM public.raxi_workspaces WHERE id=ws)<>2
 THEN RAISE EXCEPTION 'FAIL RPC STRATEGY rejected edit incremented version'; END IF;
 RAISE NOTICE 'PASS RPC STRATEGY TAMPER: submitted deliverable edit rejected';

 -- Reject an approval WITHOUT human confirmation.
 snap:=receipt;
 proposal:=jsonb_set(snap->'session'->'strategies'->0,'{status}','"APPROVED"'::jsonb);
 proposal:=jsonb_set(proposal,'{approvedAt}','"2026-01-01T00:02:00Z"'::jsonb);
 proposal:=jsonb_set(proposal,'{updatedAt}','"2026-01-01T00:02:00Z"'::jsonb);
 next_state:=jsonb_set(snap,'{session,strategies}',jsonb_build_array(proposal));
 next_state:=jsonb_set(next_state,'{version}','3'::jsonb);
 cmd:=jsonb_build_object(
  'workspaceId',ws,'expectedVersion',2,
  'operationId','b5555555-5555-4555-8555-555555555554',
  'action',jsonb_build_object('type','APPROVE_STRATEGY','campaignId','CAMPAIGN-STRATEGY-RPC','revision',1,'confirmed',false));
 BEGIN
   PERFORM public.raxi_campaign_commit(actor,cmd,next_state);
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code<>'23514' THEN RAISE EXCEPTION 'FAIL RPC STRATEGY confirmation expected 23514, got %',code; END IF;
 END;
 RAISE NOTICE 'PASS RPC STRATEGY UNCONFIRMED: approval refused';

 -- Valid confirmed approval and stable receipt.
 cmd:=jsonb_set(cmd,'{action,confirmed}','true'::jsonb);
 decision_op:=cmd;
 receipt:=public.raxi_campaign_commit(actor,cmd,next_state);
 SELECT id INTO revision_id FROM public.raxi_strategy_revisions WHERE workspace_id=ws AND revision=1;
 SELECT count(*) INTO approved_count FROM public.raxi_approvals
  WHERE workspace_id=ws AND subject_kind='STRATEGY'
   AND subject_id=revision_id AND action='APPROVED';
 IF receipt->>'version'<>'3'
  OR (SELECT count(*) FROM public.raxi_strategy_revisions
       WHERE id=revision_id AND status='APPROVED' AND approved_by=actor)<>1
  OR approved_count<>1
  OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=ws AND action='CAMPAIGN_COMMAND_COMMITTED')<>3
 THEN RAISE EXCEPTION 'FAIL RPC STRATEGY confirmed approval/receipt'; END IF;
 RAISE NOTICE 'PASS RPC STRATEGY APPROVED: human confirmation flag and one approval/audit';

 -- Exact replay is idempotent even after approved snapshot.
 receipt:=public.raxi_campaign_commit(actor,decision_op,next_state);
 IF receipt->>'version'<>'3'
 OR (SELECT count(*) FROM public.raxi_approvals WHERE subject_id=revision_id AND action='APPROVED')<>1
 THEN RAISE EXCEPTION 'FAIL RPC STRATEGY approved replay duplicated approval'; END IF;
 RAISE NOTICE 'PASS RPC STRATEGY REPLAY: no duplicate approval';

 -- Approved strategy history cannot change.
 snap:=receipt;
 proposal:=jsonb_set(snap->'session'->'strategies'->0,'{title}','"FORGED"'::jsonb);
 next_state:=jsonb_set(snap,'{session,strategies}',jsonb_build_array(proposal));
 next_state:=jsonb_set(next_state,'{version}','4'::jsonb);
 cmd:=jsonb_build_object(
  'workspaceId',ws,'expectedVersion',3,
  'operationId','b5555555-5555-4555-8555-555555555555',
  'action',jsonb_build_object('type','SAVE_STRATEGY','campaignId','CAMPAIGN-STRATEGY-RPC','revision',1));
 BEGIN
   PERFORM public.raxi_campaign_commit(actor,cmd,next_state);
   RAISE EXCEPTION 'TEST_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code<>'23514' THEN RAISE EXCEPTION 'FAIL RPC STRATEGY approved mutation expected 23514, got %',code; END IF;
 END;
 IF (SELECT campaign_version FROM public.raxi_workspaces WHERE id=ws)<>3
 OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=ws AND action='CAMPAIGN_COMMAND_COMMITTED')<>3
 THEN RAISE EXCEPTION 'FAIL RPC STRATEGY mutation changed history'; END IF;
 RAISE NOTICE 'PASS RPC STRATEGY IMMUTABLE: approved strategy retained';
END $tests$;
ROLLBACK;
