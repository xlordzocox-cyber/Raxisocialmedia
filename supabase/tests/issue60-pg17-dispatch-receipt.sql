-- Issue #60 native PostgreSQL 17 acceptance (EPHEMERAL FIXTURE ONLY).
-- No hosted Supabase, no genuine providers, and no external effects.
\set ON_ERROR_STOP on
DO $qa$
BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'Expected native PostgreSQL 17';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND rolsuper) THEN
  RAISE EXCEPTION 'Unprivileged auth roles unexpectedly superuser';
 END IF;
 IF has_function_privilege('authenticated','public.raxi_runtime_dispatch_receipt()','EXECUTE')
    OR has_function_privilege('anon','public.raxi_runtime_dispatch_receipt()','EXECUTE')
    OR has_function_privilege('authenticated','public.raxi_runtime_step(uuid,uuid,text,jsonb,text,bigint)','EXECUTE')
    OR has_table_privilege('authenticated','public.raxi_agent_runs','UPDATE') THEN
  RAISE EXCEPTION 'Unsafe native runtime grants';
 END IF;
 IF has_table_privilege('service_role','public.raxi_agent_runs','DELETE')
    OR has_table_privilege('service_role','public.raxi_agent_runs','TRUNCATE')
    OR has_table_privilege('service_role','public.raxi_agent_runs','REFERENCES')
    OR has_table_privilege('service_role','public.raxi_agent_runs','TRIGGER')
    OR has_table_privilege('service_role','public.raxi_runtime_policies','DELETE')
    OR has_table_privilege('service_role','public.raxi_runtime_policies','TRUNCATE')
    OR has_table_privilege('service_role','public.raxi_runtime_policies','INSERT')
    OR has_column_privilege('service_role','public.raxi_runtime_policies','provider','UPDATE')
    OR has_column_privilege('service_role','public.raxi_agent_runs','lease_until','UPDATE')
    OR has_column_privilege('service_role','public.raxi_agent_runs','lease_token','UPDATE')
    OR has_column_privilege('service_role','public.raxi_agent_runs','lease_token','INSERT')
    OR NOT has_column_privilege('service_role','public.raxi_agent_runs','status','UPDATE')
    OR NOT has_column_privilege('service_role','public.raxi_agent_runs','workspace_id','INSERT')
    OR NOT has_column_privilege('service_role','public.raxi_runtime_policies','reserved_micros','UPDATE')
    OR NOT has_column_privilege('service_role','public.raxi_runtime_policies','task_count','UPDATE') THEN
  RAISE EXCEPTION 'Runtime service_role exceeds required column privileges';
 END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname='raxi_runtime_dispatch_receipt' AND NOT tgisinternal) <> 1 THEN
  RAISE EXCEPTION 'Expected exactly one installed dispatch trigger';
 END IF;
 RAISE NOTICE 'PASS: PG17 version, runtime trigger and role privileges';
END
$qa$;

-- Fixture-only admin helper. Never install this helper on hosted databases.
-- Service role cannot UPDATE lease_until directly, while the lab must still
-- simulate a stale lease to verify the trigger's fail-closed behavior.
create function pg_temp.raxi_qa_expire_lease(p_run uuid) returns void
language sql security definer set search_path='' as $fixture$
 update public.raxi_agent_runs
 set lease_until=clock_timestamp()-interval '1 second' where id=p_run;
$fixture$;
revoke all on function pg_temp.raxi_qa_expire_lease(uuid) from public,anon,authenticated;
grant execute on function pg_temp.raxi_qa_expire_lease(uuid) to service_role;

-- Fixture identities deliberately non-sensitive and never real credentials.
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name)
VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'qa-pg17-isolated','QA PG17 Isolated');
INSERT INTO public.raxi_runtime_policies(
 workspace_id,enabled,simulated,provider,model,total_budget_micros,
 per_call_micros,max_tasks,expires_at
) VALUES (
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,false,'fixture-no-contact',
 'fixture-model',100,10,3,clock_timestamp()+interval '25 minutes'
);

-- All test writes, including runtime dispatch and audit, are rolled back.
BEGIN;
SET LOCAL ROLE service_role;
DO $qa$
DECLARE
 v_task uuid; v_claim jsonb; v_run uuid; v_token uuid;
 v_event record; v_count integer; v_status text; v_receipt text;
