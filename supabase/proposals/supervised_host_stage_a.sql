-- LOCAL STAGE A PROPOSAL ONLY. Apply only inside local tests after agent_runtime.sql.
-- No new ledger: task snapshots, approvals, runs and append-only agent events are reused.
alter table public.raxi_agent_runs add column journal_version integer not null default 0;
create unique index raxi_supervised_journal_operation on public.raxi_agent_events(workspace_id,source_ref)
 where source_ref like 'SUPERVISED_JOURNAL:%';

-- Extension seams: A still accepts LOCAL_FIXTURE only. B replaces these helpers,
-- not the coordinator, ledger, budget transitions or journal/digest implementation.
create function public.raxi_supervised_identity() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('provenance','LOCAL_FIXTURE') $$;
create function public.raxi_supervised_binding_origin(b jsonb) returns text language plpgsql security invoker set search_path='' as $$
begin
 if b->>'provenance' is distinct from 'LOCAL_FIXTURE' then raise exception 'binding denied' using errcode='P1901'; end if;
 return 'LOCAL_FIXTURE';
end; $$;
create function public.raxi_supervised_authorize_binding(t public.raxi_agent_tasks) returns void language plpgsql security invoker set search_path='' as $$
begin perform public.raxi_supervised_binding_origin(t.input_snapshot->'supervised'); end; $$;

-- One validation path for SQL replay and repository reads. Digest uses PostgreSQL's
-- canonical jsonb text, exactly as persistence does; no competing JS serializer.
create function public.raxi_supervised_validate_journal(p_event public.raxi_agent_events) returns void
language plpgsql security invoker set search_path='' as $$
declare c jsonb; f jsonb; r public.raxi_agent_runs; t public.raxi_agent_tasks; v integer; expected_status text;
begin
 if current_user<>'service_role' then raise exception 'server required' using errcode='42501'; end if;
 c:=p_event.payload->'command'; f:=p_event.payload->'confirmation';
 if p_event.event_type is distinct from 'SUPERVISED_LOCAL_JOURNAL'
  or p_event.source_kind is distinct from 'MOCK' or p_event.evidence_status is distinct from 'UNVERIFIED'
  or p_event.payload->'simulated' is distinct from 'true'::jsonb
  or jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(f) is distinct from 'object'
  or coalesce(c->>'kind','') not in ('dispatch','ack','finish','unknown')
  or jsonb_typeof(c->'expectedVersion') is distinct from 'number'
  or coalesce(c->>'expectedVersion','') !~ '^[0-9]{1,10}$'
  or coalesce(f->>'journal_digest','') !~ '^[a-f0-9]{64}$'
  or f->>'journal_digest' is distinct from encode(sha256(convert_to(c::text,'UTF8')),'hex')
  or coalesce(p_event.payload->>'confirmationDigest','') !~ '^[a-f0-9]{64}$'
  or p_event.payload->>'confirmationDigest' is distinct from encode(sha256(convert_to(f::text,'UTF8')),'hex')
 then raise exception 'journal integrity conflict' using errcode='P1901'; end if;
 if (c->>'expectedVersion')::bigint>=2147483647 then raise exception 'journal integrity conflict' using errcode='P1901'; end if;
 v:=(c->>'expectedVersion')::integer+1;
 select * into r from public.raxi_agent_runs where id::text=f->>'id';
 if not found then raise exception 'journal integrity conflict' using errcode='P1901'; end if;
 select * into t from public.raxi_agent_tasks where id=r.task_id;
 if p_event.payload->>'provenance' is distinct from public.raxi_supervised_binding_origin(t.input_snapshot->'supervised')
 then raise exception 'journal integrity conflict' using errcode='P1901'; end if;
 expected_status:=case c->>'kind' when 'dispatch' then 'CLAIMED' when 'ack' then 'RUNNING' when 'finish' then 'SUCCEEDED' else 'UNKNOWN' end;
 if not found or not r.simulated or p_event.workspace_id is distinct from r.workspace_id
  or p_event.task_id is distinct from r.task_id or p_event.agent_id is distinct from r.agent_id
  or p_event.source_ref is distinct from 'SUPERVISED_JOURNAL:'||r.id::text||':'||(c->>'kind')
  or p_event.payload->>'runId' is distinct from r.id::text or p_event.payload->>'stage' is distinct from r.stage
  or f->>'workspace_id' is distinct from r.workspace_id::text or f->>'task_id' is distinct from r.task_id::text
  or f->>'agent_id' is distinct from r.agent_id::text or f->>'stage' is distinct from r.stage
  or f->'simulated' is distinct from 'true'::jsonb or f ? 'lease_token'
  or f->>'status' is distinct from expected_status or f->'journal_version' is distinct from to_jsonb(v)
  or v>r.journal_version
 then raise exception 'journal integrity conflict' using errcode='P1901'; end if;
 if c->>'kind'='finish' and (
  r.status<>'SUCCEEDED' or c->'result' is distinct from f->'result' or f->'result' is distinct from r.result
  or c->'cost' is distinct from f->'cost_micros' or f->'cost_micros' is distinct from coalesce(to_jsonb(r.cost_micros),'null'::jsonb)
  or f->>'provider_receipt' is distinct from r.provider_receipt)
 then raise exception 'journal integrity conflict' using errcode='P1901'; end if;
