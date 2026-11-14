-- PostgreSQL17 ISOLATED TEST ONLY. No real Auth tokens, no hosted SQL/provider effects.
-- Exercises the REAL StageB entrypoint rather than just the PR59 identity helper.
BEGIN;
INSERT INTO auth.users(id,is_anonymous) VALUES
 ('60000000-0000-4000-8000-000000000002',false),
 ('60000000-0000-4000-8000-000000000102',false);
INSERT INTO auth.sessions(id,user_id,not_after) VALUES
 ('60000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000002',clock_timestamp()+interval '1 hour'),
 ('60000000-0000-4000-8000-000000000103','60000000-0000-4000-8000-000000000102',clock_timestamp()+interval '1 hour');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name,campaign_version) VALUES
 ('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','host-qa-one','Host QA ONE',1),
 ('60000000-0000-4000-8000-000000000101','60000000-0000-4000-8000-000000000102','host-qa-two','Host QA TWO',1);
INSERT INTO public.raxi_agent_tasks(id,workspace_id,external_id,title,status,input_snapshot)
 SELECT '60000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000001',
  'HOST-QA-T1','Tenant 1', 'QUEUED',
  jsonb_build_object('supervised',jsonb_build_object('provenance','SUPABASE_AUTH_STAGING',
   'identity',jsonb_build_object('provenance','SUPABASE_AUTH_STAGING','actorId','60000000-0000-4000-8000-000000000002',
   'sessionId','60000000-0000-4000-8000-000000000003','workspaceId','60000000-0000-4000-8000-000000000001',
   'projectRef','zvhxjindgyvtasstfjut','expiresAt',(clock_timestamp()+interval '10 minutes')::text)));
INSERT INTO public.raxi_agent_tasks(id,workspace_id,external_id,title,status,input_snapshot)
 SELECT '60000000-0000-4000-8000-000000000104','60000000-0000-4000-8000-000000000101',
  'HOST-QA-T2','Tenant 2','QUEUED',
  jsonb_build_object('supervised',jsonb_build_object('provenance','SUPABASE_AUTH_STAGING',
   'identity',jsonb_build_object('provenance','SUPABASE_AUTH_STAGING','actorId','60000000-0000-4000-8000-000000000102',
   'sessionId','60000000-0000-4000-8000-000000000103','workspaceId','60000000-0000-4000-8000-000000000101',
   'projectRef','zvhxjindgyvtasstfjut','expiresAt',(clock_timestamp()+interval '10 minutes')::text)));
SET LOCAL ROLE service_role;
DO $identity_qa$
DECLARE
  owner1 jsonb;
  owner2 jsonb;
  answer jsonb;
BEGIN
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Wrong effective role for host QA'; END IF;
 owner1 := jsonb_build_object('provenance','SUPABASE_AUTH_STAGING','actorId','60000000-0000-4000-8000-000000000002',
  'sessionId','60000000-0000-4000-8000-000000000003','workspaceId','60000000-0000-4000-8000-000000000001',
  'projectRef','zvhxjindgyvtasstfjut','expiresAt',(clock_timestamp()+interval '10 minutes')::text);
 owner2 := jsonb_build_object('provenance','SUPABASE_AUTH_STAGING','actorId','60000000-0000-4000-8000-000000000102',
  'sessionId','60000000-0000-4000-8000-000000000103','workspaceId','60000000-0000-4000-8000-000000000101',
  'projectRef','zvhxjindgyvtasstfjut','expiresAt',(clock_timestamp()+interval '10 minutes')::text);
 answer := public.raxi_supervised_host_command(owner1,'readTask',
  '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
 IF answer->>'external_id' IS DISTINCT FROM 'HOST-QA-T1' THEN
  RAISE EXCEPTION 'Valid owner/session command failed'; END IF;
 RAISE NOTICE 'PASS: valid owner authenticated session reads own task via hosted command';
 BEGIN
  PERFORM public.raxi_supervised_host_command(owner2,'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Foreign tenant task was readable';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM public.raxi_supervised_host_command(jsonb_set(owner1,'{workspaceId}',to_jsonb('60000000-0000-4000-8000-000000000101'::text)),'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Workspace mismatch allowed';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM public.raxi_supervised_host_command(jsonb_set(owner1,'{actorId}',to_jsonb('60000000-0000-4000-8000-000000000102'::text)),'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Actor mismatch allowed';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM public.raxi_supervised_host_command(jsonb_set(owner1,'{sessionId}',to_jsonb('60000000-0000-4000-8000-000000000103'::text)),'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Foreign session accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM public.raxi_supervised_host_command(jsonb_set(owner1,'{sessionId}',to_jsonb('60000000-0000-4000-8000-000000000999'::text)),'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Unknown session accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM public.raxi_supervised_host_command(jsonb_set(owner1,'{projectRef}',to_jsonb('jrkefsylpfriiqefcmzq'::text)),'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Production project accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM public.raxi_supervised_host_command(jsonb_set(owner1,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 minute')::text)),'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Expired identity accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS: owner/workspace/session/project/expiry negative cases rejected by hosted command';
END;
$identity_qa$;
RESET ROLE;
UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second'
 WHERE id='60000000-0000-4000-8000-000000000003';
SET LOCAL ROLE service_role;
DO $revocation_qa$
BEGIN
 BEGIN
  PERFORM public.raxi_supervised_host_command(
   jsonb_build_object('provenance','SUPABASE_AUTH_STAGING',
   'actorId','60000000-0000-4000-8000-000000000002','sessionId','60000000-0000-4000-8000-000000000003',
   'workspaceId','60000000-0000-4000-8000-000000000001','projectRef','zvhxjindgyvtasstfjut',
   'expiresAt',(clock_timestamp()+interval '10 minutes')::text),'readTask',
   '{"taskId":"60000000-0000-4000-8000-000000000004"}'::jsonb);
  RAISE EXCEPTION 'Revoked/expired hosted session accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS: expired auth.sessions denies previously valid hosted command';
END;
$revocation_qa$;
SET LOCAL ROLE authenticated;
DO $auth_client_qa$
BEGIN
 BEGIN
  PERFORM public.raxi_supervised_host_command('{}'::jsonb,'readTask','{}'::jsonb);
  RAISE EXCEPTION 'Authenticated browser invoked privileged RPC';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS: authenticated browser cannot invoke host command';
END;
$auth_client_qa$;
SET LOCAL ROLE anon;
DO $anon_client_qa$
BEGIN
 BEGIN
  PERFORM public.raxi_supervised_host_command('{}'::jsonb,'readTask','{}'::jsonb);
  RAISE EXCEPTION 'Anon browser invoked privileged RPC';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 RAISE NOTICE 'PASS: anon cannot invoke host command';
END;
$anon_client_qa$;
RESET ROLE;
ROLLBACK;
DO $host_qa_rollback$
BEGIN
 IF EXISTS (SELECT 1 FROM public.raxi_workspaces WHERE slug LIKE 'host-qa-%')
   OR EXISTS (SELECT 1 FROM public.raxi_agent_tasks WHERE external_id LIKE 'HOST-QA-%')
   OR EXISTS (SELECT 1 FROM auth.sessions WHERE id IN
     ('60000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000103')) THEN
  RAISE EXCEPTION 'Fixture left persistent data'; END IF;
 RAISE NOTICE 'PASS: host identity fixture rolled back all test data';
END;
$host_qa_rollback$;