BEGIN
 v_task:=public.raxi_runtime_request(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  jsonb_build_object('question','Offline PG17 fixture dispatch without external provider',
    'externalResearch',false,'provider','fixture-no-contact','model','fixture-model',
    'authorization',jsonb_build_object('confirmed',true,'maxCostMicros',20,
     'expiresAt',clock_timestamp()+interval '10 minutes'))
 );
 v_claim:=public.raxi_runtime_claim(v_task,'ci-pg17-offline-only');
 IF v_claim IS NULL THEN RAISE EXCEPTION 'Native claim missing'; END IF;
 v_run:=(v_claim#>>'{run,id}')::uuid;
 v_token:=(v_claim#>>'{run,lease_token}')::uuid;
 IF v_run IS NULL OR v_token IS NULL THEN RAISE EXCEPTION 'Missing run or lease'; END IF;
 IF EXISTS(SELECT 1 FROM public.raxi_agent_events WHERE task_id=v_task AND event_type='RUNTIME_DISPATCH_AUTHORIZED') THEN
  RAISE EXCEPTION 'Dispatch event appeared before authorized step';
 END IF;
 -- Combined RUNNING+dispatch mutation must not bypass receipt validation.
 BEGIN
  UPDATE public.raxi_agent_runs
   SET status='RUNNING',dispatch_authorized_at=clock_timestamp() WHERE id=v_run;
  RAISE EXCEPTION 'Combined status and dispatch unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 IF (SELECT status FROM public.raxi_agent_runs WHERE id=v_run)<>'CLAIMED' OR
    EXISTS(SELECT 1 FROM public.raxi_agent_events
           WHERE task_id=v_task AND event_type='RUNTIME_DISPATCH_AUTHORIZED') THEN
  RAISE EXCEPTION 'Denied combined mutation persisted state or event';
 END IF;
 RAISE NOTICE 'PASS: combined status and dispatch bypass denied';
 -- A privileged direct UPDATE is not proof of an authorized dispatch when policy is revoked.
 BEGIN
  UPDATE public.raxi_runtime_policies SET enabled=false
   WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  UPDATE public.raxi_agent_runs SET dispatch_authorized_at=clock_timestamp() WHERE id=v_run;
  RAISE EXCEPTION 'Revoked direct dispatch unexpectedly admitted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%authorization expired or revoked%' THEN RAISE; END IF;
 END;
 -- Direct privileged edits to protected columns must fail (including forged scope or lease).
 BEGIN
  UPDATE public.raxi_agent_runs SET lease_until=clock_timestamp()+interval '30 minutes' WHERE id=v_run;
  RAISE EXCEPTION 'Direct lease extension unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  UPDATE public.raxi_runtime_policies SET provider='forged-model'
   WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  RAISE EXCEPTION 'Direct provider policy mutation unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  DELETE FROM public.raxi_agent_runs WHERE id=v_run;
  RAISE EXCEPTION 'Direct runtime ledger deletion unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 RAISE NOTICE 'PASS: prohibited direct lease, provider and delete privileges denied';
 -- A stale lease must also be denied even if table UPDATE is attempted directly.
 BEGIN
  PERFORM pg_temp.raxi_qa_expire_lease(v_run);
  UPDATE public.raxi_agent_runs SET dispatch_authorized_at=clock_timestamp() WHERE id=v_run;
  RAISE EXCEPTION 'Expired direct dispatch unexpectedly admitted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%invalid dispatch authority or lease%' THEN RAISE; END IF;
 END;
 IF EXISTS (SELECT 1 FROM public.raxi_agent_events WHERE task_id=v_task
  AND event_type='RUNTIME_DISPATCH_AUTHORIZED') THEN
  RAISE EXCEPTION 'Denied direct updates created events';
 END IF;
 RAISE NOTICE 'PASS: revoked/expired direct SQL writes fail closed';
 PERFORM public.raxi_runtime_step(v_run,v_token,'dispatch');

 SELECT count(*) INTO v_count FROM public.raxi_agent_events
 WHERE task_id=v_task AND event_type='RUNTIME_DISPATCH_AUTHORIZED';
 IF v_count<>1 THEN RAISE EXCEPTION 'Expected one durable event, got %',v_count; END IF;
 SELECT source_kind,evidence_status,payload INTO v_event
 FROM public.raxi_agent_events WHERE task_id=v_task AND event_type='RUNTIME_DISPATCH_AUTHORIZED';
 -- The labels below are only synthetic fixture rows, NEVER proof of genuine model execution.
 IF v_event.source_kind<>'AGENT_EXECUTOR' OR v_event.evidence_status<>'VERIFIED'
 OR v_event.payload->>'phase'<>'DISPATCH_AUTHORIZED'
 OR v_event.payload->>'providerAcknowledged'<>'false'
 OR v_event.payload->>'operationalReceiptOnly'<>'true'
 OR v_event.payload->>'simulated'<>'false' THEN
  RAISE EXCEPTION 'Dispatch receipt semantic mismatch';
 END IF;
 SELECT status,provider_receipt INTO v_status,v_receipt
 FROM public.raxi_agent_runs WHERE id=v_run;
 IF v_status<>'CLAIMED' OR v_receipt IS NOT NULL THEN
  RAISE EXCEPTION 'Dispatch improperly asserted provider ACK';
 END IF;
 IF (SELECT status FROM public.raxi_agent_tasks WHERE id=v_task)<>'QUEUED' THEN
  RAISE EXCEPTION 'Dispatch improperly started task';
 END IF;
 SELECT count(*) INTO v_count FROM public.raxi_audit_events
 WHERE action='RUNTIME_DISPATCH_AUTHORIZED' AND resource_id=v_run::text;
 IF v_count<>1 THEN RAISE EXCEPTION 'Dispatch audit row absent/duplicate'; END IF;
 RAISE NOTICE 'PASS: native dispatch has exactly one event and audit, no provider ACK';
 -- Once audited, the dispatch timestamp is immutable; no new receipt can be minted.
 BEGIN
  UPDATE public.raxi_agent_runs SET dispatch_authorized_at=NULL WHERE id=v_run;
  RAISE EXCEPTION 'Dispatch timestamp reset unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 BEGIN
  UPDATE public.raxi_agent_runs
   SET dispatch_authorized_at=clock_timestamp()+interval '1 second' WHERE id=v_run;
  RAISE EXCEPTION 'Dispatch timestamp replacement unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 IF (SELECT count(*) FROM public.raxi_agent_events
     WHERE task_id=v_task AND event_type='RUNTIME_DISPATCH_AUTHORIZED')<>1 OR
    (SELECT count(*) FROM public.raxi_audit_events
     WHERE action='RUNTIME_DISPATCH_AUTHORIZED' AND resource_id=v_run::text)<>1 THEN
  RAISE EXCEPTION 'Forged duplicate receipt or audit';
 END IF;
 RAISE NOTICE 'PASS: audited timestamp is immutable and receipts stay unique';


 BEGIN
  PERFORM public.raxi_runtime_step(v_run,v_token,'dispatch');
  RAISE EXCEPTION 'Duplicate dispatch unexpectedly accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%dispatch already admitted%' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.raxi_agent_events WHERE task_id=v_task
     AND event_type='RUNTIME_DISPATCH_AUTHORIZED')<>1 THEN
  RAISE EXCEPTION 'Duplicate mutated event ledger';
 END IF;
 IF (SELECT count(*) FROM public.raxi_audit_events WHERE action='RUNTIME_DISPATCH_AUTHORIZED'
     AND resource_id=v_run::text)<>1 THEN
  RAISE EXCEPTION 'Duplicate mutated audit ledger';
 END IF;
 RAISE NOTICE 'PASS: repeated dispatch rejected without duplicate effects';
