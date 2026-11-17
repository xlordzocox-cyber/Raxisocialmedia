-- Modo Autónomo v2: "Iniciar campaña". The Director chains the departments and stops only at human gates.
-- Flow: BRIEF (Director) → RESEARCH → STRATEGY (Director; may ask for more research once) → [Luis approves strategy]
--       → DESIGN → REVIEW (Director; may return to DESIGN up to 2 times) → campaign draft in Fototeca → READY_FOR_PRODUCTION.
alter table public.raxi_agent_jobs drop constraint raxi_agent_jobs_kind_check;
alter table public.raxi_agent_jobs add constraint raxi_agent_jobs_kind_check
  check (kind in ('SMOKE','BRIEF','RESEARCH','STRATEGY','DESIGN','REVIEW','GENERATE','QA'));

create table public.raxi_campaign_pipelines (
  proposal_id uuid primary key references public.raxi_team_proposals(id) on delete restrict,
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  status text not null check (status in ('RUNNING','WAITING_APPROVAL','PAUSED','FAILED','READY_FOR_PRODUCTION')),
  stage text not null check (stage in ('BRIEF','RESEARCH','STRATEGY','DESIGN','REVIEW','DONE')),
  gate text check (gate is null or gate = 'STRATEGY_APPROVAL'),
  note text check (note is null or length(note) <= 1000),
  started_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.raxi_campaign_pipelines enable row level security;
create policy raxi_campaign_pipelines_owner_read on public.raxi_campaign_pipelines for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_campaign_pipelines from anon;
revoke insert, update, delete, truncate on public.raxi_campaign_pipelines from authenticated;
grant select on public.raxi_campaign_pipelines to authenticated;

-- Internal: queue one step if the campaign budget allows it. Never callable by browsers.
create or replace function public.raxi_pipeline_enqueue(p_proposal uuid, p_kind text, p_input jsonb, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_budget public.raxi_agent_budget; v_month numeric; v_campaign numeric;
begin
  select workspace_id into v_ws from public.raxi_team_proposals where id = p_proposal;
  select * into v_budget from public.raxi_agent_budget where workspace_id = v_ws;
  select coalesce(sum(cost_usd),0) into v_month from public.raxi_agent_jobs where workspace_id = v_ws and created_at >= date_trunc('month', now());
  select coalesce(sum(cost_usd),0) into v_campaign from public.raxi_agent_jobs where proposal_id = p_proposal;
  if v_budget.workspace_id is null or v_month >= v_budget.monthly_cap_usd or v_campaign >= v_budget.per_campaign_cap_usd then
    update public.raxi_campaign_pipelines set status = 'PAUSED', note = 'Se alcanzó un tope de gasto. Sube el tope o espera al próximo mes.', updated_at = now() where proposal_id = p_proposal;
    return 'BUDGET';
  end if;
  if exists (select 1 from public.raxi_agent_jobs where proposal_id = p_proposal and status in ('PENDING','RUNNING')) then return 'BUSY'; end if;
  insert into public.raxi_agent_jobs(workspace_id, proposal_id, kind, requested_by, input)
   values (v_ws, p_proposal, p_kind, p_actor, coalesce(p_input, '{}'::jsonb) || jsonb_build_object('pipeline', true, 'requested_at', now()));
  update public.raxi_campaign_pipelines set status = 'RUNNING', stage = p_kind, gate = null, note = null, updated_at = now() where proposal_id = p_proposal;
  perform net.http_post(url := 'https://zvhxjindgyvtasstfjut.supabase.co/functions/v1/raxi-agent-runner',
                        body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 300000);
  return 'QUEUED';
end $$;
revoke all on function public.raxi_pipeline_enqueue(uuid,text,jsonb,uuid) from public, anon, authenticated;

-- Internal (runner only): after a step finishes, the Director decides what happens next.
create or replace function public.raxi_pipeline_advance(p_job uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare j public.raxi_agent_jobs; pl public.raxi_campaign_pipelines; d jsonb; v_rounds int;
begin
  select * into j from public.raxi_agent_jobs where id = p_job;
  if not found or j.proposal_id is null then return 'NO_JOB'; end if;
  select * into pl from public.raxi_campaign_pipelines where proposal_id = j.proposal_id for update;
  if not found or pl.status not in ('RUNNING','FAILED') then return 'NO_PIPELINE'; end if;
  if j.status = 'FAILED' then
    update public.raxi_campaign_pipelines set status = 'FAILED', stage = j.kind, note = left(coalesce(j.error,'Falló sin detalle.'), 1000), updated_at = now() where proposal_id = j.proposal_id;
    return 'FAILED';
  end if;
  if j.status <> 'SUCCEEDED' then return 'IGNORED'; end if;
  d := coalesce(j.output->'data', '{}'::jsonb);
  if j.kind = 'BRIEF' then
    return public.raxi_pipeline_enqueue(j.proposal_id, 'RESEARCH', jsonb_build_object('brief', d), null);
  elsif j.kind = 'RESEARCH' then
    return public.raxi_pipeline_enqueue(j.proposal_id, 'STRATEGY', '{}'::jsonb, null);
  elsif j.kind = 'STRATEGY' then
    select count(*) into v_rounds from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'RESEARCH' and status = 'SUCCEEDED';
    if d->>'decision' = 'MAS_INVESTIGACION' and v_rounds < 2 then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'RESEARCH', jsonb_build_object('follow_up', coalesce(d->'preguntas_extra','[]'::jsonb)), null);
    end if;
    update public.raxi_campaign_pipelines set status = 'WAITING_APPROVAL', stage = 'STRATEGY', gate = 'STRATEGY_APPROVAL', note = null, updated_at = now() where proposal_id = j.proposal_id;
    return 'WAITING_APPROVAL';
  elsif j.kind = 'DESIGN' then
    return public.raxi_pipeline_enqueue(j.proposal_id, 'REVIEW', '{}'::jsonb, null);
  elsif j.kind = 'REVIEW' then
    if d->>'veredicto' = 'APROBADA' and j.output ? 'campaign' then
      update public.raxi_campaign_pipelines set status = 'READY_FOR_PRODUCTION', stage = 'DONE', gate = null, note = null, updated_at = now() where proposal_id = j.proposal_id;
      return 'READY';
    end if;
    select count(*) into v_rounds from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'DESIGN' and status = 'SUCCEEDED';
    if v_rounds < 3 then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'DESIGN', '{}'::jsonb, null);
    end if;
    update public.raxi_campaign_pipelines set status = 'PAUSED', stage = 'REVIEW', note = 'El Director pidió cambios 3 veces. Revisa sus notas y decide si seguir.', updated_at = now() where proposal_id = j.proposal_id;
    return 'PAUSED';
  end if;
  return 'IGNORED';
end $$;
revoke all on function public.raxi_pipeline_advance(uuid) from public, anon, authenticated;
grant execute on function public.raxi_pipeline_advance(uuid) to service_role;

-- Owner: start the whole campaign.
create or replace function public.raxi_start_campaign(p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prop public.raxi_team_proposals; r text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  select p.* into v_prop from public.raxi_team_proposals p join public.raxi_workspaces w on w.id = p.workspace_id
   where p.id = p_proposal and w.owner_user_id = auth.uid() for update of p;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if v_prop.status not in ('ACCEPTED','IN_PROGRESS') then raise exception 'campaign not accepted' using errcode='22023'; end if;
  if exists (select 1 from public.raxi_campaign_pipelines where proposal_id = p_proposal and status in ('RUNNING','WAITING_APPROVAL')) then
    raise exception 'this step is already running' using errcode='22023';
  end if;
  insert into public.raxi_campaign_pipelines(proposal_id, workspace_id, status, stage, started_by)
   values (p_proposal, v_prop.workspace_id, 'RUNNING', 'BRIEF', auth.uid())
   on conflict (proposal_id) do update set status = 'RUNNING', stage = 'BRIEF', gate = null, note = null, started_by = auth.uid(), updated_at = now();
  update public.raxi_team_proposals set status = 'IN_PROGRESS', updated_at = now() where id = p_proposal and status = 'ACCEPTED';
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_prop.workspace_id, 'CAMPAIGN_PIPELINE_STARTED', 'HUMAN', auth.uid(), 'raxi_team_proposals', p_proposal::text, 'raxi-hq-app', '{}'::jsonb, now(), now());
  r := public.raxi_pipeline_enqueue(p_proposal, 'BRIEF', '{}'::jsonb, auth.uid());
  if r = 'BUDGET' then raise exception 'campaign budget reached' using errcode='22023'; end if;
  if r = 'BUSY' then raise exception 'this step is already running' using errcode='22023'; end if;
  return jsonb_build_object('status', r);
end $$;
revoke all on function public.raxi_start_campaign(uuid) from public, anon;
grant execute on function public.raxi_start_campaign(uuid) to authenticated;

-- Owner: human gates and recovery. APPROVE / CHANGES (with note) on the strategy; RESUME a failed or paused campaign.
create or replace function public.raxi_campaign_decide(p_proposal uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl public.raxi_campaign_pipelines; r text; v_note text := nullif(left(trim(coalesce(p_note,'')), 1000), '');
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  select c.* into pl from public.raxi_campaign_pipelines c join public.raxi_workspaces w on w.id = c.workspace_id
   where c.proposal_id = p_proposal and w.owner_user_id = auth.uid() for update of c;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if p_decision in ('APPROVE','CHANGES') then
    if pl.status <> 'WAITING_APPROVAL' or pl.gate is distinct from 'STRATEGY_APPROVAL' then raise exception 'nothing to decide' using errcode='22023'; end if;
    if p_decision = 'CHANGES' and v_note is null then raise exception 'note required' using errcode='22023'; end if;
    r := case when p_decision = 'APPROVE' then public.raxi_pipeline_enqueue(p_proposal, 'DESIGN', '{}'::jsonb, auth.uid())
              else public.raxi_pipeline_enqueue(p_proposal, 'STRATEGY', jsonb_build_object('owner_note', v_note), auth.uid()) end;
  elsif p_decision = 'RESUME' then
    if pl.status not in ('FAILED','PAUSED') then raise exception 'nothing to decide' using errcode='22023'; end if;
    r := public.raxi_pipeline_enqueue(p_proposal, case when pl.stage = 'DONE' then 'REVIEW' else pl.stage end,
           case when pl.stage = 'RESEARCH' then coalesce((select input - 'pipeline' - 'requested_at' from public.raxi_agent_jobs where proposal_id = p_proposal and kind = 'RESEARCH' order by created_at desc limit 1), '{}'::jsonb) else '{}'::jsonb end,
           auth.uid());
  else
    raise exception 'invalid decision' using errcode='22023';
  end if;
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (pl.workspace_id, 'CAMPAIGN_GATE_DECISION', 'HUMAN', auth.uid(), 'raxi_campaign_pipelines', p_proposal::text, 'raxi-hq-app',
           jsonb_build_object('decision', p_decision, 'gate', pl.gate, 'stage', pl.stage, 'note', v_note, 'result', r), now(), now());
  if r = 'BUDGET' then raise exception 'campaign budget reached' using errcode='22023'; end if;
  if r = 'BUSY' then raise exception 'this step is already running' using errcode='22023'; end if;
  return jsonb_build_object('status', r);
end $$;
revoke all on function public.raxi_campaign_decide(uuid,text,text) from public, anon;
grant execute on function public.raxi_campaign_decide(uuid,text,text) to authenticated;
