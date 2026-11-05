\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','77770000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"77770000-0000-4000-8000-000000000001","is_anonymous":false}',true);
DO $$
DECLARE snap jsonb; proposed jsonb; cmd jsonb; code text; started timestamptz:=clock_timestamp();
BEGIN
 snap:=public.raxi_campaign_snapshot('77770000-0000-4000-8000-000000000002'::uuid);
 IF snap->>'version'<>'0' THEN RAISE EXCEPTION 'FAIL LOSER: did not overlap version 0'; END IF;
 proposed:=jsonb_set(snap,'{ideas}',jsonb_build_array(snap->'ideas'->0||
   jsonb_build_object('status','UNDER_REVIEW','updatedAt','2026-01-01T00:01:00Z')));
 proposed:=jsonb_set(proposed,'{version}','1'::jsonb);
 cmd:=jsonb_build_object('workspaceId','77770000-0000-4000-8000-000000000002',
 'operationId','77770000-0000-4000-8000-000000000012','expectedVersion',0,
 'action',jsonb_build_object('type','REVIEW_IDEA','ideaId','IDEA-REAL-RACE',
 'expectedUpdatedAt','2026-01-01T00:00:00Z','confirmed',true));
 BEGIN
   PERFORM public.raxi_campaign_commit('77770000-0000-4000-8000-000000000001'::uuid,cmd,proposed);
   RAISE EXCEPTION 'FAIL LOSER: second command committed';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   IF code<>'40001' THEN RAISE EXCEPTION 'FAIL LOSER: expected 40001, got %',code; END IF;
 END;
 IF extract(epoch from (clock_timestamp()-started))<1
 THEN RAISE EXCEPTION 'FAIL LOSER: no measurable lock wait'; END IF;
 RAISE NOTICE 'PASS RACE LOSER: waited and received 40001';
END $$;
COMMIT;