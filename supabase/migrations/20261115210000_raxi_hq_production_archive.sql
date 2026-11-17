-- Flujo maestro: Producción en Aria (orden con costo real → TE TOCA aprobar costo → generar y archivar)
-- y Archivista al publicar (memoria de campañas para no repetir).
alter table public.raxi_agent_jobs drop constraint raxi_agent_jobs_kind_check;
alter table public.raxi_agent_jobs add constraint raxi_agent_jobs_kind_check
  check (kind in ('SMOKE','BRIEF','RESEARCH','STRATEGY','DESIGN','REVIEW','PRODUCTION','GENERATE','COPY','QA','FINAL','ARCHIVE'));
alter table public.raxi_campaign_pipelines drop constraint raxi_campaign_pipelines_stage_check;
alter table public.raxi_campaign_pipelines add constraint raxi_campaign_pipelines_stage_check
  check (stage in ('BRIEF','RESEARCH','STRATEGY','DESIGN','REVIEW','PRODUCTION','GENERATE','COPY','QA','FINAL','DONE'));
alter table public.raxi_campaign_pipelines drop constraint raxi_campaign_pipelines_gate_check;
alter table public.raxi_campaign_pipelines add constraint raxi_campaign_pipelines_gate_check
  check (gate is null or gate in ('STRATEGY_APPROVAL','PRODUCTION_COST','PUBLISH_APPROVAL'));

-- Campaign memory written by the Archivist; read by the Director and the Creative so campaigns are not repeated.
create table public.raxi_campaign_archive (
  proposal_id uuid primary key references public.raxi_team_proposals(id) on delete restrict,
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text,
  title text not null check (length(title) between 1 and 200),
  published_url text check (published_url is null or published_url ~ '^https://(www\.)?instagram\.com/'),
  summary text not null check (length(summary) <= 4000),
  facets jsonb not null default '{}'::jsonb check (jsonb_typeof(facets) = 'object'),
  learnings jsonb not null default '[]'::jsonb check (jsonb_typeof(learnings) = 'array'),
  supermemory_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.raxi_campaign_archive enable row level security;
create policy raxi_campaign_archive_owner_read on public.raxi_campaign_archive for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_campaign_archive from anon;
revoke insert, update, delete, truncate on public.raxi_campaign_archive from authenticated;
grant select on public.raxi_campaign_archive to authenticated;

-- Internal: queue the Archivist for a published campaign (cheap, does not change the pipeline status).
create or replace function public.raxi_enqueue_archive(p_proposal uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.raxi_team_proposals where id = p_proposal;
  if exists (select 1 from public.raxi_agent_jobs where proposal_id = p_proposal and kind = 'ARCHIVE' and status in ('PENDING','RUNNING','SUCCEEDED')) then return 'EXISTS'; end if;
  insert into public.raxi_agent_jobs(workspace_id, proposal_id, kind, requested_by, input)
   values (v_ws, p_proposal, 'ARCHIVE', p_actor, jsonb_build_object('requested_at', now()));
  perform net.http_post(url := 'https://zvhxjindgyvtasstfjut.supabase.co/functions/v1/raxi-agent-runner',
                        body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 300000);
  return 'QUEUED';
end $$;
revoke all on function public.raxi_enqueue_archive(uuid,uuid) from public, anon, authenticated;

create or replace function public.raxi_pipeline_advance(p_job uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare j public.raxi_agent_jobs; pl public.raxi_campaign_pipelines; d jsonb; v_rounds int;
begin
  select * into j from public.raxi_agent_jobs where id = p_job;
  if not found or j.proposal_id is null or j.kind = 'ARCHIVE' then return 'NO_JOB'; end if;
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
      return public.raxi_pipeline_enqueue(j.proposal_id, case when public.raxi_campaign_ready_assets(j.proposal_id) then 'COPY' else 'PRODUCTION' end, '{}'::jsonb, null);
    end if;
    select count(*) into v_rounds from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'DESIGN' and status = 'SUCCEEDED';
    if v_rounds < 3 then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'DESIGN', '{}'::jsonb, null);
    end if;
    update public.raxi_campaign_pipelines set status = 'PAUSED', stage = 'REVIEW', note = 'El Director pidió cambios 3 veces. Revisa sus notas y decide si seguir.', updated_at = now() where proposal_id = j.proposal_id;
    return 'PAUSED';
  elsif j.kind = 'PRODUCTION' then
    update public.raxi_campaign_pipelines set status = 'WAITING_APPROVAL', stage = 'PRODUCTION', gate = 'PRODUCTION_COST', note = null, updated_at = now() where proposal_id = j.proposal_id;
    return 'WAITING_APPROVAL';
  elsif j.kind = 'GENERATE' then
    if public.raxi_campaign_ready_assets(j.proposal_id) then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'COPY', '{}'::jsonb, null);
    end if;
    update public.raxi_campaign_pipelines set status = 'PAUSED', stage = 'GENERATE', note = 'Aria aún no entrega todas las fotos. Reintenta: solo se consultan las pendientes, no se vuelve a pagar.', updated_at = now() where proposal_id = j.proposal_id;
    return 'PAUSED';
  elsif j.kind = 'COPY' then
    return public.raxi_pipeline_enqueue(j.proposal_id, 'QA', '{}'::jsonb, null);
  elsif j.kind = 'QA' then
    if d->>'estado' in ('APPROVED','APPROVED_WITH_CAUTION') then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'FINAL', '{}'::jsonb, null);
    end if;
    select count(*) into v_rounds from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'COPY' and status = 'SUCCEEDED';
    if d->>'estado' = 'REWRITE' and v_rounds < 3 then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'COPY', jsonb_build_object('qa_notes', coalesce(d->'defectos','[]'::jsonb)), null);
    end if;
    update public.raxi_campaign_pipelines set status = 'PAUSED', stage = 'QA',
      note = left('QA no aprobó: ' || coalesce(d->>'resumen', 'revisa su reporte') , 1000), updated_at = now() where proposal_id = j.proposal_id;
    return 'PAUSED';
  elsif j.kind = 'FINAL' then
    update public.raxi_campaign_pipelines set status = 'WAITING_APPROVAL', stage = 'FINAL', gate = 'PUBLISH_APPROVAL', note = null, updated_at = now() where proposal_id = j.proposal_id;
    return 'WAITING_APPROVAL';
  end if;
  return 'IGNORED';
