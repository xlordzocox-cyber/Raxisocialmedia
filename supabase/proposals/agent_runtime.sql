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
 v_stage:=case when exists(select 1 from public.raxi_agent_runs where task_id=p_task and stage='DIRECTOR' and status='SUCCEEDED') then 'RESEARCHER' else 'DIRECTOR' end;
 if exists(select 1 from public.raxi_agent_runs where task_id=p_task and stage=v_stage and status='SUCCEEDED') then return null; end if;
 insert into public.raxi_agent_profiles(workspace_id,agent_key,display_name,role,runtime_status)
 values(task.workspace_id,'RUNTIME_'||v_stage,case when v_stage='DIRECTOR' then 'Director IA' else 'Investigador' end,v_stage,'NOT_CONNECTED')
 on conflict(workspace_id,agent_key) do nothing;
 select id into aid from public.raxi_agent_profiles where workspace_id=task.workspace_id and agent_key='RUNTIME_'||v_stage;
 insert into public.raxi_agent_runs(workspace_id,task_id,agent_id,stage,status,simulated,provider,model,lease_until,worker_id,reserved_micros)
 values(task.workspace_id,p_task,aid,v_stage,'CLAIMED',(task.input_snapshot#>>'{policy,simulated}')::boolean,policy.provider,policy.model,clock_timestamp()+interval '90 seconds',p_worker,(task.input_snapshot#>>'{policy,per_call_micros}')::bigint) returning * into run;
 return jsonb_build_object('task',to_jsonb(task),'run',to_jsonb(run),'previous',(select result from public.raxi_agent_runs where task_id=p_task and stage='DIRECTOR' and status='SUCCEEDED'));
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
  update public.raxi_agent_tasks set status=case when run.stage='DIRECTOR' then 'QUEUED' else 'COMPLETED' end,output_snapshot=case when run.stage='RESEARCHER' then p_result else output_snapshot end,completed_at=case when run.stage='RESEARCHER' then clock_timestamp() else null end where id=run.task_id;
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
