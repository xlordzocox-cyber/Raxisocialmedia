\set ON_ERROR_STOP on
-- Issue49: rejected Strategy -> explicit new revision via campaign RPC.
-- Offline PostgreSQL17 lab with fake auth claims ONLY. All rows ROLLBACK.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'raxi_campaign_qa'
 OR EXISTS (SELECT 1 FROM public.raxi_workspaces)
 OR EXISTS (SELECT 1 FROM auth.users)
 THEN RAISE EXCEPTION 'LAB_ONLY: require clean isolated database'; END IF;
END $guard$;
INSERT INTO auth.users(id) VALUES ('c1111111-1111-4111-8111-111111111111');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES ('c2222222-2222-4222-8222-222222222222','c1111111-1111-4111-8111-111111111111','strategy-review-qa','Strategy Review QA');
INSERT INTO public.raxi_ideas(id,workspace_id,external_id,kind,title,status,source,payload)
VALUES ('c3333333-3333-4333-8333-333333333333','c2222222-2222-4222-8222-222222222222',
'IDEA-REVISION','PROPOSAL','Synthetic revision source','SENT_TO_HQ','LAB_ONLY','{}'::jsonb);
INSERT INTO public.raxi_campaigns(id,workspace_id,external_id,source_idea_id,title,status,provenance,payload)
VALUES ('c4444444-4444-4444-8444-444444444444','c2222222-2222-4222-8222-222222222222',
'CAMPAIGN-REVISION','c3333333-3333-4333-8333-333333333333','Synthetic revision campaign','PLANNING','REAL',
'{"id":"CAMPAIGN-REVISION","status":"PLANNING","provenance":"REAL"}'::jsonb);
-- Historical review was produced after DRAFT deliverables; trigger rejects later edits.
INSERT INTO public.raxi_strategy_revisions(id,workspace_id,campaign_id,revision,status,payload)
VALUES ('c5555555-5555-4555-8555-555555555555',
'c2222222-2222-4222-8222-222222222222','c4444444-4444-4444-8444-444444444444',1,'DRAFT',
'{"campaignId":"CAMPAIGN-REVISION","revision":1,"status":"DRAFT","title":"V1","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","deliverables":[{"id":"DEL-OLD","channel":"INSTAGRAM","contentLevel":"PUBLIC","format":"IMAGE","quantity":1}]}'::jsonb);
INSERT INTO public.raxi_strategy_deliverables(workspace_id,strategy_id,external_id,channel,content_level,format,quantity,payload)
VALUES ('c2222222-2222-4222-8222-222222222222','c5555555-5555-4555-8555-555555555555',
'DEL-OLD','INSTAGRAM','PUBLIC','IMAGE',1,'{"id":"DEL-OLD","quantity":1}'::jsonb);
UPDATE public.raxi_strategy_revisions
SET status='IN_REVIEW',payload=jsonb_set(payload,'{status}','"IN_REVIEW"'::jsonb)
WHERE id='c5555555-5555-4555-8555-555555555555';
SELECT set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"sub":"c1111111-1111-4111-8111-111111111111","is_anonymous":false}',true);
DO $test$
DECLARE actor uuid:='c1111111-1111-4111-8111-111111111111';
 ws uuid:='c2222222-2222-4222-8222-222222222222';
 snap jsonb; proposed jsonb; next_state jsonb; cmd jsonb; result jsonb; code text;
 old_strategy uuid:='c5555555-5555-4555-8555-555555555555';
