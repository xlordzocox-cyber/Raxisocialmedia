-- While Aria is still rendering, the Director re-queues GENERATE (polling only; never pays twice). Max 6 rounds.
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
    -- Still rendering: re-queue the step (it only polls; it never pays twice). Max 6 rounds.
    select count(*) into v_rounds from public.raxi_agent_jobs where proposal_id = j.proposal_id and kind = 'GENERATE';
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
