-- Módulo de Creación M5: Recrear. Luis uploads a target photo; Claude (vision) writes the prompt with the prompter's
-- rules; the creator makes 1..4 versions with WaveSpeed using the model's general face reference + the target photo.
-- Same engine, ledger and monthly cap as the 360 sheet and the continuity series (raxi_sheet_takes).
-- v1 is public only (Instagram, Stories, teaser). Rules enforced here: owner, attestation, locked identity,
-- general (PUBLIC, not retired) references of this model only, target photo inside this workspace's recreate folder,
-- ceiling >= total, monthly cap.

create table public.raxi_recreations (
  id uuid primary key,
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text not null check (character_id in ('raxi-vox','vesper-corvus')),
  channel text not null check (channel in ('INSTAGRAM','INSTAGRAM_STORY','TEASER')),
  level text not null default 'PUBLIC' check (level = 'PUBLIC'),
  objective_path text not null,
  identity_version integer not null,
  ref_asset_ids uuid[] not null default '{}',
  ref_paths text[] not null default '{}',
  style text not null check (style in ('CINEMATIC','AMATEUR')),
  scene text,
  prompt text not null check (length(prompt) between 1 and 4000),
  prompt_cost_mills integer not null default 0 check (prompt_cost_mills between 0 and 1000),
  variants integer not null check (variants between 1 and 4),
  model text not null references public.raxi_provider_prices(model),
  resolution text not null check (resolution in ('1k','1.5k','2k')),
  ceiling_mills integer not null check (ceiling_mills between 1 and 10000),
  attested_not_real boolean not null check (attested_not_real),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index raxi_recreations_latest on public.raxi_recreations (workspace_id, created_at desc);
alter table public.raxi_recreations enable row level security;
create policy raxi_recreations_owner_read on public.raxi_recreations for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_recreations from anon, authenticated;
grant select on public.raxi_recreations to authenticated;

-- Takes now belong to a sheet run (view), a series (shot_no) or a recreation (variant_no). Exactly one of them.
alter table public.raxi_sheet_takes add column recreation_id uuid references public.raxi_recreations(id) on delete restrict;
alter table public.raxi_sheet_takes add column variant_no integer check (variant_no between 1 and 4);
alter table public.raxi_sheet_takes drop constraint raxi_sheet_takes_owner_kind;
alter table public.raxi_sheet_takes add constraint raxi_sheet_takes_owner_kind check (
  (run_id is not null and view is not null and series_id is null and shot_no is null and recreation_id is null and variant_no is null)
  or (run_id is null and view is null and series_id is not null and shot_no is not null and recreation_id is null and variant_no is null)
  or (run_id is null and view is null and series_id is null and shot_no is null and recreation_id is not null and variant_no is not null));
create unique index raxi_sheet_takes_recreation_variant on public.raxi_sheet_takes (recreation_id, variant_no, take_no) where recreation_id is not null;

create or replace function public.raxi_sheet_insert_takes(p_ws uuid, p_actor uuid, p_takes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_new integer; v_spent integer;
begin
  if jsonb_typeof(p_takes) is distinct from 'array' then raise exception 'invalid takes' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('raxi_sheet_cap:' || p_ws::text, 0));
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_new from jsonb_array_elements(p_takes) e;
  v_spent := public.raxi_sheet_month_spend(p_actor);
  if v_spent + v_new > 10000 then raise exception 'monthly cap: % + % > 10000', v_spent, v_new using errcode = 'P0001'; end if;
  insert into public.raxi_sheet_takes (id, run_id, series_id, recreation_id, workspace_id, view, shot_no, variant_no, take_no, prompt, input_count, cost_mills, status)
  select (e->>'id')::uuid, (e->>'run_id')::uuid, (e->>'series_id')::uuid, (e->>'recreation_id')::uuid, p_ws, e->>'view', (e->>'shot_no')::integer,
         (e->>'variant_no')::integer, (e->>'take_no')::integer, e->>'prompt', (e->>'input_count')::integer, (e->>'cost_mills')::integer, 'QUEUED'
  from jsonb_array_elements(p_takes) e
  where exists (select 1 from public.raxi_sheet_runs r where r.id = (e->>'run_id')::uuid and r.workspace_id = p_ws)
     or exists (select 1 from public.raxi_series s where s.id = (e->>'series_id')::uuid and s.workspace_id = p_ws)
     or exists (select 1 from public.raxi_recreations c where c.id = (e->>'recreation_id')::uuid and c.workspace_id = p_ws);
  if (select count(*) from jsonb_array_elements(p_takes)) <> (select count(*) from public.raxi_sheet_takes t where t.id in (select (e->>'id')::uuid from jsonb_array_elements(p_takes) e))
  then raise exception 'foreign run' using errcode = '22023'; end if;
end $$;
revoke all on function public.raxi_sheet_insert_takes(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.raxi_recreation_create(p_actor uuid, p_rec jsonb, p_takes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_id uuid := (p_rec->>'id')::uuid; v_char text := p_rec->>'character_id'; v_identity integer; v_total integer; v_ref uuid;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  if coalesce((p_rec->>'attested_not_real')::boolean, false) is not true then raise exception 'attestation required' using errcode = '22023'; end if;
  select max(v.version) into v_identity from public.raxi_identity_versions v where v.workspace_id = v_ws and v.character_id = v_char and v.status = 'LOCKED';
  if v_identity is null then raise exception 'identity not locked' using errcode = '22023'; end if;
  -- The target photo must have been stored by the server in this workspace's recreate folder (never a path of another workspace).
  if coalesce(p_rec->>'objective_path', '') !~ ('^' || v_ws::text || '/recreate/drafts/[0-9a-f-]{36}\.(png|jpg|webp)$')
  then raise exception 'invalid target photo' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_rec->'ref_asset_ids', '[]'::jsonb)) < 1 then raise exception 'reference required' using errcode = '22023'; end if;
  for v_ref in select x::uuid from jsonb_array_elements_text(p_rec->'ref_asset_ids') x loop
    if not exists (select 1 from public.raxi_assets a where a.id = v_ref and a.workspace_id = v_ws and a.kind = 'REFERENCE'
                   and a.metadata->>'character_id' = v_char and a.metadata->>'content_level' = 'PUBLIC' and not (a.metadata ? 'superseded_by'))
    then raise exception 'invalid reference for this level' using errcode = '22023'; end if;
  end loop;
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_total from jsonb_array_elements(p_takes) e;
  if v_total > (p_rec->>'ceiling_mills')::integer then raise exception 'over the recreation ceiling' using errcode = '22023'; end if;
  insert into public.raxi_recreations (id, workspace_id, character_id, channel, objective_path, identity_version, ref_asset_ids, ref_paths, style, scene,
                                       prompt, prompt_cost_mills, variants, model, resolution, ceiling_mills, attested_not_real, created_by)
  values (v_id, v_ws, v_char, p_rec->>'channel', p_rec->>'objective_path', v_identity,
          (select array_agg(x::uuid) from jsonb_array_elements_text(p_rec->'ref_asset_ids') x),
          (select array_agg(a.object_path order by array_position((select array_agg(x::uuid) from jsonb_array_elements_text(p_rec->'ref_asset_ids') x), a.id))
             from public.raxi_assets a where a.id in (select x::uuid from jsonb_array_elements_text(p_rec->'ref_asset_ids') x)),
          p_rec->>'style', nullif(p_rec->>'scene', ''), p_rec->>'prompt', coalesce((p_rec->>'prompt_cost_mills')::integer, 0),
          (p_rec->>'variants')::integer, p_rec->>'model', p_rec->>'resolution', (p_rec->>'ceiling_mills')::integer, true, p_actor);
  perform public.raxi_sheet_insert_takes(v_ws, p_actor, p_takes);
  return v_id;
end $$;
revoke all on function public.raxi_recreation_create(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.raxi_recreation_create(uuid, jsonb, jsonb) to service_role;
