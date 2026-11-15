-- ISSUE #49 / PROPOSAL ONLY / PostgreSQL 17 test candidate.
-- DO NOT place in supabase/migrations or execute on hosted staging/production.
-- No runtime worker, claim, dispatch, provider, scheduler, network or runOne.
-- Depends on existing hosted raxi_supervised_host_identity(jsonb), existing
-- workspaces, task, approvals and policy tables. Keep simulated path untouched.
--
-- Real tasks remain WAITING_APPROVAL even after this separate human grant.
-- They are NOT accepted by raxi_supervised_host_command's simulated-only path.
-- A future independently authorized migration must bind and dispatch them.

create table public.raxi_director_real_pilots (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
 task_id uuid not null,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,
 request_key uuid not null,
 scope_sha256 text not null check (scope_sha256 ~ '^[a-f0-9]{64}$'),
 policy_version bigint not null check(policy_version>0),
 provider text not null check(provider ~ '^[a-z0-9-]{1,50}$' and provider<>'simulated'),
 model text not null check(model ~ '^[A-Za-z0-9._-]{1,100}$'),
 max_cost_micros bigint not null check(max_cost_micros>0),
 reserved_micros bigint not null default 0 check(reserved_micros>=0),
 expires_at timestamptz not null,
 status text not null default 'WAITING_HUMAN_EXECUTION_AUTH'
  check(status in ('WAITING_HUMAN_EXECUTION_AUTH','READY_FOR_MANUAL_EXECUTION','REVOKED')),
 approval_id uuid,
 approval_key uuid,
 revoke_id uuid,
 revoke_key uuid,
 created_at timestamptz not null default clock_timestamp(),
 approved_at timestamptz,
 revoked_at timestamptz,
 unique(workspace_id,request_key),
 unique(workspace_id,task_id),
 foreign key(workspace_id,task_id) references public.raxi_agent_tasks(workspace_id,id) on delete restrict,
 foreign key(workspace_id,approval_id) references public.raxi_approvals(workspace_id,id) on delete restrict,
 foreign key(workspace_id,revoke_id) references public.raxi_approvals(workspace_id,id) on delete restrict,
 check ((status='READY_FOR_MANUAL_EXECUTION' and approval_id is not null and approval_key is not null and
         approved_at is not null and reserved_micros>0 and revoked_at is null)
        or (status='WAITING_HUMAN_EXECUTION_AUTH' and approval_id is null and
            reserved_micros=0 and revoked_at is null)
        or (status='REVOKED' and revoke_id is not null and revoke_key is not null and revoked_at is not null))
);
create unique index raxi_director_real_one_pending
 on public.raxi_director_real_pilots(workspace_id)
 where status in ('WAITING_HUMAN_EXECUTION_AUTH','READY_FOR_MANUAL_EXECUTION');

alter table public.raxi_director_real_pilots enable row level security;
-- Supabase's pg17-bootstrap grants ALL new table privileges to service_role
-- by DEFAULT; revoke them first so DELETE/TRUNCATE cannot erase immutable gates.
revoke all on public.raxi_director_real_pilots from public,anon,authenticated,service_role;
grant select,insert,update on public.raxi_director_real_pilots to service_role;

-- The record cannot be silently rebound to another identity/scope/price.
create function public.raxi_director_real_protect() returns trigger
 language plpgsql security invoker set search_path='' as $f$
