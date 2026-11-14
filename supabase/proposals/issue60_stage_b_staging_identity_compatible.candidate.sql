-- PROPOSAL ONLY: apply only after separate staged migration approval.
-- Based on supervised_host_stage_b.sql blob d3b358c55ea6234fca8234a8db2a4a522ad233f6
-- Preserve existing strict PR59 raxi_supervised_host_identity(jsonb).
-- B1 PROPOSAL ONLY. No migration, deployment or project-isolation attestation.
-- Dependencies: the four v0.9 migrations, agent_runtime.sql, supervised_host_stage_a.sql.
-- campaign_strategy_pending_review (migration 5) is independent and NOT required.
-- Reuses A's transactions, reservations, versions, digests, immutable journal and audit.
-- Runtime roles: anon/authenticated NO EXECUTE; service_role trusted server only,
-- bypasses RLS, explicit ownership/session required; postgres deployment/test admin only.
-- All functions INVOKER, empty search_path. No new ledger, table or SECURITY DEFINER.
-- auth.sessions.not_after and auth.users.is_anonymous must be inventoried in B2.
grant usage on schema auth to service_role;
grant select(id,user_id,not_after) on auth.sessions to service_role;
grant select(id,is_anonymous) on auth.users to service_role;

-- Staging-only compatibility adapter: preserve the PR59 identity
-- function and its exact projectRef/session validation. No replacement.
do $issue60_staging_identity$
declare f_oid oid;
begin
 f_oid:=to_regprocedure('public.raxi_supervised_host_identity(jsonb)');
 if f_oid is null then
  raise exception 'PR59 staging identity missing; refuse Stage B compatibility SQL'
   using errcode='42501';
 end if;
 if (select prosecdef from pg_proc where oid=f_oid) then
  raise exception 'staging identity unexpectedly SECURITY DEFINER'
   using errcode='42501';
 end if;
 if not has_function_privilege('service_role',f_oid,'EXECUTE')
  or has_function_privilege('anon',f_oid,'EXECUTE')
  or has_function_privilege('authenticated',f_oid,'EXECUTE')
  or position('zvhxjindgyvtasstfjut' in pg_get_functiondef(f_oid))=0 then
  raise exception 'staging identity ACL or projectRef inconsistent'
   using errcode='42501';
 end if;
end;
$issue60_staging_identity$;

create or replace function public.raxi_supervised_identity() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i jsonb;
begin
 if current_user<>'service_role' then raise exception 'server required'; end if;
 i:=nullif(current_setting('raxi.supervised_identity',true),'')::jsonb;
 -- A remains a local fixture. B entrypoint always sets and validates transaction-local context.
 if i is null then return jsonb_build_object('provenance','LOCAL_FIXTURE'); end if;
 perform public.raxi_supervised_host_identity(i);
 return jsonb_build_object('provenance','SUPABASE_AUTH_STAGING','identity',i);
end; $$;

