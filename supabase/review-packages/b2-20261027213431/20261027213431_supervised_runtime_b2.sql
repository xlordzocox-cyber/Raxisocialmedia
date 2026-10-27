-- GENERATED REVIEW CANDIDATE ONLY: NOT A CLI MIGRATION; DO NOT APPLY
-- Candidate base: 271f33d294b5dcdf7b36f6abae31baeb962d3820
-- CLI migration version: UNASSIGNED
-- Sources remain authoritative; regenerate offline, never edit this artifact by hand.

-- SOURCE agent_runtime; SHA256(LF) 36114c12797976ebfc0afdf94ca59c6a0c3dd11b184efdc5c83803b4eeefcb8c
-- PROPOSAL ONLY. Not in migrations/: no deployment or production authorization.
-- Depends on the existing v0.9 core; independent of campaign-command migration 5.
create table public.raxi_runtime_policies (
 workspace_id uuid primary key references public.raxi_workspaces(id),
 enabled boolean not null default false, simulated boolean not null default true,
 authorization_version bigint not null default 1 check(authorization_version>0),
 provider text not null, model text not null,
 total_budget_micros bigint not null check(total_budget_micros>=0),
 reserved_micros bigint not null default 0 check(reserved_micros>=0),
 per_call_micros bigint not null check(per_call_micros>=0),
 max_tasks integer not null default 1 check(max_tasks between 1 and 100),
 task_count integer not null default 0, max_output_tokens integer not null default 256 check(max_output_tokens between 32 and 1024),
 expires_at timestamptz not null, check(reserved_micros<=total_budget_micros)
);
create function public.raxi_runtime_policy_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.reserved_micros<old.reserved_micros or new.task_count<old.task_count then
  raise exception 'runtime reservation accounting is monotonic';
 end if;
 new.authorization_version:=old.authorization_version;
 if (to_jsonb(new)-array['authorization_version','reserved_micros','task_count']) is distinct from
    (to_jsonb(old)-array['authorization_version','reserved_micros','task_count']) then
  new.authorization_version:=old.authorization_version+1;
 end if;
 return new;