begin
 if (to_jsonb(new)-array['status','approval_id','approval_key','revoke_id','revoke_key','approved_at','revoked_at','reserved_micros'])
  is distinct from
    (to_jsonb(old)-array['status','approval_id','approval_key','revoke_id','revoke_key','approved_at','revoked_at','reserved_micros'])
 then raise exception 'pilot identity and scope are immutable' using errcode='42501'; end if;
 -- A legitimate revocation MUST preserve the historical approval reference,
 -- approval timestamp and conservative budget reservation. UPDATE is available
 -- to service_role, so the state CHECK alone is not sufficient.
 if old.status='READY_FOR_MANUAL_EXECUTION' and
   row(new.approval_id,new.approval_key,new.approved_at,new.reserved_micros)
     is distinct from
   row(old.approval_id,old.approval_key,old.approved_at,old.reserved_micros)
 then
  raise exception 'approved pilot grant and reservation are immutable' using errcode='42501';
 end if;
 if old.status='WAITING_HUMAN_EXECUTION_AUTH' and new.status='REVOKED' and
  (new.approval_id is not null or new.approval_key is not null or
   new.approved_at is not null or new.reserved_micros<>0)
 then
  raise exception 'unapproved revocation cannot invent a grant' using errcode='42501';
 end if;
 if old.status='REVOKED' or
    (old.status='READY_FOR_MANUAL_EXECUTION' and new.status<>'REVOKED') or
    (old.status='WAITING_HUMAN_EXECUTION_AUTH' and new.status not in ('READY_FOR_MANUAL_EXECUTION','REVOKED'))
 then raise exception 'invalid pilot state transition' using errcode='42501'; end if;
 return new;
end; $f$;
create trigger raxi_director_real_protect
 before update on public.raxi_director_real_pilots
 for each row execute function public.raxi_director_real_protect();