end $$;
revoke all on function public.raxi_pipeline_advance(uuid) from public, anon, authenticated;
grant execute on function public.raxi_pipeline_advance(uuid) to service_role;

create or replace function public.raxi_campaign_decide(p_proposal uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl public.raxi_campaign_pipelines; r text; v_note text := nullif(left(trim(coalesce(p_note,'')), 1000), '');
  v_plan jsonb; v_total numeric; v_spent numeric; v_cap numeric;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  select c.* into pl from public.raxi_campaign_pipelines c join public.raxi_workspaces w on w.id = c.workspace_id
   where c.proposal_id = p_proposal and w.owner_user_id = auth.uid() for update of c;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if p_decision in ('APPROVE','CHANGES') then
    if pl.status <> 'WAITING_APPROVAL' or pl.gate is null then raise exception 'nothing to decide' using errcode='22023'; end if;
    if p_decision = 'CHANGES' and v_note is null then raise exception 'note required' using errcode='22023'; end if;
    if pl.gate = 'STRATEGY_APPROVAL' then
      r := case when p_decision = 'APPROVE' then public.raxi_pipeline_enqueue(p_proposal, 'DESIGN', '{}'::jsonb, auth.uid())
                else public.raxi_pipeline_enqueue(p_proposal, 'STRATEGY', jsonb_build_object('owner_note', v_note), auth.uid()) end;
    elsif pl.gate = 'PRODUCTION_COST' then
      if p_decision = 'APPROVE' then
        select output->'data' into v_plan from public.raxi_agent_jobs where proposal_id = p_proposal and kind = 'PRODUCTION' and status = 'SUCCEEDED' order by finished_at desc limit 1;
        v_total := coalesce((v_plan->>'total_usd')::numeric, -1);
        if v_plan is null or v_total < 0 then raise exception 'nothing to decide' using errcode='22023'; end if;
        select coalesce(sum(cost_usd),0) into v_spent from public.raxi_agent_jobs where proposal_id = p_proposal and status <> 'FAILED';
        select per_campaign_cap_usd into v_cap from public.raxi_agent_budget where workspace_id = pl.workspace_id;
        if v_spent + v_total > v_cap then raise exception 'campaign budget reached' using errcode='22023'; end if;
        -- The approved amount travels with the order: generation can never spend more than what Luis saw.
        r := public.raxi_pipeline_enqueue(p_proposal, 'GENERATE', jsonb_build_object('plan', v_plan, 'approved_usd', v_total, 'approved_by', auth.uid()), auth.uid());
      else
        r := public.raxi_pipeline_enqueue(p_proposal, 'PRODUCTION', jsonb_build_object('owner_note', v_note), auth.uid());
      end if;
    elsif p_decision = 'APPROVE' then
      update public.raxi_campaign_pipelines set status = 'APPROVED_TO_PUBLISH', stage = 'DONE', gate = null, note = null, updated_at = now() where proposal_id = p_proposal;
      update public.raxi_portfolio_collections c set status = 'APPROVED', updated_at = now() from public.raxi_team_proposals p
       where p.id = p_proposal and c.workspace_id = p.workspace_id and c.external_id = 'CAMP-' || regexp_replace(p.external_id, '^PROP-', '');
      r := 'APPROVED_TO_PUBLISH';
    else
      r := public.raxi_pipeline_enqueue(p_proposal, 'COPY', jsonb_build_object('owner_note', v_note), auth.uid());
    end if;
  elsif p_decision = 'RESUME' then
    if pl.status not in ('FAILED','PAUSED') then raise exception 'nothing to decide' using errcode='22023'; end if;
    r := public.raxi_pipeline_enqueue(p_proposal, case when pl.stage = 'DONE' then 'REVIEW' else pl.stage end,
           case when pl.stage = 'RESEARCH' then coalesce((select input - 'pipeline' - 'requested_at' from public.raxi_agent_jobs where proposal_id = p_proposal and kind = 'RESEARCH' order by created_at desc limit 1), '{}'::jsonb)
                when pl.stage = 'GENERATE' then coalesce((select input - 'pipeline' - 'requested_at' from public.raxi_agent_jobs where proposal_id = p_proposal and kind = 'GENERATE' order by created_at desc limit 1), '{}'::jsonb)
                else '{}'::jsonb end,
           auth.uid());
  elsif p_decision = 'CONTINUE' then
    if pl.status <> 'READY_FOR_PRODUCTION' then raise exception 'nothing to decide' using errcode='22023'; end if;
    r := public.raxi_pipeline_enqueue(p_proposal, case when public.raxi_campaign_ready_assets(p_proposal) then 'COPY' else 'PRODUCTION' end, '{}'::jsonb, auth.uid());
  elsif p_decision = 'ARCHIVE' then
    if pl.status <> 'PUBLISHED' then raise exception 'nothing to decide' using errcode='22023'; end if;
    r := public.raxi_enqueue_archive(p_proposal, auth.uid());
  else
    raise exception 'invalid decision' using errcode='22023';
  end if;
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (pl.workspace_id, 'CAMPAIGN_GATE_DECISION', 'HUMAN', auth.uid(), 'raxi_campaign_pipelines', p_proposal::text, 'raxi-hq-app',
           jsonb_build_object('decision', p_decision, 'gate', pl.gate, 'stage', pl.stage, 'note', v_note, 'result', r, 'approved_usd', v_total), now(), now());
  if r = 'BUDGET' then raise exception 'campaign budget reached' using errcode='22023'; end if;
  if r = 'BUSY' then raise exception 'this step is already running' using errcode='22023'; end if;
  return jsonb_build_object('status', r);
end $$;
revoke all on function public.raxi_campaign_decide(uuid,text,text) from public, anon;
grant execute on function public.raxi_campaign_decide(uuid,text,text) to authenticated;

-- Publishing now hands the campaign to the Archivist automatically.
create or replace function public.raxi_campaign_mark_published(p_proposal uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl public.raxi_campaign_pipelines; v_url text := trim(coalesce(p_url, '')); v_col uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  select c.* into pl from public.raxi_campaign_pipelines c join public.raxi_workspaces w on w.id = c.workspace_id
   where c.proposal_id = p_proposal and w.owner_user_id = auth.uid() for update of c;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if pl.status <> 'APPROVED_TO_PUBLISH' then raise exception 'nothing to decide' using errcode='22023'; end if;
  if v_url !~ '^https://(www\.)?instagram\.com/(reel|reels|p)/[A-Za-z0-9_-]{5,40}/?(\?.*)?$' or length(v_url) > 300 then
    raise exception 'invalid instagram url' using errcode='22023';
  end if;
  v_url := regexp_replace(v_url, '\?.*$', '');
  select c.id into v_col from public.raxi_portfolio_collections c join public.raxi_team_proposals p on p.workspace_id = c.workspace_id
   where p.id = p_proposal and c.external_id = 'CAMP-' || regexp_replace(p.external_id, '^PROP-', '');
  update public.raxi_portfolio_collections set status = 'PUBLISHED', payload = payload || jsonb_build_object('published_url', v_url, 'published_at', now()), updated_at = now() where id = v_col;
  update public.raxi_portfolio_items set status = 'PUBLISHED', published_url = v_url, updated_at = now() where collection_id = v_col and human_decision = 'APPROVED';
  update public.raxi_campaign_pipelines set status = 'PUBLISHED', note = null, updated_at = now() where proposal_id = p_proposal;
  update public.raxi_team_proposals set status = 'DONE', updated_at = now() where id = p_proposal;
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (pl.workspace_id, 'CAMPAIGN_PUBLISHED', 'HUMAN', auth.uid(), 'raxi_portfolio_collections', v_col::text, 'raxi-hq-app', jsonb_build_object('url', v_url), now(), now());
  perform public.raxi_enqueue_archive(p_proposal, auth.uid());
  return jsonb_build_object('status', 'PUBLISHED');
end $$;
revoke all on function public.raxi_campaign_mark_published(uuid,text) from public, anon;
grant execute on function public.raxi_campaign_mark_published(uuid,text) to authenticated;
