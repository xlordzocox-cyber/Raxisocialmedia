-- Native PostgreSQL17 / isolated synthetic QA. Execute after fixture + proposal.
-- psql -v ON_ERROR_STOP=1 -X -f issue49_director_real_qa.sql
\set ON_ERROR_STOP on
create function pg_temp.expect_denied(p_label text,p_statement text) returns void
language plpgsql as $f$
begin
 begin
  execute p_statement;
 exception when sqlstate '42501' or sqlstate '23505' or sqlstate 'P0001' then
  -- Existing TASK immutability triggers raise P0001; never mistake the
  -- test helper's own FAILED exception (also P0001) for a valid denial.
  if SQLSTATE='P0001' and SQLERRM not in
   ('immutable task human approval','pilot identity and scope are immutable') then raise; end if;
  raise notice 'PASS DENIED: % [%]',p_label,SQLSTATE;
  return;
 end;
 raise exception 'FAILED: expected denial for %',p_label;
end; $f$;

insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
insert into auth.sessions(id,user_id,not_after) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '1 hour'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '1 hour'),
 ('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd',clock_timestamp()+interval '1 hour');
insert into public.raxi_workspaces(id,owner_user_id,slug,name) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','main','Main'),
 ('77777777-7777-4777-8777-777777777777','dddddddd-dddd-4ddd-8ddd-dddddddddddd','foreign','Foreign');
insert into public.raxi_runtime_policies (
 workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,
 max_tasks,max_output_tokens,expires_at
) values (
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,false,'openai','synthetic-model',
 5000,4000,1,128,clock_timestamp()+interval '50 minutes'
);

-- ACL and RLS acceptance limited to the new objects.
do $acl$
begin
 if has_table_privilege('anon','public.raxi_director_real_pilots','SELECT') or
    has_table_privilege('authenticated','public.raxi_director_real_pilots','SELECT') or
    has_table_privilege('authenticated','public.raxi_director_real_pilots','INSERT') or
    has_function_privilege('anon','public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint)','EXECUTE') or
    has_function_privilege('authenticated','public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean)','EXECUTE') or
    has_function_privilege('authenticated','public.raxi_director_real_read(jsonb,uuid)','EXECUTE') or
    has_table_privilege('service_role','public.raxi_director_real_pilots','DELETE') or
    has_table_privilege('service_role','public.raxi_director_real_pilots','TRUNCATE') or
    not has_table_privilege('service_role','public.raxi_director_real_pilots','SELECT') or
    not has_table_privilege('service_role','public.raxi_director_real_pilots','INSERT') or
    not has_table_privilege('service_role','public.raxi_director_real_pilots','UPDATE')
 then raise exception 'FAILED: public/client ACL permits real pilot actions'; end if;
 if not (select relrowsecurity from pg_class where oid='public.raxi_director_real_pilots'::regclass)
 then raise exception 'FAILED: pilot RLS disabled';end if;
 raise notice 'PASS: new table RLS and all browser roles denied';
end; $acl$;

set role service_role;
-- Verify privilege denials under the real service_role despite the bootstrap's
-- initial ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES.
select pg_temp.expect_denied('service DELETE blocked by explicit revoke',
 'delete from public.raxi_director_real_pilots where false');
select pg_temp.expect_denied('service TRUNCATE blocked by explicit revoke',
 'truncate table public.raxi_director_real_pilots');

do $qa$
declare
 owner_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 wid uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 sid uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 iden jsonb;other_session jsonb;bad_session jsonb;spec jsonb;bad_spec jsonb;
 req_key uuid:='11111111-1111-4111-8111-111111111111';
 approval_key uuid:='22222222-2222-4222-8222-222222222222';
 task_id uuid;scope text;ret jsonb;approval uuid;projection jsonb;
 before_res bigint;after_res bigint;
