-- "Rehacer esta foto": the owner marks a photo to redo (with an optional note). Production prepares a new order
-- for the marked photos only and the owner approves its cost again. Nothing is spent here.
create or replace function public.raxi_photo_redo(p_item uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it public.raxi_portfolio_items; pr public.raxi_team_proposals; pl public.raxi_campaign_pipelines; r text;
  v_note text := nullif(left(trim(coalesce(p_note,'')), 1000), ''); v_base text; v_prompt text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  select i.* into it from public.raxi_portfolio_items i join public.raxi_workspaces w on w.id = i.workspace_id
   where i.id = p_item and w.owner_user_id = auth.uid() for update of i;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if it.status = 'PUBLISHED' then raise exception 'already published' using errcode='22023'; end if;
  select p.* into pr from public.raxi_team_proposals p join public.raxi_portfolio_collections c
    on c.workspace_id = p.workspace_id and c.external_id = 'CAMP-' || regexp_replace(p.external_id, '^PROP-', '')
   where c.id = it.collection_id;
  if not found then raise exception 'no campaign for this photo' using errcode='22023'; end if;
  select * into pl from public.raxi_campaign_pipelines where proposal_id = pr.id for update;
  if not found or pl.status in ('PUBLISHED') then raise exception 'nothing to decide' using errcode='22023'; end if;
  if pl.status = 'RUNNING' or exists (select 1 from public.raxi_agent_jobs where proposal_id = pr.id and status in ('PENDING','RUNNING')) then
    raise exception 'this step is already running' using errcode='22023';
  end if;
  v_base := coalesce(it.payload->>'base_prompt', it.payload->>'prompt',
    'Create ONE new realistic photograph of the character from her reference sheet, recreating this scene: ' || coalesce(it.alt_text, ''));
  v_prompt := v_base
    || case when it.qa_notes is not null and length(it.qa_notes) > 0 then E'\n\nFix what QA found in the previous version: ' || it.qa_notes else '' end
    || case when v_note is not null then E'\n\nMandatory correction from the owner: ' || v_note else '' end;
  update public.raxi_portfolio_items set
    payload = (payload - 'aria_request_id' - 'aria_model' - 'aria_price_usd' - 'generated_job')
      || jsonb_build_object('kind', 'PHOTO_TO_GENERATE', 'base_prompt', v_base, 'prompt', left(v_prompt, 6000), 'redo_note', v_note,
         'previous', coalesce(payload->'previous', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('asset_id', asset_id, 'aria_file', aria_file, 'qa_notes', qa_notes, 'at', now()))),
    asset_id = null, aria_file = null, human_decision = 'PENDING', qa_status = 'VISUAL_REVIEW_REQUIRED', qa_notes = null, status = 'DRAFT', updated_at = now()
   where id = it.id;
  update public.raxi_portfolio_collections set status = 'DRAFT', updated_at = now() where id = it.collection_id and status <> 'PUBLISHED';
  r := public.raxi_pipeline_enqueue(pr.id, 'PRODUCTION', jsonb_build_object('redo', true), auth.uid());
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (it.workspace_id, 'PHOTO_REDO_REQUESTED', 'HUMAN', auth.uid(), 'raxi_portfolio_items', it.id::text, 'raxi-hq-app',
           jsonb_build_object('note', v_note, 'previous_asset', it.asset_id, 'result', r), now(), now());
  if r = 'BUDGET' then raise exception 'campaign budget reached' using errcode='22023'; end if;
  return jsonb_build_object('status', r);
end $$;
revoke all on function public.raxi_photo_redo(uuid,text) from public, anon;
grant execute on function public.raxi_photo_redo(uuid,text) to authenticated;

-- After a regeneration, reuse the existing text: go straight to QA.
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
      return public.raxi_pipeline_enqueue(j.proposal_id,
        case when exists (select 1 from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'COPY' and status = 'SUCCEEDED') then 'QA' else 'COPY' end, '{}'::jsonb, null);
    end if;
    -- Still rendering: re-queue the step (it only polls; it never pays twice). Max 6 rounds.
    select count(*) into v_rounds from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'GENERATE' and input->>'approved_at' is not distinct from j.input->>'approved_at';
    if coalesce((d->>'pendientes')::int, 0) > 0 and v_rounds < 6 then
      return public.raxi_pipeline_enqueue(j.proposal_id, 'GENERATE', j.input - 'pipeline' - 'requested_at', null);
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

-- Each cost approval is its own spending limit (a redo round is not blocked by the previous round).
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
        r := public.raxi_pipeline_enqueue(p_proposal, 'GENERATE', jsonb_build_object('plan', v_plan, 'approved_usd', v_total, 'approved_by', auth.uid(), 'approved_at', now()), auth.uid());
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
