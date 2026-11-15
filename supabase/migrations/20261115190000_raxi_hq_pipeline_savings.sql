-- Ahorro: (1) reutilizar una investigación válida de menos de 14 días del mismo personaje en vez de volver a buscar;
-- (2) los pasos fallidos siguen visibles y cuentan para el tope mensual, pero no para el tope de la campaña.
create or replace function public.raxi_pipeline_enqueue(p_proposal uuid, p_kind text, p_input jsonb, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_char text; v_budget public.raxi_agent_budget; v_month numeric; v_campaign numeric; v_src public.raxi_agent_jobs;
begin
  select workspace_id, character_id into v_ws, v_char from public.raxi_team_proposals where id = p_proposal;
  select * into v_budget from public.raxi_agent_budget where workspace_id = v_ws;
  select coalesce(sum(cost_usd),0) into v_month from public.raxi_agent_jobs where workspace_id = v_ws and created_at >= date_trunc('month', now());
  select coalesce(sum(cost_usd),0) into v_campaign from public.raxi_agent_jobs where proposal_id = p_proposal and status <> 'FAILED';
  if v_budget.workspace_id is null or v_month >= v_budget.monthly_cap_usd or v_campaign >= v_budget.per_campaign_cap_usd then
    update public.raxi_campaign_pipelines set status = 'PAUSED', note = 'Se alcanzó un tope de gasto. Sube el tope o espera al próximo mes.', updated_at = now() where proposal_id = p_proposal;
    return 'BUDGET';
  end if;
  if exists (select 1 from public.raxi_agent_jobs where proposal_id = p_proposal and status in ('PENDING','RUNNING')) then return 'BUSY'; end if;

  -- Reuse: a fresh, valid research for the same character makes a new search unnecessary (unless the Director asked follow-ups).
  if p_kind = 'RESEARCH' and not (coalesce(p_input, '{}'::jsonb) ? 'follow_up') then
    select j.* into v_src from public.raxi_agent_jobs j join public.raxi_team_proposals p on p.id = j.proposal_id
     where j.workspace_id = v_ws and p.character_id is not distinct from v_char and j.kind = 'RESEARCH' and j.status = 'SUCCEEDED'
       and jsonb_typeof(j.output->'data') = 'object' and j.finished_at >= now() - interval '14 days'
     order by (j.proposal_id = p_proposal) desc, j.finished_at desc limit 1;
    if found then
      insert into public.raxi_agent_jobs(workspace_id, proposal_id, kind, status, requested_by, input, output, usage, cost_usd, started_at, finished_at)
       values (v_ws, p_proposal, 'RESEARCH', 'SUCCEEDED', p_actor,
               coalesce(p_input, '{}'::jsonb) || jsonb_build_object('pipeline', true, 'reused_from', v_src.id, 'requested_at', now()),
               v_src.output || jsonb_build_object('reused_from', v_src.id, 'reused_at', now()), '{}'::jsonb, 0, now(), now());
      update public.raxi_campaign_pipelines set status = 'RUNNING', stage = 'RESEARCH', gate = null, note = null, updated_at = now() where proposal_id = p_proposal;
      return public.raxi_pipeline_enqueue(p_proposal, 'STRATEGY', '{}'::jsonb, p_actor);
    end if;
  end if;

  insert into public.raxi_agent_jobs(workspace_id, proposal_id, kind, requested_by, input)
   values (v_ws, p_proposal, p_kind, p_actor, coalesce(p_input, '{}'::jsonb) || jsonb_build_object('pipeline', true, 'requested_at', now()));
  update public.raxi_campaign_pipelines set status = 'RUNNING', stage = p_kind, gate = null, note = null, updated_at = now() where proposal_id = p_proposal;
  perform net.http_post(url := 'https://zvhxjindgyvtasstfjut.supabase.co/functions/v1/raxi-agent-runner',
                        body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 300000);
  return 'QUEUED';
end $$;
revoke all on function public.raxi_pipeline_enqueue(uuid,text,jsonb,uuid) from public, anon, authenticated;
