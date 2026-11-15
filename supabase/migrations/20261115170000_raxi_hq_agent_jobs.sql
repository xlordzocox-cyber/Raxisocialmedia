-- Modo Autónomo: owner-requested agent jobs with budget caps, processed by the raxi-agent-runner Edge Function.
create table public.raxi_agent_budget (
  workspace_id uuid primary key references public.raxi_workspaces(id) on delete restrict,
  monthly_cap_usd numeric(10,2) not null default 20 check (monthly_cap_usd between 0 and 500),
  per_campaign_cap_usd numeric(10,2) not null default 2 check (per_campaign_cap_usd between 0 and 100),
  updated_at timestamptz not null default now()
);

create table public.raxi_agent_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  proposal_id uuid references public.raxi_team_proposals(id) on delete restrict,
  kind text not null check (kind in ('SMOKE','RESEARCH','DESIGN','GENERATE','QA')),
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELED')),
  requested_by uuid references auth.users(id),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb check (output is null or jsonb_typeof(output) = 'object'),
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  cost_usd numeric(10,4) not null default 0 check (cost_usd >= 0),
  error text check (error is null or length(error) <= 1000),
  attempts integer not null default 0 check (attempts between 0 and 3),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index raxi_agent_jobs_ws_idx on public.raxi_agent_jobs(workspace_id, created_at desc);
create unique index raxi_agent_jobs_one_active_idx on public.raxi_agent_jobs(workspace_id, proposal_id, kind)
  where status in ('PENDING','RUNNING');

alter table public.raxi_agent_budget enable row level security;
alter table public.raxi_agent_jobs enable row level security;
create policy raxi_agent_budget_owner_read on public.raxi_agent_budget for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
create policy raxi_agent_jobs_owner_read on public.raxi_agent_jobs for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_agent_budget, public.raxi_agent_jobs from anon;
revoke insert, update, delete, truncate on public.raxi_agent_budget, public.raxi_agent_jobs from authenticated;
grant select on public.raxi_agent_budget, public.raxi_agent_jobs to authenticated;

insert into public.raxi_agent_budget(workspace_id) select id from public.raxi_workspaces on conflict do nothing;

-- Owner asks an agent to work on an accepted campaign. Checks ownership, step order and budget,
-- queues the job and wakes the runner. The runner only ever processes queued jobs.
create or replace function public.raxi_request_agent_job(p_proposal uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_prop public.raxi_team_proposals;
  v_budget public.raxi_agent_budget;
  v_month numeric; v_campaign numeric; v_job uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  if p_kind not in ('RESEARCH','DESIGN') then raise exception 'step not available yet' using errcode='22023'; end if;
  select p.* into v_prop from public.raxi_team_proposals p join public.raxi_workspaces w on w.id = p.workspace_id
   where p.id = p_proposal and w.owner_user_id = auth.uid() for update of p;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if v_prop.status not in ('ACCEPTED','IN_PROGRESS') then raise exception 'campaign not accepted' using errcode='22023'; end if;
  if p_kind = 'DESIGN' and not exists (select 1 from public.raxi_agent_jobs j where j.proposal_id = p_proposal and j.kind = 'RESEARCH' and j.status = 'SUCCEEDED') then
    raise exception 'research first' using errcode='22023';
  end if;
  select * into v_budget from public.raxi_agent_budget where workspace_id = v_prop.workspace_id;
  if not found then raise exception 'budget not configured' using errcode='22023'; end if;
  select coalesce(sum(cost_usd),0) into v_month from public.raxi_agent_jobs
   where workspace_id = v_prop.workspace_id and created_at >= date_trunc('month', now());
  select coalesce(sum(cost_usd),0) into v_campaign from public.raxi_agent_jobs where proposal_id = p_proposal;
  if v_month >= v_budget.monthly_cap_usd then raise exception 'monthly budget reached' using errcode='22023'; end if;
  if v_campaign >= v_budget.per_campaign_cap_usd then raise exception 'campaign budget reached' using errcode='22023'; end if;
  insert into public.raxi_agent_jobs(workspace_id, proposal_id, kind, requested_by, input)
   values (v_prop.workspace_id, p_proposal, p_kind, auth.uid(), jsonb_build_object('requested_at', now()))
   returning id into v_job;
  update public.raxi_team_proposals set status = 'IN_PROGRESS', updated_at = now() where id = p_proposal and status = 'ACCEPTED';
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_prop.workspace_id, 'AGENT_JOB_REQUESTED', 'HUMAN', auth.uid(), 'raxi_agent_jobs', v_job::text, 'raxi-hq-app',
           jsonb_build_object('kind', p_kind, 'proposal', p_proposal), now(), now());
  perform net.http_post(url := 'https://zvhxjindgyvtasstfjut.supabase.co/functions/v1/raxi-agent-runner',
                        body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 300000);
  return jsonb_build_object('job', v_job, 'kind', p_kind);
exception when unique_violation then
  raise exception 'this step is already running' using errcode='22023';
end $$;
revoke all on function public.raxi_request_agent_job(uuid,text) from public, anon;
grant execute on function public.raxi_request_agent_job(uuid,text) to authenticated;