begin
 iden:=jsonb_build_object('provenance','SUPABASE_AUTH_STAGING','actorId',owner_id,
  'sessionId',sid,'workspaceId',wid,'projectRef','zvhxjindgyvtasstfjut',
  'expiresAt',to_char(clock_timestamp()+interval '45 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 other_session:=jsonb_set(iden,'{sessionId}',to_jsonb('ffffffff-ffff-4fff-8fff-ffffffffffff'::text));
 bad_session:=jsonb_set(iden,'{sessionId}',to_jsonb('66666666-6666-4666-8666-666666666666'::text));
 spec:=jsonb_build_object('question','Prepare an original text-only editorial brief',
  'externalResearch',false,'provider','openai','model','synthetic-model',
  'authorization',jsonb_build_object('confirmed',true,'maxCostMicros',5000,
    'expiresAt',to_char(clock_timestamp()+interval '20 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));

 -- Independent cross-language UTF-8 SHA-256 vector from JS JSON.stringify canonical fields.
 if public.raxi_director_real_scope(
  wid,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',owner_id,
  '{"question":"Write a text-only editorial brief","externalResearch":false,"provider":"openai","model":"synthetic-model","authorization":{"confirmed":true,"maxCostMicros":5000,"expiresAt":"2099-01-01T00:00:00.000Z"}}'::jsonb,1)
  <> '37be09dc2c293f94cc6b6937a631c7f7a70573111bfff7633eb4017af0524201'
 then raise exception 'FAILED: JS/PG17 scope canonical SHA parity';end if;
 raise notice 'PASS: cross-language deterministic scope digest';

 perform pg_temp.expect_denied('expired/invalid auth session',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,1)',
   bad_session::text,req_key::text,spec::text));
 perform pg_temp.expect_denied('foreign owner workspace',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,1)',
   jsonb_set(iden,'{workspaceId}',to_jsonb('77777777-7777-4777-8777-777777777777'::text))::text,
   req_key::text,spec::text));
 bad_spec:=jsonb_set(spec,'{provider}',to_jsonb('simulated'::text));
 perform pg_temp.expect_denied('simulated provider cannot enter REAL ledger',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,1)',
    iden::text,req_key::text,bad_spec::text));
 bad_spec:=jsonb_set(spec,'{externalResearch}','true'::jsonb);
 perform pg_temp.expect_denied('external research prohibited',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,1)',
    iden::text,req_key::text,bad_spec::text));
 bad_spec:=spec||'{"approve":true}'::jsonb;
 perform pg_temp.expect_denied('unknown injected field',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,1)',
    iden::text,req_key::text,bad_spec::text));
 perform pg_temp.expect_denied('policy version mismatch',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,44)',
    iden::text,req_key::text,spec::text));

 select public.raxi_director_real_prepare(iden,req_key,spec,1) into ret;
 task_id:=(ret->>'taskId')::uuid;scope:=ret->>'scopeSha256';
 if ret->>'executionEnabled'<>'false' or task_id is null or length(scope)<>64
 then raise exception 'FAILED: preparation returns executable permission'; end if;
 if (select status from public.raxi_agent_tasks where id=task_id)<>'WAITING_APPROVAL' then
  raise exception 'FAILED: task became dispatchable';end if;
 if (select input_snapshot#>>'{supervised,provenance}' from public.raxi_agent_tasks where id=task_id)
    <> 'DIRECTOR_REAL_PILOT_NOT_EXECUTABLE' then
  raise exception 'FAILED: safe task isolation provenance';end if;
 raise notice 'PASS: prepared task persisted, non-dispatchable, no provider involved';

 if (public.raxi_director_real_prepare(iden,req_key,spec,1)->>'taskId')::uuid<>task_id then
  raise exception 'FAILED: idempotency key did not retain task';end if;
 bad_spec:=jsonb_set(spec,'{question}',to_jsonb('Changed topic must conflict'::text));
 perform pg_temp.expect_denied('same request key different scope',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,1)',
    iden::text,req_key::text,bad_spec::text));
 perform pg_temp.expect_denied('second simultaneous preparation conflicts',
  format('select public.raxi_director_real_prepare(%L::jsonb,%L::uuid,%L::jsonb,1)',
    iden::text,'33333333-3333-4333-8333-333333333333',spec::text));
 if public.raxi_director_real_read(iden,task_id) is not null then
  raise exception 'FAILED: prepared without human grant has snapshot';end if;

 perform pg_temp.expect_denied('confirmed false',
  format('select public.raxi_director_real_approve(%L::jsonb,%L::uuid,%L::uuid,%L,false)',
    iden::text,task_id::text,approval_key::text,scope));
 perform pg_temp.expect_denied('scope digest forged',
  format('select public.raxi_director_real_approve(%L::jsonb,%L::uuid,%L::uuid,%L,true)',
    iden::text,task_id::text,approval_key::text,repeat('a',64)));
 perform pg_temp.expect_denied('different session cannot approve request',
  format('select public.raxi_director_real_approve(%L::jsonb,%L::uuid,%L::uuid,%L,true)',
    other_session::text,task_id::text,approval_key::text,scope));
 -- Missing a spec field yields NULL scope SHA; it MUST fail closed.
 begin
  update public.raxi_agent_tasks set
   input_snapshot=jsonb_set(input_snapshot,'{spec}',(input_snapshot->'spec')-'question')
   where id=task_id;
  perform pg_temp.expect_denied('NULL recomputed scope must deny approval',
   format('select public.raxi_director_real_approve(%L::jsonb,%L::uuid,%L::uuid,%L,true)',
     iden::text,task_id::text,approval_key::text,scope));
  raise exception 'ROLLBACK_TAMPER_FIXTURE' using errcode='P0199';
 exception when sqlstate 'P0199' then
  raise notice 'PASS: null digest denied on approval';
 end;
 -- Also reject actual persisted boolean mutations (not just missing fields).
 begin
  update public.raxi_agent_tasks set
    input_snapshot=jsonb_set(input_snapshot,'{spec,externalResearch}','true'::jsonb)
  where id=task_id;
  perform pg_temp.expect_denied('altered externalResearch TRUE cannot approve',
   format('select public.raxi_director_real_approve(%L::jsonb,%L::uuid,%L::uuid,%L,true)',
     iden::text,task_id::text,approval_key::text,scope));
  raise exception 'ROLLBACK_BOOLEAN_FIXTURE' using errcode='P0199';
 exception when sqlstate 'P0199' then raise notice 'PASS: altered externalResearch denied on approval';end;
 begin
  update public.raxi_agent_tasks set
    input_snapshot=jsonb_set(input_snapshot,'{spec,authorization,confirmed}','false'::jsonb)
  where id=task_id;
  perform pg_temp.expect_denied('altered human confirmed FALSE cannot approve',
   format('select public.raxi_director_real_approve(%L::jsonb,%L::uuid,%L::uuid,%L,true)',
     iden::text,task_id::text,approval_key::text,scope));
  raise exception 'ROLLBACK_BOOLEAN_FIXTURE' using errcode='P0199';
 exception when sqlstate 'P0199' then raise notice 'PASS: altered confirmed denied on approval';end;
 select reserved_micros into before_res from public.raxi_runtime_policies where workspace_id=wid;
 select public.raxi_director_real_approve(iden,task_id,approval_key,scope,true) into ret;
 approval:=(ret->>'approvalId')::uuid;
 if approval is null or ret->>'executionEnabled'<>'false' then
  raise exception 'FAILED: human grant missing/not inert';end if;
 select reserved_micros into after_res from public.raxi_runtime_policies where workspace_id=wid;
 if after_res-before_res<>4000 or
    (select task_count from public.raxi_runtime_policies where workspace_id=wid)<>1 or
    (select count(*) from public.raxi_approvals where subject_kind='TASK' and action='APPROVED')<>1
 then raise exception 'FAILED: durable human grant or budget conservation';end if;
 raise notice 'PASS: second human grant persisted once, 4000 microUSD reserved, no dispatch';

 if (public.raxi_director_real_approve(iden,task_id,approval_key,scope,true)->>'approvalId')::uuid<>approval
 then raise exception 'FAILED: approval idempotency';end if;
 if (select reserved_micros from public.raxi_runtime_policies where workspace_id=wid)<>4000 then
  raise exception 'FAILED: duplicate approval charged again';end if;
 perform pg_temp.expect_denied('reapproval under alternate key',
  format('select public.raxi_director_real_approve(%L::jsonb,%L::uuid,%L::uuid,%L,true)',
    iden::text,task_id::text,'44444444-4444-4444-8444-444444444444',scope));

 select public.raxi_director_real_read(iden,task_id) into projection;
 if projection is null or projection->>'state'<>'READY_FOR_MANUAL_EXECUTION' or
   projection->>'simulated'<>'false' or
   projection#>>'{approval,provenance}'<>'PERSISTED_HUMAN_EXECUTION_APPROVAL' or
   projection#>>'{policy,remainingMicros}'<>'4000' or
   projection->>'scopeSha256'<>scope
 then raise exception 'FAILED: canonical future server read mismatch';end if;
 -- Projection must also fail closed if an already-approved snapshot loses a
 -- required digest field; any mutation remains local to this subtransaction.
 begin
  update public.raxi_agent_tasks set
   input_snapshot=jsonb_set(input_snapshot,'{spec}',(input_snapshot->'spec')-'question')
   where id=task_id;
  if public.raxi_director_real_read(iden,task_id) is not null then
   raise exception 'FAILED: NULL digest admitted to canonical read';end if;
  raise exception 'ROLLBACK_TAMPER_FIXTURE' using errcode='P0199';
 exception when sqlstate 'P0199' then
  raise notice 'PASS: null digest denied on snapshot read';
 end;
 begin
  update public.raxi_agent_tasks set
   input_snapshot=jsonb_set(input_snapshot,'{spec,externalResearch}','true'::jsonb)
  where id=task_id;
  if public.raxi_director_real_read(iden,task_id) is not null then
   raise exception 'FAILED: altered research flag admitted on read';end if;
  raise exception 'ROLLBACK_BOOLEAN_FIXTURE' using errcode='P0199';
 exception when sqlstate 'P0199' then raise notice 'PASS: altered externalResearch denied on read';end;
 begin
  update public.raxi_agent_tasks set
   input_snapshot=jsonb_set(input_snapshot,'{spec,authorization,confirmed}','false'::jsonb)
  where id=task_id;
  if public.raxi_director_real_read(iden,task_id) is not null then
   raise exception 'FAILED: altered confirmed flag admitted on read';end if;
  raise exception 'ROLLBACK_BOOLEAN_FIXTURE' using errcode='P0199';
 exception when sqlstate 'P0199' then raise notice 'PASS: altered confirmed denied on read';end;
 if public.raxi_director_real_read(other_session,task_id) is not null then
  raise exception 'FAILED: other real session can access bound approval';end if;
 raise notice 'PASS: server-only canonical projection; session-bound, no executable transport';

 -- Policy rotation must revoke READ without undoing the persistent grant.
 begin
  update public.raxi_runtime_policies set model='revoked-policy-model' where workspace_id=wid;
  if public.raxi_director_real_read(iden,task_id) is not null then
   raise exception 'FAILED: policy rotation still returns grant';end if;
  raise exception 'ROLLBACK_TEST' using errcode='P0199';
 exception when sqlstate 'P0199' then
  raise notice 'PASS: policy version change invalidates readiness';
 end;
 -- Current read is back to valid after subtransaction rollback.
 if public.raxi_director_real_read(iden,task_id) is null then
  raise exception 'FAILED: rollback did not restore original policy';end if;

 perform pg_temp.expect_denied('approval is immutable',
  format('update public.raxi_approvals set action=%L where id=%L::uuid',
   'CANCELED',approval::text));
 perform pg_temp.expect_denied('pilot scope is immutable',
  format('update public.raxi_director_real_pilots set scope_sha256=%L where task_id=%L::uuid',
   repeat('b',64),task_id::text));

 -- Another session of SAME human owner can revoke, never auto refund budget.
 select public.raxi_director_real_revoke(other_session,task_id,
   '55555555-5555-4555-8555-555555555555') into ret;
 if ret->>'executionEnabled'<>'false' or public.raxi_director_real_read(iden,task_id) is not null
 then raise exception 'FAILED: revocation did not deny future reads';end if;
 if (select reserved_micros from public.raxi_runtime_policies where workspace_id=wid)<>4000 then
  raise exception 'FAILED: budget reservation incorrectly refunded';end if;
 if (select count(*) from public.raxi_approvals where subject_kind='TASK' and action='CANCELED')<>1 then
  raise exception 'FAILED: revocation audit missing';end if;
 perform pg_temp.expect_denied('revocation with another key not idempotent',
  format('select public.raxi_director_real_revoke(%L::jsonb,%L::uuid,%L::uuid)',
    other_session::text,task_id::text,'66666666-6666-4666-8666-666666666666'));
 if public.raxi_director_real_revoke(other_session,task_id,
   '55555555-5555-4555-8555-555555555555')->>'kind'<>'DIRECTOR_REAL_REVOKED' then
  raise exception 'FAILED: stable revocation replay';end if;
 if (select count(*) from public.raxi_agent_tasks where workspace_id=wid)<>1 or
    (select count(*) from public.raxi_director_real_pilots where workspace_id=wid)<>1
 then raise exception 'FAILED: unexpected task duplication';end if;
 raise notice 'PASS: second same-owner session revoked future grant; budget and audit retained';
 raise notice 'PASS: PG17 Issue49 real Director approval contract checks complete (NO RUNS)';
end; $qa$;
reset role;