end; $$;

create function public.raxi_supervised_protect_journal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.event_type='SUPERVISED_LOCAL_JOURNAL' or old.source_ref like 'SUPERVISED_JOURNAL:%'
  then raise exception 'supervised journal is append-only' using errcode='42501'; end if;
 if tg_op='UPDATE' and (new.event_type='SUPERVISED_LOCAL_JOURNAL' or new.source_ref like 'SUPERVISED_JOURNAL:%')
  then raise exception 'cannot relabel an event as supervised journal' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create trigger raxi_supervised_journal_immutable before update or delete on public.raxi_agent_events
 for each row execute function public.raxi_supervised_protect_journal();
-- TRUNCATE bypasses DELETE row triggers; it is not a runtime capability.
revoke truncate on public.raxi_agent_events from public,anon,authenticated,service_role;

create function public.raxi_supervised_assert(p_task public.raxi_agent_tasks) returns void
language plpgsql security invoker set search_path='' as $$
declare p public.raxi_runtime_policies; a public.raxi_approvals; b jsonb; parent public.raxi_agent_runs;
begin
 if current_user<>'service_role' then raise exception 'server required'; end if;
 b:=p_task.input_snapshot->'supervised';
 perform public.raxi_supervised_authorize_binding(p_task);
 if b->>'stage' is null or b->>'stage' not in ('DIRECTOR','RESEARCHER') then raise exception 'local binding required'; end if;
 select * into p from public.raxi_runtime_policies where workspace_id=p_task.workspace_id for share;
 if not found or not p.enabled or not p.simulated or p.provider<>'simulated' or p.max_output_tokens>256 or p.expires_at<=clock_timestamp()
  or (to_jsonb(p)-array['reserved_micros','task_count']) is distinct from ((p_task.input_snapshot->'policy')-array['reserved_micros','task_count'])
  or p_task.input_snapshot#>>'{spec,provider}' is distinct from p.provider
  or p_task.input_snapshot#>>'{spec,model}' is distinct from p.model
  or p_task.input_snapshot#>>'{spec,externalResearch}' is distinct from 'false'
  or p_task.input_snapshot#>>'{spec,authorization,expiresAt}' is null
  or (p_task.input_snapshot#>>'{spec,authorization,expiresAt}')::timestamptz<=clock_timestamp()
  or (p_task.input_snapshot#>>'{spec,authorization,expiresAt}')::timestamptz>p.expires_at
  or (p_task.input_snapshot#>>'{spec,authorization,maxCostMicros}')::bigint<p.per_call_micros
  or p.reserved_micros>p.total_budget_micros then raise exception 'local policy expired or changed'; end if;
 select * into a from public.raxi_approvals where id=nullif(b->>'approvalId','')::uuid and workspace_id=p_task.workspace_id
  and subject_kind='TASK' and subject_id=p_task.id and action='APPROVED';
 if not found or a.context->>'scopeDigest' is distinct from b->>'scopeDigest'
  or a.context->>'provenance' is distinct from b->>'provenance'
  or exists(select 1 from public.raxi_approvals r where r.workspace_id=p_task.workspace_id and r.subject_id=p_task.id
    and r.subject_kind='TASK' and r.action='REJECTED' and r.context->>'revokes'=a.id::text)
  or not exists(select 1 from public.raxi_workspaces w where w.id=p_task.workspace_id and w.owner_user_id=a.actor_user_id)
 then raise exception 'independent approval required or revoked'; end if;
 if b->>'stage'='RESEARCHER' then
  select * into parent from public.raxi_agent_runs where id=(b->>'parentRunId')::uuid and workspace_id=p_task.workspace_id
   and stage='DIRECTOR' and status='SUCCEEDED' and simulated and task_id<>p_task.id;
  if not found or encode(sha256(convert_to(parent.result::text,'UTF8')),'hex') is distinct from b->>'parentDigest'
   then raise exception 'confirmed Director dependency required'; end if;
 end if;
end; $$;

create function public.raxi_supervised_prepare(p_actor uuid,p_workspace uuid,p_key uuid,p_stage text,p_spec jsonb,p_request text,p_parent uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.raxi_agent_tasks; p public.raxi_runtime_policies; parent public.raxi_agent_runs; b jsonb; d text;
begin
 if current_user<>'service_role' then raise exception 'server required'; end if;
 perform 1 from public.raxi_workspaces where id=p_workspace and owner_user_id=p_actor for update;
 if not found then raise exception 'owner required'; end if;
 if p_key is null or p_stage is null or p_stage not in ('DIRECTOR','RESEARCHER') or octet_length(p_request)>8192 or p_request::jsonb is distinct from p_spec
  or jsonb_typeof(p_spec->'question') is distinct from 'string'
  or jsonb_typeof(p_spec->'externalResearch') is distinct from 'boolean'
  or jsonb_typeof(p_spec->'authorization') is distinct from 'object'
  or jsonb_typeof(p_spec#>'{authorization,confirmed}') is distinct from 'boolean'
  or jsonb_typeof(p_spec#>'{authorization,expiresAt}') is distinct from 'string'
  or coalesce(length(p_spec->>'question'),0) not between 5 and 1500 or p_spec->>'provider' is distinct from 'simulated'
  or p_spec->>'externalResearch' is distinct from 'false' or p_spec#>>'{authorization,confirmed}' is distinct from 'true'
  or jsonb_typeof(p_spec#>'{authorization,maxCostMicros}') is distinct from 'number'
  or (p_spec#>>'{authorization,maxCostMicros}')::bigint not between 0 and 10000
  or exists(select 1 from jsonb_object_keys(p_spec) k where k not in ('question','externalResearch','provider','model','authorization'))
  or exists(select 1 from jsonb_object_keys(p_spec->'authorization') k where k not in ('confirmed','maxCostMicros','expiresAt'))
  or (p_stage='DIRECTOR' and p_parent is not null) or (p_stage='RESEARCHER' and p_parent is null)
 then raise exception 'local scope required'; end if;
 select * into t from public.raxi_agent_tasks where workspace_id=p_workspace and external_id='SUPERVISED-'||p_key::text;
 if found then
  if t.input_snapshot->'spec' is distinct from p_spec or t.input_snapshot#>>'{supervised,stage}' is distinct from p_stage
   or nullif(t.input_snapshot#>>'{supervised,parentRunId}','')::uuid is distinct from p_parent
   or t.input_snapshot#>>'{supervised,requestSha256}' is distinct from encode(sha256(convert_to(p_request,'UTF8')),'hex')
   then raise exception 'idempotency conflict'; end if;
  return to_jsonb(t);
 end if;
 select * into p from public.raxi_runtime_policies where workspace_id=p_workspace;
 if not found or not p.enabled or not p.simulated or p.provider<>'simulated' or p.max_output_tokens>256 or p_spec->>'model' is distinct from p.model
  or p.expires_at<=clock_timestamp() or (p_spec#>>'{authorization,expiresAt}')::timestamptz<=clock_timestamp()
  or (p_spec#>>'{authorization,expiresAt}')::timestamptz>p.expires_at then raise exception 'local policy required'; end if;
 if p_parent is not null then
  select * into parent from public.raxi_agent_runs where id=p_parent and workspace_id=p_workspace and stage='DIRECTOR' and status='SUCCEEDED' and simulated;
  if not found then raise exception 'confirmed Director required'; end if;
 end if;
 b:=public.raxi_supervised_identity()||jsonb_build_object('stage',p_stage,'parentRunId',p_parent,
   'parentDigest',case when p_parent is not null then encode(sha256(convert_to(parent.result::text,'UTF8')),'hex') else null end,
   'requestSha256',encode(sha256(convert_to(p_request,'UTF8')),'hex'));
 d:=encode(sha256(convert_to(jsonb_build_object('workspace',p_workspace,'key',p_key,'binding',b,'spec',p_spec,'policyVersion',p.authorization_version)::text,'UTF8')),'hex');
 b:=b||jsonb_build_object('scopeDigest',d);
 insert into public.raxi_agent_tasks(workspace_id,external_id,title,status,input_snapshot)
 values(p_workspace,'SUPERVISED-'||p_key::text,'LOCAL SIMULATION '||p_stage,'WAITING_APPROVAL',
  jsonb_build_object('runtime',true,'spec',p_spec,'policy',to_jsonb(p),'supervised',b)) returning * into t;
 insert into public.raxi_audit_events(workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,details)
 values(p_workspace,case when b->>'provenance'='LOCAL_FIXTURE' then 'SUPERVISED_LOCAL_PREPARED' else 'SUPERVISED_STAGING_PREPARED' end,'HUMAN',p_actor,'TASK',t.id::text,jsonb_build_object('provenance',b->>'provenance','scopeDigest',d));
 return to_jsonb(t);
end; $$;

create function public.raxi_supervised_approve(p_actor uuid,p_task uuid,p_key uuid,p_digest text,p_revoke boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.raxi_agent_tasks; p public.raxi_runtime_policies; a public.raxi_approvals; aid uuid; b jsonb; action_name text;
begin
 if current_user<>'service_role' or p_key is null or p_revoke is null then raise exception 'server and command required'; end if;
 select * into t from public.raxi_agent_tasks where id=p_task for update;
 if not found or not exists(select 1 from public.raxi_workspaces where id=t.workspace_id and owner_user_id=p_actor)
  or t.input_snapshot#>>'{supervised,scopeDigest}' is distinct from p_digest then raise exception 'owner or scope denied'; end if;
 b:=t.input_snapshot->'supervised'; action_name:=case when p_revoke then 'REJECTED' else 'APPROVED' end;
 select * into a from public.raxi_approvals where workspace_id=t.workspace_id and idempotency_key='SUPERVISED-'||p_key::text;
 if found then
  if a.subject_id<>p_task or a.action<>action_name or a.context->>'scopeDigest' is distinct from p_digest then raise exception 'approval idempotency conflict'; end if;
  return to_jsonb(t);
 end if;
 if p_revoke then
  if b->>'approvalId' is null then raise exception 'no approval to revoke'; end if;
 else
  if t.status<>'WAITING_APPROVAL' or b->>'approvalId' is not null then raise exception 'one approval per task'; end if;
  select * into p from public.raxi_runtime_policies where workspace_id=t.workspace_id for update;
  if not found or not p.enabled or not p.simulated or p.provider<>'simulated' or p.expires_at<=clock_timestamp()
   or (to_jsonb(p)-array['reserved_micros','task_count']) is distinct from ((t.input_snapshot->'policy')-array['reserved_micros','task_count'])
   or (t.input_snapshot#>>'{spec,authorization,expiresAt}')::timestamptz<=clock_timestamp()
   or p.reserved_micros+p.per_call_micros>p.total_budget_micros or p.task_count>=p.max_tasks
   or (t.input_snapshot#>>'{spec,authorization,maxCostMicros}')::bigint<p.per_call_micros then raise exception 'scope or budget denied'; end if;
 end if;
 insert into public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
 values(t.workspace_id,'TASK',p_task,action_name,p_actor,'SUPERVISED-'||p_key::text,
  jsonb_build_object('scopeDigest',p_digest,'provenance',b->>'provenance','revokes',b->>'approvalId')) returning id into aid;
 if not p_revoke then
  update public.raxi_agent_tasks set status='QUEUED',input_snapshot=jsonb_set(input_snapshot,'{supervised,approvalId}',to_jsonb(aid::text)) where id=p_task returning * into t;
  perform public.raxi_supervised_assert(t);
  update public.raxi_runtime_policies set reserved_micros=reserved_micros+per_call_micros,task_count=task_count+1 where workspace_id=t.workspace_id;
 end if;
 insert into public.raxi_audit_events(workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,details)
 values(t.workspace_id,(case when b->>'provenance'='LOCAL_FIXTURE' then 'SUPERVISED_LOCAL_' else 'SUPERVISED_STAGING_' end)||action_name,'HUMAN',p_actor,'TASK',p_task::text,jsonb_build_object('approvalId',aid,'provenance',b->>'provenance'));
 return to_jsonb(t);
end; $$;

create function public.raxi_supervised_step(p_actor uuid,p_run uuid,p_token uuid,p_operation text,p_version integer,p_kind text,p_result jsonb,p_receipt text,p_cost bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.raxi_agent_runs; t public.raxi_agent_tasks; e public.raxi_agent_events; command jsonb; result jsonb;
begin
 if current_user<>'service_role' then raise exception 'server required'; end if;
 select * into r from public.raxi_agent_runs where id=p_run;
 select * into t from public.raxi_agent_tasks where id=r.task_id for update;
 select * into r from public.raxi_agent_runs where id=p_run for update;
 perform public.raxi_supervised_binding_origin(t.input_snapshot->'supervised');
 if r.id is null or not r.simulated
  or r.lease_token is distinct from p_token or not exists(select 1 from public.raxi_workspaces where id=r.workspace_id and owner_user_id=p_actor)
  or p_kind is null or p_kind not in ('dispatch','ack','finish','unknown') or p_operation is distinct from p_run::text||':'||p_kind
  or (p_cost is not null and p_cost<>0) or (p_receipt is not null and p_receipt is distinct from 'SIMULATED:'||p_run::text)
  or (p_kind='finish' and p_result->>'simulated' is distinct from 'true')
  then raise exception 'local run required'; end if;
 command:=jsonb_build_object('kind',p_kind,'result',p_result,'receipt',p_receipt,'cost',p_cost,'expectedVersion',p_version);
 select * into e from public.raxi_agent_events where workspace_id=r.workspace_id and source_ref='SUPERVISED_JOURNAL:'||p_operation;
 if found then
  perform public.raxi_supervised_validate_journal(e);
  if e.payload->'command' is distinct from command then raise exception 'journal idempotency conflict'; end if;
  return e.payload->'confirmation';
 end if;
 if r.journal_version<>p_version then raise exception 'journal version conflict'; end if;
 result:=public.raxi_runtime_step(p_run,p_token,p_kind,p_result,p_receipt,p_cost);
 update public.raxi_agent_runs set journal_version=journal_version+1 where id=p_run;
 result:=result||jsonb_build_object('journal_version',p_version+1,'journal_digest',encode(sha256(convert_to(command::text,'UTF8')),'hex'));
 insert into public.raxi_agent_events(workspace_id,agent_id,task_id,event_type,source_kind,evidence_status,source_ref,occurred_at,payload)
 values(r.workspace_id,r.agent_id,r.task_id,'SUPERVISED_LOCAL_JOURNAL','MOCK','UNVERIFIED','SUPERVISED_JOURNAL:'||p_operation,clock_timestamp(),
  jsonb_build_object('command',command,'confirmation',result-'lease_token',
   'confirmationDigest',encode(sha256(convert_to((result-'lease_token')::text,'UTF8')),'hex'),
   'runId',p_run,'stage',r.stage,'simulated',true,'provenance',t.input_snapshot#>>'{supervised,provenance}')) returning * into e;
 perform public.raxi_supervised_validate_journal(e);
 return e.payload->'confirmation';
end; $$;

create unique index raxi_supervised_execution_key on public.raxi_agent_tasks(workspace_id,(input_snapshot#>>'{supervised,executeKey}'))
 where input_snapshot#>>'{supervised,executeKey}' is not null;
create function public.raxi_supervised_execute_key(p_actor uuid,p_task uuid,p_key uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare t public.raxi_agent_tasks;
begin
 if current_user<>'service_role' or p_key is null then raise exception 'server and key required'; end if;
 select * into t from public.raxi_agent_tasks where id=p_task for update;
 if not found or not exists(select 1 from public.raxi_workspaces where id=t.workspace_id and owner_user_id=p_actor)
  then raise exception 'owner required'; end if;
 perform public.raxi_supervised_binding_origin(t.input_snapshot->'supervised');
 if t.input_snapshot#>>'{supervised,executeKey}' is not null then
  if t.input_snapshot#>>'{supervised,executeKey}' is distinct from p_key::text then raise exception 'execution key conflict'; end if;
  return;
 end if;
 perform public.raxi_supervised_assert(t);
 if t.status<>'QUEUED' then raise exception 'task not executable'; end if;
 update public.raxi_agent_tasks set input_snapshot=jsonb_set(input_snapshot,'{supervised,executeKey}',to_jsonb(p_key::text)) where id=p_task;
end; $$;

-- No browser/anonymous capability; local query ports are trusted test infrastructure only.
revoke all on function public.raxi_supervised_assert(public.raxi_agent_tasks),
 public.raxi_supervised_identity(),public.raxi_supervised_binding_origin(jsonb),public.raxi_supervised_authorize_binding(public.raxi_agent_tasks),
 public.raxi_supervised_validate_journal(public.raxi_agent_events),
 public.raxi_supervised_protect_journal(),
 public.raxi_supervised_prepare(uuid,uuid,uuid,text,jsonb,text,uuid),
 public.raxi_supervised_approve(uuid,uuid,uuid,text,boolean),
 public.raxi_supervised_step(uuid,uuid,uuid,text,integer,text,jsonb,text,bigint),
 public.raxi_supervised_execute_key(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.raxi_supervised_assert(public.raxi_agent_tasks),
 public.raxi_supervised_identity(),public.raxi_supervised_binding_origin(jsonb),public.raxi_supervised_authorize_binding(public.raxi_agent_tasks),
 public.raxi_supervised_validate_journal(public.raxi_agent_events),
 public.raxi_supervised_prepare(uuid,uuid,uuid,text,jsonb,text,uuid),
 public.raxi_supervised_approve(uuid,uuid,uuid,text,boolean),
 public.raxi_supervised_step(uuid,uuid,uuid,text,integer,text,jsonb,text,bigint),
 public.raxi_supervised_execute_key(uuid,uuid,uuid) to service_role;
