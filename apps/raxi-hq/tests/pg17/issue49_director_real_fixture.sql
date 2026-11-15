-- Synthetic PostgreSQL 17 fixture for Issue #49, not a staging schema dump.
-- Deliberately captures only the dependencies used by the candidate contract.
-- Executed in disposable --network none Docker PostgreSQL (never hosted DB).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key,is_anonymous boolean not null default false);
create table auth.sessions (
 id uuid primary key,user_id uuid not null references auth.users(id),
 not_after timestamptz
);
create table public.raxi_workspaces (
 id uuid primary key,owner_user_id uuid not null references auth.users(id),
 slug text not null,name text not null
);
create table public.raxi_agent_tasks(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.raxi_workspaces(id),
 external_id text not null,title text not null,status text not null
 check(status in ('QUEUED','RUNNING','WAITING','WAITING_APPROVAL','BLOCKED','FAILED','COMPLETED','CANCELED')),
 input_snapshot jsonb not null default '{}', output_snapshot jsonb,
 unique(workspace_id,id),unique(workspace_id,external_id)
);
create table public.raxi_runtime_policies(
 workspace_id uuid primary key references public.raxi_workspaces(id),
 enabled boolean not null default false,simulated boolean not null default true,
 authorization_version bigint not null default 1,
 provider text not null,model text not null,
 total_budget_micros bigint not null check(total_budget_micros>=0),
 reserved_micros bigint not null default 0 check(reserved_micros>=0),
 per_call_micros bigint not null check(per_call_micros>=0),
 max_tasks integer not null default 1,task_count integer not null default 0,
 max_output_tokens integer not null default 256,expires_at timestamptz not null,
 check(reserved_micros<=total_budget_micros)
);
create function public.raxi_runtime_policy_version() returns trigger
 language plpgsql set search_path='' as $f$
begin
 if new.reserved_micros<old.reserved_micros or new.task_count<old.task_count then
  raise exception 'monotonic'; end if;
 new.authorization_version:=old.authorization_version;
 if (to_jsonb(new)-array['authorization_version','reserved_micros','task_count']) is distinct from
    (to_jsonb(old)-array['authorization_version','reserved_micros','task_count']) then
  new.authorization_version:=old.authorization_version+1; end if;
 return new;
end $f$;
create trigger raxi_runtime_policy_version
 before update on public.raxi_runtime_policies for each row
 execute function public.raxi_runtime_policy_version();

create table public.raxi_approvals (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.raxi_workspaces(id),
 subject_kind text not null check(subject_kind in ('IDEA','CAMPAIGN','STRATEGY','JOB','ASSET','PUBLICATION','TASK')),
 subject_id uuid not null,action text not null check(action in ('APPROVED','REJECTED','CHANGES_REQUESTED','CANCELED')),
 actor_user_id uuid not null references auth.users(id),
 idempotency_key text not null,context jsonb not null default '{}',
 decided_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,idempotency_key)
);
create function public.raxi_runtime_protect_approval() returns trigger
 language plpgsql set search_path='' as $f$
begin
 if old.subject_kind='TASK' then raise exception 'immutable task human approval';end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $f$;
create trigger raxi_runtime_approval_history
 before update or delete on public.raxi_approvals for each row
 execute function public.raxi_runtime_protect_approval();

create function public.raxi_supervised_host_identity(p_identity jsonb)
 returns boolean language plpgsql set search_path='' as $f$
declare v_actor uuid;v_session uuid;v_workspace uuid;v_exp timestamptz;
begin
 if current_user<>'service_role' then raise exception 'server only' using errcode='42501';end if;
 if jsonb_typeof(p_identity) is distinct from 'object' or
   (select count(*) from jsonb_object_keys(p_identity))<>6 or
   exists(select 1 from jsonb_object_keys(p_identity) k
      where k not in ('provenance','actorId','sessionId','workspaceId','projectRef','expiresAt')) or
   p_identity->>'provenance' is distinct from 'SUPABASE_AUTH_STAGING' or
   p_identity->>'projectRef' is distinct from 'zvhxjindgyvtasstfjut'
 then raise exception 'identity denied' using errcode='42501';end if;
 begin
  v_actor:=(p_identity->>'actorId')::uuid;
  v_session:=(p_identity->>'sessionId')::uuid;
  v_workspace:=(p_identity->>'workspaceId')::uuid;
  v_exp:=(p_identity->>'expiresAt')::timestamptz;
 exception when others then raise exception 'identity denied' using errcode='42501';end;
 if v_exp<=clock_timestamp() or not exists(
  select 1 from auth.sessions s
  join auth.users u on u.id=s.user_id
  join public.raxi_workspaces w on w.id=v_workspace and w.owner_user_id=u.id
  where s.id=v_session and s.user_id=v_actor and u.id=v_actor and
        not u.is_anonymous and (s.not_after is null or s.not_after>clock_timestamp())
 ) then raise exception 'session denied' using errcode='42501';end if;
 return true;
end $f$;

grant usage on schema public,auth to service_role,anon,authenticated;
grant all on all tables in schema public,auth to service_role;
grant execute on all functions in schema public to service_role;
-- Fixture's default grant is intentionally NOT a compatibility/ACL acceptance.