end; $$;
create trigger raxi_runtime_policy_version before update on public.raxi_runtime_policies for each row execute function public.raxi_runtime_policy_version();
create table public.raxi_agent_runs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 task_id uuid not null, agent_id uuid not null, stage text not null check(stage in ('DIRECTOR','RESEARCHER')),
 attempt integer not null default 1 check(attempt=1), -- uncertain paid effects require reconciliation, never automatic replay
 status text not null check(status in ('CLAIMED','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 simulated boolean not null, provider text not null, model text not null,
 lease_token uuid not null default gen_random_uuid(), lease_until timestamptz not null,
 worker_id text not null check(length(worker_id) between 1 and 128),
 reserved_micros bigint not null check(reserved_micros>=0), cost_micros bigint check(cost_micros>=0),
 provider_receipt text, result jsonb, dispatch_authorized_at timestamptz, created_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(workspace_id,task_id) references public.raxi_agent_tasks(workspace_id,id),
 foreign key(workspace_id,agent_id) references public.raxi_agent_profiles(workspace_id,id), unique(task_id,stage,attempt)
);
create unique index raxi_runtime_one_active on public.raxi_agent_runs(task_id) where status in ('CLAIMED','RUNNING');
create unique index raxi_runtime_agent_one_active on public.raxi_agent_runs(agent_id) where status in ('CLAIMED','RUNNING');
create index raxi_runtime_runs_scope on public.raxi_agent_runs(workspace_id,created_at);
alter table public.raxi_runtime_policies enable row level security;
alter table public.raxi_agent_runs enable row level security;
revoke all on public.raxi_runtime_policies,public.raxi_agent_runs from public,anon,authenticated;
-- Lease tokens/worker credentials are deliberately not exposed to authenticated clients.
grant all on public.raxi_runtime_policies,public.raxi_agent_runs to service_role;
alter table public.raxi_approvals drop constraint raxi_approvals_subject_kind_check;
alter table public.raxi_approvals add constraint raxi_approvals_subject_kind_check check(subject_kind in ('IDEA','CAMPAIGN','STRATEGY','JOB','ASSET','PUBLICATION','TASK'));
create function public.raxi_runtime_protect_approval() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.subject_kind='TASK' then raise exception 'runtime human approval is immutable'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create trigger raxi_runtime_approval_history before update or delete on public.raxi_approvals for each row execute function public.raxi_runtime_protect_approval();

create function public.raxi_runtime_request(p_actor uuid,p_workspace uuid,p_key uuid,p_spec jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare policy public.raxi_runtime_policies; task public.raxi_agent_tasks; tid uuid;
begin
 if current_user<>'service_role' then raise exception 'server required' using errcode='42501'; end if;
 perform 1 from public.raxi_workspaces where id=p_workspace and owner_user_id=p_actor for update;
 if not found then raise exception 'owner required' using errcode='42501'; end if;
 select * into task from public.raxi_agent_tasks where workspace_id=p_workspace and external_id='RUNTIME-'||p_key::text;
 if found then
  if task.input_snapshot->'spec' is distinct from p_spec then raise exception 'idempotency conflict'; end if;
  return task.id;
 end if;
 select * into policy from public.raxi_runtime_policies where workspace_id=p_workspace for update;
 if not found or not policy.enabled or policy.expires_at<=clock_timestamp() or policy.task_count>=policy.max_tasks then raise exception 'runtime not authorized'; end if;
 if coalesce(length(p_spec->>'question'),0) not between 5 and 1500 or jsonb_typeof(p_spec->'externalResearch') is distinct from 'boolean' or
    p_spec->>'provider' is distinct from policy.provider or p_spec->>'model' is distinct from policy.model or
    p_spec#>>'{authorization,confirmed}' is distinct from 'true' or
    coalesce((p_spec#>>'{authorization,maxCostMicros}')::bigint,-1)<2*policy.per_call_micros or
    coalesce((p_spec#>>'{authorization,expiresAt}')::timestamptz,'-infinity')<=clock_timestamp() or
    (p_spec#>>'{authorization,expiresAt}')::timestamptz>policy.expires_at or
    policy.reserved_micros+2*policy.per_call_micros>policy.total_budget_micros or (not policy.simulated and policy.per_call_micros=0) then raise exception 'scope or budget denied'; end if;
 insert into public.raxi_agent_tasks(workspace_id,external_id,title,status,input_snapshot)
 values(p_workspace,'RUNTIME-'||p_key::text,'Investigación autorizada','QUEUED',jsonb_build_object('runtime',true,'spec',p_spec,'policy',to_jsonb(policy))) returning id into tid;
 insert into public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
 values(p_workspace,'TASK',tid,'APPROVED',p_actor,'RUNTIME-'||p_key::text,jsonb_build_object('spec',p_spec,'policy',to_jsonb(policy),'scope','DIRECTOR_RESEARCH_READ_ONLY'));
 update public.raxi_runtime_policies set reserved_micros=reserved_micros+2*per_call_micros,task_count=task_count+1 where workspace_id=p_workspace;
 insert into public.raxi_audit_events(workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,details)
 values(p_workspace,'RUNTIME_HUMAN_AUTHORIZED','HUMAN',p_actor,'TASK',tid::text,jsonb_build_object('requestKey',p_key,'spec',p_spec));
 return tid;
end; $$;

create function public.raxi_runtime_assert_authorization(p_task public.raxi_agent_tasks) returns void
language plpgsql security invoker set search_path='' as $$
declare policy public.raxi_runtime_policies;
begin
 if current_user<>'service_role' then raise exception 'server required' using errcode='42501'; end if;
  if p_task.input_snapshot ? 'supervised' then
    perform public.raxi_supervised_assert(p_task);
    return;
  end if;
 select * into policy from public.raxi_runtime_policies where workspace_id=p_task.workspace_id for share;
 if not found or not policy.enabled or policy.expires_at<=clock_timestamp() or
    (p_task.input_snapshot#>>'{policy,simulated}')::boolean is distinct from policy.simulated or
    (to_jsonb(policy)-array['reserved_micros','task_count']) is distinct from
      ((p_task.input_snapshot->'policy')-array['reserved_micros','task_count']) or
    p_task.input_snapshot#>>'{spec,provider}' is distinct from policy.provider or
    p_task.input_snapshot#>>'{spec,model}' is distinct from policy.model or
    p_task.input_snapshot#>>'{spec,authorization,confirmed}' is distinct from 'true' or
    coalesce((p_task.input_snapshot#>>'{spec,authorization,maxCostMicros}')::bigint,-1)<2*policy.per_call_micros or
    coalesce((p_task.input_snapshot#>>'{spec,authorization,expiresAt}')::timestamptz,'-infinity')<=clock_timestamp() or
    policy.reserved_micros>policy.total_budget_micros then
  raise exception 'authorization expired or revoked';
 end if;
end; $$;

create function public.raxi_runtime_claim(p_task uuid,p_worker text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare task public.raxi_agent_tasks; run public.raxi_agent_runs; v_stage text; aid uuid; policy public.raxi_runtime_policies;
begin
 if current_user<>'service_role' then raise exception 'server required' using errcode='42501'; end if;
 select * into task from public.raxi_agent_tasks where id=p_task and input_snapshot->>'runtime'='true' for update;
 if not found then raise exception 'runtime task required'; end if;
 -- Expiration is an uncertain effect, not permission to charge a second time.
 select * into run from public.raxi_agent_runs where task_id=p_task and status in ('CLAIMED','RUNNING') and lease_until<=clock_timestamp() for update;
 if found then
  update public.raxi_agent_runs set status='UNKNOWN',finished_at=clock_timestamp() where id=run.id;
  update public.raxi_agent_tasks set status='BLOCKED' where id=p_task;
  update public.raxi_agent_profiles set runtime_status='NOT_CONNECTED' where id in (select agent_id from public.raxi_agent_runs where task_id=p_task);
  insert into public.raxi_agent_events(workspace_id,agent_id,task_id,event_type,source_kind,evidence_status,occurred_at,payload)
  values(run.workspace_id,run.agent_id,run.task_id,'RUNTIME_LEASE_UNKNOWN',case when run.simulated then 'MOCK' else 'AGENT_EXECUTOR' end,
   case when run.simulated then 'UNVERIFIED' else 'VERIFIED' end,clock_timestamp(),
   jsonb_build_object('runId',run.id,'attempt',run.attempt,'simulated',run.simulated,'stage',run.stage,'leaseUntil',run.lease_until,
    'reconciliationRequired',true,'operationalReceiptOnly',true,'providerAcknowledged',run.provider_receipt is not null));
  insert into public.raxi_audit_events(workspace_id,action,actor_kind,resource_kind,resource_id,details)
  values(run.workspace_id,'RUNTIME_LEASE_UNKNOWN','SYSTEM','RUN',run.id::text,
   jsonb_build_object('taskId',run.task_id,'attempt',run.attempt,'stage',run.stage,'simulated',run.simulated,'receipt',run.provider_receipt));
  return null;
 end if;
 if task.status<>'QUEUED' or exists(select 1 from public.raxi_agent_runs where task_id=p_task and status in ('CLAIMED','RUNNING','UNKNOWN','FAILED')) then return null; end if;
 perform public.raxi_runtime_assert_authorization(task);
 select * into policy from public.raxi_runtime_policies where workspace_id=task.workspace_id;
 v_stage:=coalesce(task.input_snapshot#>>'{supervised,stage}',case when exists(select 1 from public.raxi_agent_runs where task_id=p_task and stage='DIRECTOR' and status='SUCCEEDED') then 'RESEARCHER' else 'DIRECTOR' end);
 if exists(select 1 from public.raxi_agent_runs where task_id=p_task and stage=v_stage and status='SUCCEEDED') then return null; end if;
 insert into public.raxi_agent_profiles(workspace_id,agent_key,display_name,role,runtime_status)
 values(task.workspace_id,'RUNTIME_'||v_stage,case when v_stage='DIRECTOR' then 'Director IA' else 'Investigador' end,v_stage,'NOT_CONNECTED')
 on conflict(workspace_id,agent_key) do nothing;
 select id into aid from public.raxi_agent_profiles where workspace_id=task.workspace_id and agent_key='RUNTIME_'||v_stage;
 insert into public.raxi_agent_runs(workspace_id,task_id,agent_id,stage,status,simulated,provider,model,lease_until,worker_id,reserved_micros)
 values(task.workspace_id,p_task,aid,v_stage,'CLAIMED',(task.input_snapshot#>>'{policy,simulated}')::boolean,policy.provider,policy.model,clock_timestamp()+interval '90 seconds',p_worker,(task.input_snapshot#>>'{policy,per_call_micros}')::bigint) returning * into run;
 return jsonb_build_object('task',to_jsonb(task),'run',to_jsonb(run),'previous',(select result from public.raxi_agent_runs where (task_id=p_task and stage='DIRECTOR' or id=nullif(task.input_snapshot#>>'{supervised,parentRunId}','')::uuid) and status='SUCCEEDED'));
end; $$;

create function public.raxi_runtime_step(p_run uuid,p_token uuid,p_kind text,p_result jsonb default null,p_receipt text default null,p_cost bigint default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.raxi_agent_runs; task public.raxi_agent_tasks; event text;
begin
 if current_user<>'service_role' then raise exception 'server required' using errcode='42501'; end if;
 select * into run from public.raxi_agent_runs where id=p_run;
 if not found then raise exception 'lease denied'; end if;
 perform 1 from public.raxi_agent_tasks where id=run.task_id for update;
 select * into run from public.raxi_agent_runs where id=p_run for update;
 if not found or run.lease_token is distinct from p_token then raise exception 'lease denied'; end if;
 if run.status='SUCCEEDED' and p_kind='finish' and run.result=p_result then return to_jsonb(run); end if;
 if run.lease_until<=clock_timestamp() or run.status not in ('CLAIMED','RUNNING') then raise exception 'stale lease'; end if;
 select * into task from public.raxi_agent_tasks where id=run.task_id for update;
 if p_kind='dispatch' then
  if run.status<>'CLAIMED' or run.dispatch_authorized_at is not null then raise exception 'dispatch already admitted'; end if;
  perform public.raxi_runtime_assert_authorization(task);
  update public.raxi_agent_runs set dispatch_authorized_at=clock_timestamp() where id=p_run returning * into run;
  return to_jsonb(run);
 elsif p_kind='ack' then
  if run.status<>'CLAIMED' or run.dispatch_authorized_at is null or coalesce(length(p_receipt),0) not between 1 and 200 then raise exception 'provider receipt required'; end if;
  update public.raxi_agent_runs set status='RUNNING',provider_receipt=p_receipt where id=p_run;
  update public.raxi_agent_profiles set runtime_status=case when run.simulated then 'NOT_CONNECTED' else 'CONNECTED' end where id=run.agent_id;
  update public.raxi_agent_tasks set status='RUNNING',agent_id=run.agent_id,started_at=coalesce(started_at,clock_timestamp()),updated_at=run.lease_until-interval '90 seconds' where id=run.task_id;
  event:='RUNTIME_ACKNOWLEDGED';
 elsif p_kind='finish' then
  -- Same UTF-8 jsonb text budget as runtimeResultBytes; includes escaping and metadata.
  if run.status<>'RUNNING' or jsonb_typeof(p_result) is distinct from 'object' or octet_length(convert_to(p_result::text,'UTF8'))>196608 or coalesce(p_cost,0)<0 or coalesce(p_cost,0)>run.reserved_micros then raise exception 'invalid completion'; end if;
  update public.raxi_agent_runs set status='SUCCEEDED',result=p_result,cost_micros=p_cost,finished_at=clock_timestamp() where id=p_run;
  update public.raxi_agent_profiles set runtime_status='NOT_CONNECTED' where id=run.agent_id;
  update public.raxi_agent_tasks set status=case when run.stage='DIRECTOR' and not (input_snapshot ? 'supervised') then 'QUEUED' else 'COMPLETED' end,output_snapshot=case when run.stage='RESEARCHER' or input_snapshot ? 'supervised' then p_result else output_snapshot end,completed_at=case when run.stage='RESEARCHER' or input_snapshot ? 'supervised' then clock_timestamp() else null end where id=run.task_id;
  event:='RUNTIME_RESULT_COMMITTED';
 elsif p_kind='unknown' then
  if coalesce(p_cost,0)<0 then raise exception 'invalid cost'; end if;
  update public.raxi_agent_runs set status='UNKNOWN',cost_micros=p_cost,finished_at=clock_timestamp() where id=p_run;
  if p_cost>run.reserved_micros then update public.raxi_runtime_policies set enabled=false where workspace_id=run.workspace_id; end if;
  update public.raxi_agent_profiles set runtime_status='NOT_CONNECTED' where id=run.agent_id;
  update public.raxi_agent_tasks set status='BLOCKED' where id=run.task_id;
  event:='RUNTIME_OUTCOME_UNKNOWN';
 else raise exception 'unsupported transition'; end if;
 insert into public.raxi_agent_events(workspace_id,agent_id,task_id,event_type,source_kind,evidence_status,occurred_at,payload)
 values(run.workspace_id,run.agent_id,run.task_id,event,case when run.simulated then 'MOCK' else 'AGENT_EXECUTOR' end,case when run.simulated then 'UNVERIFIED' else 'VERIFIED' end,clock_timestamp(),jsonb_build_object('runId',p_run,'simulated',run.simulated,'stage',run.stage,'leaseUntil',run.lease_until,'operationalReceiptOnly',true));
 insert into public.raxi_audit_events(workspace_id,action,actor_kind,resource_kind,resource_id,details)
 values(run.workspace_id,event,'SYSTEM','RUN',p_run::text,jsonb_build_object('stage',run.stage,'simulated',run.simulated,'receipt',coalesce(p_receipt,run.provider_receipt)));
 select * into run from public.raxi_agent_runs where id=p_run;
 return to_jsonb(run);
end; $$;

create function public.raxi_runtime_office(p_workspace uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or not exists(select 1 from public.raxi_workspaces where id=p_workspace and owner_user_id=auth.uid()) then raise exception 'owner required' using errcode='42501'; end if;
 -- No privileged lease tokens or policy rows in the public projection. RLS scopes existing tables.
 return jsonb_build_object('workspaceId',p_workspace,'ownerId',auth.uid(),'serverTime',clock_timestamp(),'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'status',case when t.status='RUNNING' and t.updated_at<clock_timestamp()-interval '90 seconds' then 'BLOCKED' else t.status end,'simulated',(t.input_snapshot#>>'{policy,simulated}')::boolean,'title',t.title,'result',t.output_snapshot)) from public.raxi_agent_tasks t where workspace_id=p_workspace and input_snapshot->>'runtime'='true'),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.raxi_agent_events e where workspace_id=p_workspace and event_type like 'RUNTIME_%'),'[]'::jsonb));
end; $$;
revoke all on function public.raxi_runtime_request(uuid,uuid,uuid,jsonb),public.raxi_runtime_claim(uuid,text),public.raxi_runtime_step(uuid,uuid,text,jsonb,text,bigint),public.raxi_runtime_office(uuid) from public,anon,authenticated;
grant execute on function public.raxi_runtime_request(uuid,uuid,uuid,jsonb),public.raxi_runtime_claim(uuid,text),public.raxi_runtime_step(uuid,uuid,text,jsonb,text,bigint) to service_role;
grant execute on function public.raxi_runtime_office(uuid) to authenticated;
revoke all on function public.raxi_runtime_assert_authorization(public.raxi_agent_tasks) from public,anon,authenticated;
grant execute on function public.raxi_runtime_assert_authorization(public.raxi_agent_tasks) to service_role;


-- SOURCE supervised_host_stage_a; SHA256(LF) 7f6de9365a6e85492b3e8e18b929f5caecfb3a01791d1326b34686e436c6ef3d
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


-- SOURCE supervised_host_stage_b; SHA256(LF) 59595546fdf1302342df0691fd5c3c7645d2a521861221ca11ae05b184bcb689
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

create function public.raxi_supervised_host_identity(p_identity jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'server required' using errcode='42501'; end if;
 if jsonb_typeof(p_identity) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_identity) k where k not in ('provenance','actorId','sessionId','workspaceId','projectRef','expiresAt'))
  or p_identity->>'provenance' is distinct from 'SUPABASE_AUTH_STAGING'
  or coalesce(p_identity->>'projectRef','') !~ '^[a-z]{20}$' or p_identity->>'projectRef'='jrkefsylpfriiqefcmzq'
  or coalesce((p_identity->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
  or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    join public.raxi_workspaces w on w.owner_user_id=u.id
    where s.id=(p_identity->>'sessionId')::uuid and u.id=(p_identity->>'actorId')::uuid
      and w.id=(p_identity->>'workspaceId')::uuid and u.is_anonymous=false
      and (s.not_after is null or s.not_after>clock_timestamp()))
 then raise exception 'session or workspace denied' using errcode='42501'; end if;
 return true;
end; $$;

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
