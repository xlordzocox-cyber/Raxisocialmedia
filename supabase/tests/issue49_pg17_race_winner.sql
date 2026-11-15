\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','77770000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"77770000-0000-4000-8000-000000000001","is_anonymous":false}',true);
SELECT pg_advisory_xact_lock(773451);
SELECT id FROM public.raxi_workspaces WHERE id='77770000-0000-4000-8000-000000000002' FOR UPDATE;
SELECT pg_sleep(6);
DO $$
DECLARE snap jsonb; proposed jsonb; cmd jsonb; saved jsonb;
BEGIN
 snap:=public.raxi_campaign_snapshot('77770000-0000-4000-8000-000000000002'::uuid);
 IF snap->>'version'<>'0' THEN RAISE EXCEPTION 'FAIL WINNER: expected 0'; END IF;
 proposed:=jsonb_set(snap,'{ideas}',jsonb_build_array(snap->'ideas'->0||
   jsonb_build_object('status','UNDER_REVIEW','updatedAt','2026-01-01T00:01:00Z')));
 proposed:=jsonb_set(proposed,'{version}','1'::jsonb);
 cmd:=jsonb_build_object('workspaceId','77770000-0000-4000-8000-000000000002',
 'operationId','77770000-0000-4000-8000-000000000011','expectedVersion',0,
 'action',jsonb_build_object('type','REVIEW_IDEA','ideaId','IDEA-REAL-RACE',
 'expectedUpdatedAt','2026-01-01T00:00:00Z','confirmed',true));
 saved:=public.raxi_campaign_commit('77770000-0000-4000-8000-000000000001'::uuid,cmd,proposed);
 IF saved->>'version'<>'1' OR saved->'ideas'->0->>'status'<>'UNDER_REVIEW'
 THEN RAISE EXCEPTION 'FAIL WINNER: invalid commit result'; END IF;
 RAISE NOTICE 'PASS RACE WINNER: committed version 1';
END $$;
COMMIT;