-- Exact counterpart of firstRealDirectorPilot.ts scopeDigest canonical field order.
-- All JSON string values are quoted by to_json(TEXT), not jsonb::text key sorting.
-- Canonical expiresAt bytes are the literal spec string, NOT a timestamptz reformat.
create function public.raxi_director_real_scope(
 p_workspace uuid,p_task uuid,p_actor uuid,p_spec jsonb,p_version bigint
) returns text language sql immutable security invoker set search_path='' as $f$
select case when
  jsonb_typeof(p_spec) is distinct from 'object' or
  (select count(*) from jsonb_object_keys(p_spec))<>5 or
  exists(select 1 from jsonb_object_keys(p_spec) k
   where k not in ('question','externalResearch','provider','model','authorization')) or
  jsonb_typeof(p_spec->'question') is distinct from 'string' or
  length(btrim(p_spec->>'question'))<5 or length(p_spec->>'question')>1500 or
  p_spec->'externalResearch' is distinct from 'false'::jsonb or
  jsonb_typeof(p_spec->'provider') is distinct from 'string' or
  jsonb_typeof(p_spec->'model') is distinct from 'string' or
  jsonb_typeof(p_spec->'authorization') is distinct from 'object' or
  (select count(*) from jsonb_object_keys(p_spec->'authorization'))<>3 or
  exists(select 1 from jsonb_object_keys(p_spec->'authorization') k
   where k not in ('confirmed','maxCostMicros','expiresAt')) or
  p_spec#>'{authorization,confirmed}' is distinct from 'true'::jsonb or
  jsonb_typeof(p_spec#>'{authorization,maxCostMicros}') is distinct from 'number' or
  (p_spec#>>'{authorization,maxCostMicros}') !~ '^[1-9][0-9]{0,14}$' or
  jsonb_typeof(p_spec#>'{authorization,expiresAt}') is distinct from 'string'
 then null::text
 else encode(sha256(convert_to(
 '{"workspaceId":'||to_json(p_workspace::text)::text||
 ',"taskId":'||to_json(p_task::text)::text||
 ',"actorId":'||to_json(p_actor::text)::text||
 ',"stage":"DIRECTOR","spec":{"question":'||to_json(p_spec->>'question')::text||
 ',"externalResearch":false,"provider":'||to_json(p_spec->>'provider')::text||
 ',"model":'||to_json(p_spec->>'model')::text||
 ',"authorization":{"confirmed":true,"maxCostMicros":'||(p_spec#>>'{authorization,maxCostMicros}')::bigint::text||
 ',"expiresAt":'||to_json(p_spec#>>'{authorization,expiresAt}')::text||
 '}},"policyVersion":'||p_version::text||'}','UTF8')),'hex') end;
$f$;

create function public.raxi_director_real_prepare(
 p_identity jsonb,p_request_key uuid,p_spec jsonb,p_expected_policy_version bigint
) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare v_actor uuid; v_session uuid; v_workspace uuid; pol public.raxi_runtime_policies;
 existing public.raxi_director_real_pilots; t public.raxi_agent_tasks;
 v_exp timestamptz; v_max bigint; v_scope text;
begin
 if current_user<>'service_role' then raise exception 'server only' using errcode='42501'; end if;
 perform public.raxi_supervised_host_identity(p_identity);
 v_actor:=(p_identity->>'actorId')::uuid;
 v_session:=(p_identity->>'sessionId')::uuid;
 v_workspace:=(p_identity->>'workspaceId')::uuid;
 if p_request_key is null or p_expected_policy_version is null or
   jsonb_typeof(p_spec) is distinct from 'object' or
   (select count(*) from jsonb_object_keys(p_spec))<>5 or
   exists(select 1 from jsonb_object_keys(p_spec) k where k not in
     ('question','externalResearch','provider','model','authorization')) or
   jsonb_typeof(p_spec->'authorization') is distinct from 'object' or
   (select count(*) from jsonb_object_keys(p_spec->'authorization'))<>3 or
   exists(select 1 from jsonb_object_keys(p_spec->'authorization') k
     where k not in ('confirmed','maxCostMicros','expiresAt')) or
   jsonb_typeof(p_spec->'question') is distinct from 'string' or
   length(btrim(p_spec->>'question'))<5 or length(p_spec->>'question')>1500 or
   octet_length(p_spec::text)>8192 or
   p_spec->'externalResearch' is distinct from 'false'::jsonb or
   p_spec#>'{authorization,confirmed}' is distinct from 'true'::jsonb or
   jsonb_typeof(p_spec->'provider') is distinct from 'string' or
   p_spec->>'provider' !~ '^[a-z0-9-]{1,50}$' or
   p_spec->>'provider'='simulated' or
   jsonb_typeof(p_spec->'model') is distinct from 'string' or
   p_spec->>'model' !~ '^[A-Za-z0-9._-]{1,100}$' or
   jsonb_typeof(p_spec#>'{authorization,maxCostMicros}') is distinct from 'number' or
   jsonb_typeof(p_spec#>'{authorization,expiresAt}') is distinct from 'string'
 then raise exception 'closed real Director text-only scope required' using errcode='42501'; end if;
 begin
  v_max:=(p_spec#>>'{authorization,maxCostMicros}')::bigint;
  v_exp:=(p_spec#>>'{authorization,expiresAt}')::timestamptz;
 exception when others then raise exception 'invalid cost or expiry' using errcode='42501'; end;
 if v_max<=0 or v_exp<=clock_timestamp()+interval '60 seconds' or
   v_exp>clock_timestamp()+interval '24 hours'
 then raise exception 'limited positive budget and expiry required' using errcode='42501'; end if;
 -- Serialize all preparations per workspace and reject foreign-owner workspace.
 perform 1 from public.raxi_workspaces
 where id=v_workspace and owner_user_id=v_actor for update;
 if not found then raise exception 'workspace ownership denied' using errcode='42501'; end if;
 select * into existing from public.raxi_director_real_pilots
 where workspace_id=v_workspace and request_key=p_request_key;
 if found then
  select * into t from public.raxi_agent_tasks where id=existing.task_id and workspace_id=v_workspace;
  if existing.actor_user_id<>v_actor or existing.session_id<>v_session or
     existing.policy_version<>p_expected_policy_version or
     t.input_snapshot->'spec' is distinct from p_spec
  then raise exception 'idempotency scope conflict' using errcode='42501'; end if;
  return jsonb_build_object('kind','DIRECTOR_REAL_PREPARED_NOT_EXECUTABLE',
   'taskId',t.id,'status',existing.status,'scopeSha256',existing.scope_sha256,
   'executionEnabled',false);
 end if;
 select * into pol from public.raxi_runtime_policies where workspace_id=v_workspace for update;
 if not found or pol.enabled is distinct from true or pol.simulated is distinct from false or
   pol.authorization_version<>p_expected_policy_version or
   pol.provider is distinct from p_spec->>'provider' or pol.model is distinct from p_spec->>'model' or
   pol.per_call_micros<=0 or pol.per_call_micros>v_max or pol.total_budget_micros<v_max or
   pol.reserved_micros+pol.per_call_micros>pol.total_budget_micros or
   pol.task_count>=pol.max_tasks or pol.max_tasks<>1 or pol.max_output_tokens>256 or
   pol.expires_at<=v_exp or pol.expires_at<=clock_timestamp()+interval '60 seconds'
 then raise exception 'real pilot policy is disabled or incompatible' using errcode='42501'; end if;
 insert into public.raxi_agent_tasks(workspace_id,external_id,title,status,input_snapshot)
 values(v_workspace,'DIRECTOR-REAL-'||p_request_key::text,'Director real pilot (NOT EXECUTABLE)',
  'WAITING_APPROVAL',jsonb_build_object('runtime',true,'spec',p_spec,
   'supervised',jsonb_build_object('provenance','DIRECTOR_REAL_PILOT_NOT_EXECUTABLE',
    'stage','DIRECTOR','actorId',v_actor,'sessionId',v_session)))
 returning * into t;
 v_scope:=public.raxi_director_real_scope(v_workspace,t.id,v_actor,p_spec,pol.authorization_version);
 insert into public.raxi_director_real_pilots(
  workspace_id,task_id,actor_user_id,session_id,request_key,scope_sha256,policy_version,
  provider,model,max_cost_micros,expires_at)
 values(v_workspace,t.id,v_actor,v_session,p_request_key,v_scope,pol.authorization_version,
  pol.provider,pol.model,v_max,v_exp);
 return jsonb_build_object('kind','DIRECTOR_REAL_PREPARED_NOT_EXECUTABLE',
  'taskId',t.id,'status','WAITING_HUMAN_EXECUTION_AUTH','scopeSha256',v_scope,
  'executionEnabled',false);
end; $f$;

create function public.raxi_director_real_approve(
 p_identity jsonb,p_task_id uuid,p_approval_key uuid,p_scope_sha256 text,p_confirmed boolean
) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare v_actor uuid; v_session uuid; v_workspace uuid;
 g public.raxi_director_real_pilots; p public.raxi_runtime_policies;
 t public.raxi_agent_tasks; v_approval uuid;
begin
 if current_user<>'service_role' then raise exception 'server only' using errcode='42501'; end if;
 perform public.raxi_supervised_host_identity(p_identity);
 v_actor:=(p_identity->>'actorId')::uuid;
 v_session:=(p_identity->>'sessionId')::uuid;
 v_workspace:=(p_identity->>'workspaceId')::uuid;
 if p_task_id is null or p_approval_key is null or
   p_scope_sha256 is null or p_scope_sha256 !~ '^[a-f0-9]{64}$'
   or p_confirmed is distinct from true
 then raise exception 'second explicit human confirmation required' using errcode='42501'; end if;
 perform 1 from public.raxi_workspaces where id=v_workspace and owner_user_id=v_actor for update;
 if not found then raise exception 'owner denied' using errcode='42501'; end if;
 select * into g from public.raxi_director_real_pilots
 where workspace_id=v_workspace and task_id=p_task_id for update;
 if not found or g.actor_user_id<>v_actor or g.session_id<>v_session or
   g.scope_sha256 is distinct from p_scope_sha256
 then raise exception 'scope/session mismatch' using errcode='42501'; end if;
 if g.status='READY_FOR_MANUAL_EXECUTION' and g.approval_key=p_approval_key then
  return jsonb_build_object('kind','DIRECTOR_REAL_APPROVED_NOT_EXECUTABLE',
   'taskId',g.task_id,'approvalId',g.approval_id,'executionEnabled',false);
 end if;
 if g.status<>'WAITING_HUMAN_EXECUTION_AUTH' then
  raise exception 'cannot reapprove a used or revoked grant' using errcode='42501'; end if;
 select * into t from public.raxi_agent_tasks where id=g.task_id and workspace_id=g.workspace_id for update;
 if not found or t.status<>'WAITING_APPROVAL' or
    t.input_snapshot#>>'{supervised,provenance}' is distinct from 'DIRECTOR_REAL_PILOT_NOT_EXECUTABLE' or
    g.scope_sha256 is distinct from public.raxi_director_real_scope(v_workspace,t.id,v_actor,
      t.input_snapshot->'spec',g.policy_version)
 then raise exception 'task snapshot changed' using errcode='42501'; end if;
 select * into p from public.raxi_runtime_policies where workspace_id=v_workspace for update;
 if not found or p.enabled is distinct from true or p.simulated is distinct from false or
    p.authorization_version<>g.policy_version or p.provider<>g.provider or
    p.model<>g.model or p.max_tasks<>1 or p.task_count<>0 or p.max_output_tokens>256 or
    p.per_call_micros<=0 or p.per_call_micros>g.max_cost_micros or
    p.reserved_micros+p.per_call_micros>p.total_budget_micros or
    p.expires_at<=clock_timestamp()+interval '60 seconds' or
    g.expires_at<=clock_timestamp()+interval '60 seconds'
 then raise exception 'policy changed or budget not available' using errcode='42501'; end if;
 insert into public.raxi_approvals(
   workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
 values(v_workspace,'TASK',t.id,'APPROVED',v_actor,
   'DIRECTOR-REAL-APPROVE:'||p_approval_key::text,
   jsonb_build_object('kind','PERSISTED_HUMAN_EXECUTION_APPROVAL',
    'scopeSha256',g.scope_sha256,'sessionId',v_session,'policyVersion',g.policy_version,
    'provider',g.provider,'model',g.model,'maxCostMicros',g.max_cost_micros,
    'expiresAt',g.expires_at))
 returning id into v_approval;
 update public.raxi_runtime_policies set
   reserved_micros=reserved_micros+p.per_call_micros,task_count=task_count+1
 where workspace_id=v_workspace;
 update public.raxi_director_real_pilots set
   status='READY_FOR_MANUAL_EXECUTION',approval_id=v_approval,
   approval_key=p_approval_key,approved_at=clock_timestamp(),
   reserved_micros=p.per_call_micros
 where id=g.id;
 return jsonb_build_object('kind','DIRECTOR_REAL_APPROVED_NOT_EXECUTABLE',
  'taskId',g.task_id,'approvalId',v_approval,'executionEnabled',false);
end; $f$;

create function public.raxi_director_real_revoke(
 p_identity jsonb,p_task_id uuid,p_revoke_key uuid
) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare v_actor uuid; v_workspace uuid; g public.raxi_director_real_pilots; rid uuid;
begin
 if current_user<>'service_role' then raise exception 'server only' using errcode='42501'; end if;
 perform public.raxi_supervised_host_identity(p_identity);
 v_actor:=(p_identity->>'actorId')::uuid;
 v_workspace:=(p_identity->>'workspaceId')::uuid;
 if p_task_id is null or p_revoke_key is null then
  raise exception 'revoke requires explicit key' using errcode='42501'; end if;
 perform 1 from public.raxi_workspaces where id=v_workspace and owner_user_id=v_actor for update;
 if not found then raise exception 'owner denied' using errcode='42501'; end if;
 select * into g from public.raxi_director_real_pilots
 where workspace_id=v_workspace and task_id=p_task_id for update;
 if not found or g.actor_user_id<>v_actor then
  raise exception 'task denied' using errcode='42501'; end if;
 if g.status='REVOKED' and g.revoke_key=p_revoke_key then
  return jsonb_build_object('kind','DIRECTOR_REAL_REVOKED','taskId',g.task_id,'executionEnabled',false);
 end if;
 if g.status='REVOKED' then raise exception 'revocation replay conflict' using errcode='42501'; end if;
 insert into public.raxi_approvals(
  workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
 values(v_workspace,'TASK',g.task_id,'CANCELED',v_actor,
  'DIRECTOR-REAL-REVOKE:'||p_revoke_key::text,
  jsonb_build_object('kind','DIRECTOR_REAL_PERMISSION_REVOKED','scopeSha256',g.scope_sha256))
 returning id into rid;
 update public.raxi_director_real_pilots set
  status='REVOKED',revoke_id=rid,revoke_key=p_revoke_key,revoked_at=clock_timestamp()
 where id=g.id;
 -- NEVER refund reserved_micros here: future paid-call uncertainty must be reconciled.
 return jsonb_build_object('kind','DIRECTOR_REAL_REVOKED','taskId',g.task_id,'executionEnabled',false);
end; $f$;

-- Read-only projection for a FUTURE server port, not a dispatch capability.
create function public.raxi_director_real_read(
 p_identity jsonb,p_task_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare v_actor uuid; v_session uuid; v_workspace uuid;
 g public.raxi_director_real_pilots; t public.raxi_agent_tasks;
 a public.raxi_approvals; p public.raxi_runtime_policies;
begin
 if current_user<>'service_role' then raise exception 'server only' using errcode='42501'; end if;
 perform public.raxi_supervised_host_identity(p_identity);
 v_actor:=(p_identity->>'actorId')::uuid;
 v_session:=(p_identity->>'sessionId')::uuid;
 v_workspace:=(p_identity->>'workspaceId')::uuid;
 select * into g from public.raxi_director_real_pilots
 where workspace_id=v_workspace and task_id=p_task_id and actor_user_id=v_actor
 and session_id=v_session and status='READY_FOR_MANUAL_EXECUTION';
 if not found or g.expires_at<=clock_timestamp()+interval '60 seconds' then return null; end if;
 select * into t from public.raxi_agent_tasks where id=p_task_id and workspace_id=v_workspace;
 select * into p from public.raxi_runtime_policies where workspace_id=v_workspace;
 select * into a from public.raxi_approvals where id=g.approval_id and workspace_id=v_workspace;
 if t.id is null or t.status<>'WAITING_APPROVAL' or
    t.input_snapshot#>>'{supervised,provenance}' is distinct from 'DIRECTOR_REAL_PILOT_NOT_EXECUTABLE' or
    p.workspace_id is null or not p.enabled or p.simulated or
    p.authorization_version<>g.policy_version or p.provider<>g.provider or p.model<>g.model or
    p.expires_at<=clock_timestamp()+interval '60 seconds' or
    a.id is null or a.subject_kind<>'TASK' or a.subject_id<>t.id or
    a.action<>'APPROVED' or a.actor_user_id<>v_actor or
    a.context->>'scopeSha256' is distinct from g.scope_sha256 or
    a.context->>'sessionId' is distinct from v_session::text or
    a.context->>'policyVersion' is distinct from g.policy_version::text or
    g.scope_sha256 is distinct from public.raxi_director_real_scope(v_workspace,t.id,v_actor,
      t.input_snapshot->'spec',g.policy_version)
 then return null; end if;
 return jsonb_build_object(
 'provenance','TRUSTED_SERVER_SNAPSHOT','taskId',t.id,'workspaceId',v_workspace,
 'stage','DIRECTOR','simulated',false,'state','READY_FOR_MANUAL_EXECUTION',
 'spec',t.input_snapshot->'spec','scopeSha256',g.scope_sha256,
 'approval',jsonb_build_object(
  'provenance','PERSISTED_HUMAN_EXECUTION_APPROVAL',
  'taskId',t.id,'workspaceId',v_workspace,'operatorId',v_actor,
  'sessionId',v_session,'decision','APPROVED','revoked',false,
  'scopeSha256',g.scope_sha256,'policyVersion',g.policy_version,
  'provider',g.provider,'model',g.model,'maxCostMicros',g.max_cost_micros,
  'issuedAt',a.decided_at,'expiresAt',g.expires_at),
 'policy',jsonb_build_object(
  'workspaceId',v_workspace,'version',p.authorization_version,'enabled',true,
  'simulated',false,'provider',p.provider,'model',p.model,
  'perCallMicros',g.reserved_micros,'remainingMicros',g.reserved_micros,
  'maxOutputTokens',p.max_output_tokens,'expiresAt',p.expires_at)
 );
end; $f$;

-- Explicit ACL: never expose these objects/functions to browser JWT roles.
revoke all on function public.raxi_director_real_protect() from public,anon,authenticated;
revoke all on function public.raxi_director_real_scope(uuid,uuid,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.raxi_director_real_revoke(jsonb,uuid,uuid) from public,anon,authenticated;
revoke all on function public.raxi_director_real_read(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.raxi_director_real_protect() to service_role;
grant execute on function public.raxi_director_real_scope(uuid,uuid,uuid,jsonb,bigint) to service_role;
grant execute on function public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint) to service_role;
grant execute on function public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean) to service_role;
grant execute on function public.raxi_director_real_revoke(jsonb,uuid,uuid) to service_role;
grant execute on function public.raxi_director_real_read(jsonb,uuid) to service_role;