create or replace function public.raxi_supervised_binding_origin(b jsonb) returns text
language plpgsql security invoker set search_path='' as $$
begin
 if b->>'provenance'='LOCAL_FIXTURE' then return 'LOCAL_FIXTURE'; end if;
 if b->>'provenance' is distinct from 'SUPABASE_AUTH_STAGING'
  or b#>>'{identity,provenance}' is distinct from 'SUPABASE_AUTH_STAGING'
  or coalesce(b#>>'{identity,projectRef}','') !~ '^[a-z]{20}$'
  or b#>>'{identity,projectRef}'='jrkefsylpfriiqefcmzq'
  or b#>>'{identity,actorId}' is null or b#>>'{identity,sessionId}' is null
  or b#>>'{identity,workspaceId}' is null or b#>>'{identity,expiresAt}' is null
 then raise exception 'journal binding conflict' using errcode='P1901'; end if;
 return 'SUPABASE_AUTH_STAGING';
end; $$;

create or replace function public.raxi_supervised_authorize_binding(t public.raxi_agent_tasks) returns void
language plpgsql security invoker set search_path='' as $$
declare b jsonb;
begin
 b:=t.input_snapshot->'supervised';
 if public.raxi_supervised_binding_origin(b)='SUPABASE_AUTH_STAGING' then
  if b#>>'{identity,workspaceId}' is distinct from t.workspace_id::text then raise exception 'workspace denied'; end if;
  perform public.raxi_supervised_host_identity(b->'identity');
 end if;
end; $$;

-- Sole hosted write/read entrypoint: trusted server identity, never a browser RPC.
create function public.raxi_supervised_host_command(p_identity jsonb,p_action text,p_args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.raxi_agent_tasks; r public.raxi_agent_runs; e public.raxi_agent_events; result jsonb; permitted text[]; receipt_only boolean;
begin
 if current_user<>'service_role' then raise exception 'server required' using errcode='42501'; end if;
 if p_identity->>'provenance' is distinct from 'SUPABASE_AUTH_STAGING' then raise exception 'hosted identity required'; end if;
 permitted:=case p_action
  when 'prepare' then array['key','stage','spec','parentRunId']
  when 'approve' then array['taskId','key','scopeDigest','revoke']
  when 'readTask' then array['taskId'] when 'claim' then array['taskId','worker']
  when 'step' then array['runId','token','kind','result','receipt','cost']
  when 'bindExecution' then array['taskId','key'] when 'reconcile' then array['taskId','operationId'] end;
 if permitted is null or jsonb_typeof(p_args) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_args) k where not(k=any(permitted)))
 then raise exception 'closed command required'; end if;
 receipt_only:=p_action='step' and p_args->>'kind' in ('ack','finish','unknown');
 -- Receipt capture after an admitted effect must survive revocation/expiry. Ownership,
 -- session binding and lease still apply below; it never permits another dispatch.
 if not coalesce(receipt_only,false) then perform public.raxi_supervised_host_identity(p_identity); end if;
 perform set_config('raxi.supervised_identity',p_identity::text,true);
 if p_action='prepare' then
  result:=public.raxi_supervised_prepare((p_identity->>'actorId')::uuid,(p_identity->>'workspaceId')::uuid,
   (p_args->>'key')::uuid,p_args->>'stage',p_args->'spec',(p_args->'spec')::text,(p_args->>'parentRunId')::uuid);
  if result#>>'{input_snapshot,supervised,identity,sessionId}' is distinct from p_identity->>'sessionId'
   or result#>>'{input_snapshot,supervised,provenance}' is distinct from 'SUPABASE_AUTH_STAGING'
  then raise exception 'preparation session conflict'; end if;
  return result;
 end if;
 if p_action='step' then
  select * into r from public.raxi_agent_runs where id=(p_args->>'runId')::uuid;
  select * into t from public.raxi_agent_tasks where id=r.task_id;
 else select * into t from public.raxi_agent_tasks where id=(p_args->>'taskId')::uuid; end if;
 if t.id is null or t.workspace_id::text is distinct from p_identity->>'workspaceId'
  or t.input_snapshot#>>'{supervised,provenance}' is distinct from 'SUPABASE_AUTH_STAGING'
  or t.input_snapshot#>>'{supervised,identity,actorId}' is distinct from p_identity->>'actorId'
  or t.input_snapshot#>>'{supervised,identity,sessionId}' is distinct from p_identity->>'sessionId'
  or t.input_snapshot#>>'{supervised,identity,projectRef}' is distinct from p_identity->>'projectRef'
  or not exists(select 1 from public.raxi_workspaces where id=t.workspace_id and owner_user_id=(p_identity->>'actorId')::uuid)
 then raise exception 'task identity denied' using errcode='42501'; end if;
 case p_action
 when 'readTask' then return to_jsonb(t);
 when 'approve' then return public.raxi_supervised_approve((p_identity->>'actorId')::uuid,t.id,(p_args->>'key')::uuid,p_args->>'scopeDigest',(p_args->>'revoke')::boolean);
 when 'bindExecution' then
  perform public.raxi_supervised_execute_key((p_identity->>'actorId')::uuid,t.id,(p_args->>'key')::uuid);return 'true'::jsonb;
 when 'claim' then
  if t.input_snapshot#>>'{supervised,executeKey}' is null then raise exception 'manual execution command required'; end if;
  return public.raxi_runtime_claim(t.id,p_args->>'worker');
 when 'step' then return public.raxi_supervised_step((p_identity->>'actorId')::uuid,r.id,(p_args->>'token')::uuid,
  r.id::text||':'||(p_args->>'kind'),
  coalesce((select (payload#>>'{command,expectedVersion}')::integer from public.raxi_agent_events where workspace_id=t.workspace_id and source_ref='SUPERVISED_JOURNAL:'||r.id::text||':'||(p_args->>'kind')),r.journal_version),
  p_args->>'kind',nullif(p_args->'result','null'::jsonb),p_args->>'receipt',(p_args->>'cost')::bigint);
 when 'reconcile' then
  select * into r from public.raxi_agent_runs where id=split_part(p_args->>'operationId',':',1)::uuid and task_id=t.id and workspace_id=t.workspace_id;
  if r.id is null or p_args->>'operationId' not in (r.id::text||':dispatch',r.id::text||':ack',r.id::text||':finish',r.id::text||':unknown') then raise exception 'operation denied'; end if;
  select * into e from public.raxi_agent_events where workspace_id=t.workspace_id and source_ref='SUPERVISED_JOURNAL:'||(p_args->>'operationId');
  if not found then return jsonb_build_object('status','MISSING','confirmation',null); end if;
  begin
   perform public.raxi_supervised_validate_journal(e);
   return jsonb_build_object('status','FOUND','confirmation',e.payload->'confirmation');
  exception when sqlstate 'P1901' then return jsonb_build_object('status','CONFLICT','confirmation',null); end;
 else raise exception 'unsupported action'; end case;
end; $$;
revoke all on function public.raxi_supervised_host_identity(jsonb),public.raxi_supervised_host_command(jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.raxi_supervised_host_identity(jsonb),public.raxi_supervised_host_command(jsonb,text,jsonb) to service_role;
-- service_role remains a trusted administrative capability, not a row-isolated tenant.
-- postgres can disable triggers; no hash claims to defend against that administrator.
