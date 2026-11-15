-- Flujo maestro 07–10 para campañas con fotos listas: Copy → QA (con visión) → paquete final del Director
-- → TE TOCA: autorizar publicación → Luis publica en Instagram y registra el enlace.
alter table public.raxi_agent_jobs drop constraint raxi_agent_jobs_kind_check;
alter table public.raxi_agent_jobs add constraint raxi_agent_jobs_kind_check
  check (kind in ('SMOKE','BRIEF','RESEARCH','STRATEGY','DESIGN','REVIEW','COPY','QA','FINAL','GENERATE'));

alter table public.raxi_campaign_pipelines drop constraint raxi_campaign_pipelines_status_check;
alter table public.raxi_campaign_pipelines add constraint raxi_campaign_pipelines_status_check
  check (status in ('RUNNING','WAITING_APPROVAL','PAUSED','FAILED','READY_FOR_PRODUCTION','APPROVED_TO_PUBLISH','PUBLISHED'));
alter table public.raxi_campaign_pipelines drop constraint raxi_campaign_pipelines_stage_check;
alter table public.raxi_campaign_pipelines add constraint raxi_campaign_pipelines_stage_check
  check (stage in ('BRIEF','RESEARCH','STRATEGY','DESIGN','REVIEW','COPY','QA','FINAL','DONE'));
alter table public.raxi_campaign_pipelines drop constraint raxi_campaign_pipelines_gate_check;
alter table public.raxi_campaign_pipelines add constraint raxi_campaign_pipelines_gate_check
  check (gate is null or gate in ('STRATEGY_APPROVAL','PUBLISH_APPROVAL'));

-- Is the campaign's Fototeca collection complete (every item has a real archived photo)?
create or replace function public.raxi_campaign_ready_assets(p_proposal uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.raxi_portfolio_collections c join public.raxi_team_proposals p on p.workspace_id = c.workspace_id
                  where p.id = p_proposal and c.external_id = 'CAMP-' || regexp_replace(p.external_id, '^PROP-', ''))
     and not exists (select 1 from public.raxi_portfolio_items i join public.raxi_portfolio_collections c on c.id = i.collection_id
                      join public.raxi_team_proposals p on p.workspace_id = c.workspace_id
                      where p.id = p_proposal and c.external_id = 'CAMP-' || regexp_replace(p.external_id, '^PROP-', '') and i.asset_id is null)
     and exists (select 1 from public.raxi_portfolio_items i join public.raxi_portfolio_collections c on c.id = i.collection_id
                  join public.raxi_team_proposals p on p.workspace_id = c.workspace_id
                  where p.id = p_proposal and c.external_id = 'CAMP-' || regexp_replace(p.external_id, '^PROP-', ''));
$$;
revoke all on function public.raxi_campaign_ready_assets(uuid) from public, anon, authenticated;

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
      if public.raxi_campaign_ready_assets(j.proposal_id) then
        return public.raxi_pipeline_enqueue(j.proposal_id, 'COPY', '{}'::jsonb, null);
      end if;
      update public.raxi_campaign_pipelines set status = 'READY_FOR_PRODUCTION', stage = 'DONE', gate = null, note = null, updated_at = now() where proposal_id = j.proposal_id;
      return 'READY';
    end if;
    select count(*) into v_rounds from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'DESIGN' and status = 'SUCCEEDED';
    if v_rounds < 3 then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'DESIGN', '{}'::jsonb, null);
    end if;
    update public.raxi_campaign_pipelines set status = 'PAUSED', stage = 'REVIEW', note = 'El Director pidió cambios 3 veces. Revisa sus notas y decide si seguir.', updated_at = now() where proposal_id = j.proposal_id;
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

-- Owner decisions: strategy gate, publish gate, resume, and CONTINUE (campaign already approved with real photos → Copy).
create or replace function public.raxi_campaign_decide(p_proposal uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pl public.raxi_campaign_pipelines; r text; v_note text := nullif(left(trim(coalesce(p_note,'')), 1000), '');
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
           case when pl.stage = 'RESEARCH' then coalesce((select input - 'pipeline' - 'requested_at' from public.raxi_agent_jobs where proposal_id = p_proposal and kind = 'RESEARCH' order by created_at desc limit 1), '{}'::jsonb) else '{}'::jsonb end,
           auth.uid());
  elsif p_decision = 'CONTINUE' then
    if pl.status <> 'READY_FOR_PRODUCTION' or not public.raxi_campaign_ready_assets(p_proposal) then raise exception 'nothing to decide' using errcode='22023'; end if;
    r := public.raxi_pipeline_enqueue(p_proposal, 'COPY', '{}'::jsonb, auth.uid());
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

-- Owner: after publishing by hand in Instagram, record the real link. Only after the publish authorization.
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
  select c.id into v_col from public.raxi_portfolio_collections c join public.raxi_team_proposals p on p.workspace_id = c.workspace_id
   where p.id = p_proposal and c.external_id = 'CAMP-' || regexp_replace(p.external_id, '^PROP-', '');
  update public.raxi_portfolio_collections set status = 'PUBLISHED', payload = payload || jsonb_build_object('published_url', v_url, 'published_at', now()), updated_at = now() where id = v_col;
  update public.raxi_portfolio_items set status = 'PUBLISHED', published_url = v_url, updated_at = now() where collection_id = v_col and human_decision = 'APPROVED';
  update public.raxi_campaign_pipelines set status = 'PUBLISHED', note = null, updated_at = now() where proposal_id = p_proposal;
  update public.raxi_team_proposals set status = 'DONE', updated_at = now() where id = p_proposal;
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (pl.workspace_id, 'CAMPAIGN_PUBLISHED', 'HUMAN', auth.uid(), 'raxi_portfolio_collections', v_col::text, 'raxi-hq-app', jsonb_build_object('url', v_url), now(), now());
  return jsonb_build_object('status', 'PUBLISHED');
end $$;
revoke all on function public.raxi_campaign_mark_published(uuid,text) from public, anon;
grant execute on function public.raxi_campaign_mark_published(uuid,text) to authenticated;