BEGIN
 snap:=public.raxi_campaign_snapshot(ws,actor);
 IF snap->>'version'<>'0'
 OR snap->'session'->'strategies'->0->>'status'<>'IN_REVIEW'
 THEN RAISE EXCEPTION 'FAIL REVIEW initial snapshot'; END IF;
 proposed:=jsonb_set(snap->'session'->'strategies'->0,'{status}','"CHANGES_REQUESTED"'::jsonb);
 proposed:=jsonb_set(proposed,'{changeReason}','"Need alternate visual"'::jsonb);
 proposed:=jsonb_set(proposed,'{updatedAt}','"2026-01-01T00:01:00Z"'::jsonb);
 next_state:=jsonb_set(snap,'{session,strategies}',jsonb_build_array(proposed));
 next_state:=jsonb_set(next_state,'{version}','1'::jsonb);
 cmd:=jsonb_build_object('workspaceId',ws,'expectedVersion',0,
 'operationId','c6666666-6666-4666-8666-666666666661',
 'action',jsonb_build_object('type','REQUEST_STRATEGY_CHANGES','campaignId','CAMPAIGN-REVISION','revision',1));
 result:=public.raxi_campaign_commit(actor,cmd,next_state);
 IF result->>'version'<>'1' OR
 (SELECT status FROM public.raxi_strategy_revisions WHERE id=old_strategy)<>'CHANGES_REQUESTED' OR
 (SELECT count(*) FROM public.raxi_approvals WHERE subject_id=old_strategy AND action='CHANGES_REQUESTED')<>1
 THEN RAISE EXCEPTION 'FAIL REQUEST_CHANGES transition/approval'; END IF;
 RAISE NOTICE 'PASS RPC CHANGES: in-review revision change-requested and decision logged';

 -- The old revision and old deliverable must now remain frozen.
 BEGIN
  UPDATE public.raxi_strategy_deliverables SET quantity=99
  WHERE strategy_id=old_strategy;
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL CHANGES DELIVERABLE expected 23514, got %',code; END IF;
 END;
 RAISE NOTICE 'PASS RPC CHANGES HISTORY: old deliverables frozen';

 -- Create V2 draft from a deliberately distinct deliverable.
 snap:=result;
 proposed:=jsonb_build_object(
  'campaignId','CAMPAIGN-REVISION','revision',2,'status','DRAFT','title','V2',
  'createdAt','2026-01-01T00:02:00Z','updatedAt','2026-01-01T00:02:00Z',
  'deliverables',jsonb_build_array(jsonb_build_object('id','DEL-NEW',
  'channel','FANVIEW','contentLevel','FEED','format','IMAGE','quantity',1)));
 next_state:=jsonb_set(snap,'{session,strategies}',
   (snap->'session'->'strategies') || jsonb_build_array(proposed));
 next_state:=jsonb_set(next_state,'{version}','2'::jsonb);
 cmd:=jsonb_build_object('workspaceId',ws,'expectedVersion',1,
 'operationId','c6666666-6666-4666-8666-666666666662',
 'action',jsonb_build_object('type','START_STRATEGY_REVISION',
   'campaignId','CAMPAIGN-REVISION','revision',1,'confirmed',false));
 BEGIN
  PERFORM public.raxi_campaign_commit(actor,cmd,next_state);
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL NEW_REV unconfirmed expected 23514, got %',code; END IF;
 END;
 RAISE NOTICE 'PASS RPC REVISION UNCONFIRMED: new version denied';

 cmd:=jsonb_set(cmd,'{action,confirmed}','true'::jsonb);
 result:=public.raxi_campaign_commit(actor,cmd,next_state);
 IF result->>'version'<>'2'
 OR (SELECT count(*) FROM public.raxi_strategy_revisions WHERE workspace_id=ws AND revision=2 AND status='DRAFT')<>1
 OR (SELECT count(*) FROM public.raxi_strategy_deliverables WHERE workspace_id=ws AND external_id='DEL-NEW')<>1
 OR (SELECT count(*) FROM public.raxi_strategy_revisions WHERE id=old_strategy AND status='CHANGES_REQUESTED')<>1
 THEN RAISE EXCEPTION 'FAIL RPC REVISION V2 or historical V1'; END IF;
 RAISE NOTICE 'PASS RPC REVISION V2: explicit approval of new revision, prior frozen';
 
 -- No SAVE_STRATEGY duplicate revision should bypass explicit START action.
 snap:=result;
 proposed:=jsonb_build_object(
  'campaignId','CAMPAIGN-REVISION','revision',3,'status','DRAFT','title','Bypass',
  'createdAt','2026-01-01T00:03:00Z','updatedAt','2026-01-01T00:03:00Z',
  'deliverables','[]'::jsonb);
 next_state:=jsonb_set(snap,'{session,strategies}',
   (snap->'session'->'strategies') || jsonb_build_array(proposed));
 next_state:=jsonb_set(next_state,'{version}','3'::jsonb);
 cmd:=jsonb_build_object('workspaceId',ws,'expectedVersion',2,
 'operationId','c6666666-6666-4666-8666-666666666663',
 'action',jsonb_build_object('type','SAVE_STRATEGY','campaignId','CAMPAIGN-REVISION','revision',3));
 BEGIN
  PERFORM public.raxi_campaign_commit(actor,cmd,next_state);
  RAISE EXCEPTION 'FAIL_UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  IF code<>'23514' THEN RAISE EXCEPTION 'FAIL RPC REVISION BYPASS expected 23514, got %',code; END IF;
 END;
 IF (SELECT campaign_version FROM public.raxi_workspaces WHERE id=ws)<>2
 OR (SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id=ws AND action='CAMPAIGN_COMMAND_COMMITTED')<>2
 THEN RAISE EXCEPTION 'FAIL RPC REVISION failed commands modified history'; END IF;
 RAISE NOTICE 'PASS RPC REVISION BYPASS: implicit V3 forbidden; audit unchanged';
END $test$;
ROLLBACK;