END
$qa$;

-- Verify owner-only projection through an unprivileged authenticated role.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
 '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","is_anonymous":false}',true);
DO $qa$
DECLARE v_snapshot jsonb;
BEGIN
 v_snapshot:=public.raxi_runtime_office('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 IF v_snapshot->>'ownerId'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 OR jsonb_array_length(v_snapshot->'events')<>1
 OR v_snapshot->'events'->0->>'event_type'<>'RUNTIME_DISPATCH_AUTHORIZED'
 OR jsonb_array_length(v_snapshot->'tasks')<>1 THEN
  RAISE EXCEPTION 'Workspace owner projection mismatch';
 END IF;
 RAISE NOTICE 'PASS: authenticated owner reads scoped event, without provider ACK';
END
$qa$;
SELECT set_config('request.jwt.claims',
 '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","is_anonymous":false}',true);
DO $qa$
BEGIN
 BEGIN
  PERFORM public.raxi_runtime_office('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  RAISE EXCEPTION 'Foreign viewer unexpectedly authorized';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 RAISE NOTICE 'PASS: foreign viewer denied';
END
$qa$;
SELECT set_config('request.jwt.claims',
 '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","is_anonymous":true}',true);
DO $qa$
BEGIN
 BEGIN
  PERFORM public.raxi_runtime_office('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  RAISE EXCEPTION 'Anonymous viewer unexpectedly authorized';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
 RAISE NOTICE 'PASS: anonymous viewer denied';
END
$qa$;
ROLLBACK;

DO $qa$
BEGIN
 IF EXISTS(SELECT 1 FROM public.raxi_agent_events WHERE event_type='RUNTIME_DISPATCH_AUTHORIZED')
 OR EXISTS(SELECT 1 FROM public.raxi_audit_events WHERE action='RUNTIME_DISPATCH_AUTHORIZED')
 OR EXISTS(SELECT 1 FROM public.raxi_agent_runs)
 OR EXISTS(SELECT 1 FROM public.raxi_agent_tasks WHERE input_snapshot->>'runtime'='true')
 OR EXISTS(SELECT 1 FROM public.raxi_approvals WHERE subject_kind='TASK')
 OR EXISTS(SELECT 1 FROM public.raxi_runtime_policies WHERE reserved_micros<>0 OR task_count<>0) THEN
  RAISE EXCEPTION 'Native SQL rollback left effects';
 END IF;
 RAISE NOTICE 'PASS: rollback atomically removed tasks, receipts, audits and reservations';
END
$qa$;
