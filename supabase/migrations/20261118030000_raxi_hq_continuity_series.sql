-- Módulo de Creación M3: continuity series. Same engine and ledger as the 360 sheet creator (raxi_sheet_takes),
-- one monthly cap for both. A series is one moment: a base photo plus 2..6 new photos made with WaveSpeed.
-- Rules enforced here: owner, attestation, locked identity, base of this model, never below the base's level,
-- no adult reference in a public series, no retired reference, ceiling >= total, monthly cap.

create table public.raxi_series (
  id uuid primary key,
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text not null check (character_id in ('raxi-vox','vesper-corvus')),
  channel text not null check (channel in ('INSTAGRAM','INSTAGRAM_STORY','TEASER','FANVUE_FEED','FANVUE_CHAT')),
  level text not null check (level in ('PUBLIC','NSFW','EXPLICIT')),
  base_asset_id uuid not null references public.raxi_assets(id),
  base_path text not null,
  identity_version integer not null,
  ref_asset_ids uuid[] not null default '{}',
  ref_paths text[] not null default '{}',
  scenes jsonb not null check (jsonb_typeof(scenes) = 'array' and jsonb_array_length(scenes) between 2 and 6),
  model text not null references public.raxi_provider_prices(model),
  resolution text not null check (resolution in ('1k','1.5k','2k')),
  ceiling_mills integer not null check (ceiling_mills between 1 and 10000),
  attested_not_real boolean not null check (attested_not_real),
  collection_id uuid,
  proposal_id uuid,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DONE','STOPPED')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check ((level = 'PUBLIC') = (channel in ('INSTAGRAM','INSTAGRAM_STORY','TEASER'))),
  check ((level = 'NSFW') = (channel = 'FANVUE_FEED')),
  check ((level = 'EXPLICIT') = (channel = 'FANVUE_CHAT'))
);
create index raxi_series_latest on public.raxi_series (workspace_id, character_id, created_at desc);
alter table public.raxi_series enable row level security;
create policy raxi_series_owner_read on public.raxi_series for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_series from anon, authenticated;
grant select on public.raxi_series to authenticated;

-- Takes now belong to a sheet run (view) or to a series (shot_no). Exactly one of them.
alter table public.raxi_sheet_takes alter column run_id drop not null;
alter table public.raxi_sheet_takes alter column view drop not null;
alter table public.raxi_sheet_takes add column series_id uuid references public.raxi_series(id) on delete restrict;
alter table public.raxi_sheet_takes add column shot_no integer check (shot_no between 1 and 6);
alter table public.raxi_sheet_takes add constraint raxi_sheet_takes_owner_kind check (
  (run_id is not null and view is not null and series_id is null and shot_no is null)
  or (run_id is null and view is null and series_id is not null and shot_no is not null));
create unique index raxi_sheet_takes_series_shot on public.raxi_sheet_takes (series_id, shot_no, take_no) where series_id is not null;

create or replace function public.raxi_sheet_insert_takes(p_ws uuid, p_actor uuid, p_takes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_new integer; v_spent integer;
begin
  if jsonb_typeof(p_takes) is distinct from 'array' then raise exception 'invalid takes' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('raxi_sheet_cap:' || p_ws::text, 0));
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_new from jsonb_array_elements(p_takes) e;
  v_spent := public.raxi_sheet_month_spend(p_actor);
  if v_spent + v_new > 10000 then raise exception 'monthly cap: % + % > 10000', v_spent, v_new using errcode = 'P0001'; end if;
  insert into public.raxi_sheet_takes (id, run_id, series_id, workspace_id, view, shot_no, take_no, prompt, input_count, cost_mills, status)
  select (e->>'id')::uuid, (e->>'run_id')::uuid, (e->>'series_id')::uuid, p_ws, e->>'view', (e->>'shot_no')::integer,
         (e->>'take_no')::integer, e->>'prompt', (e->>'input_count')::integer, (e->>'cost_mills')::integer, 'QUEUED'
  from jsonb_array_elements(p_takes) e
  where exists (select 1 from public.raxi_sheet_runs r where r.id = (e->>'run_id')::uuid and r.workspace_id = p_ws)
     or exists (select 1 from public.raxi_series s where s.id = (e->>'series_id')::uuid and s.workspace_id = p_ws);
  if (select count(*) from jsonb_array_elements(p_takes)) <> (select count(*) from public.raxi_sheet_takes t where t.id in (select (e->>'id')::uuid from jsonb_array_elements(p_takes) e))
  then raise exception 'foreign run' using errcode = '22023'; end if;
end $$;
revoke all on function public.raxi_sheet_insert_takes(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.raxi_level_rank(p_level text) returns integer language sql immutable set search_path = '' as $$
  select case p_level when 'PUBLIC' then 1 when 'NSFW' then 2 when 'EXPLICIT' then 3 else 99 end;
$$;

create or replace function public.raxi_series_create(p_actor uuid, p_series jsonb, p_takes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_id uuid := (p_series->>'id')::uuid; v_char text := p_series->>'character_id'; v_level text := p_series->>'level';
        v_identity integer; v_base public.raxi_assets; v_total integer; v_col uuid := gen_random_uuid(); v_ref uuid;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  if coalesce((p_series->>'attested_not_real')::boolean, false) is not true then raise exception 'attestation required' using errcode = '22023'; end if;
  select max(v.version) into v_identity from public.raxi_identity_versions v where v.workspace_id = v_ws and v.character_id = v_char and v.status = 'LOCKED';
  if v_identity is null then raise exception 'identity not locked' using errcode = '22023'; end if;
  select * into v_base from public.raxi_assets a where a.id = (p_series->>'base_asset_id')::uuid and a.workspace_id = v_ws;
  if not found or v_base.metadata->>'character_id' is distinct from v_char or v_base.kind not in ('ORIGINAL','REFERENCE') or v_base.metadata ? 'superseded_by'
  then raise exception 'invalid base' using errcode = '22023'; end if;
  if public.raxi_level_rank(coalesce(v_base.metadata->>'content_level', 'PUBLIC')) > public.raxi_level_rank(v_level)
  then raise exception 'a series never goes below the level of its base' using errcode = '22023'; end if;
  for v_ref in select x::uuid from jsonb_array_elements_text(coalesce(p_series->'ref_asset_ids', '[]'::jsonb)) x loop
    if not exists (select 1 from public.raxi_assets a where a.id = v_ref and a.workspace_id = v_ws and a.kind = 'REFERENCE'
                   and a.metadata->>'character_id' = v_char and not (a.metadata ? 'superseded_by')
                   and (a.metadata->>'content_level' = 'PUBLIC' or (a.metadata->>'content_level' = 'NSFW' and v_level <> 'PUBLIC')))
    then raise exception 'invalid reference for this level' using errcode = '22023'; end if;
  end loop;
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_total from jsonb_array_elements(p_takes) e;
  if v_total > (p_series->>'ceiling_mills')::integer then raise exception 'over the series ceiling' using errcode = '22023'; end if;
  -- A series started from the Fototeca gets its own collection (base at position 1). A series started by a campaign
  -- puts its photos in the campaign's own items instead, so no extra collection is created.
  if nullif(p_series->>'proposal_id', '') is null then
    insert into public.raxi_portfolio_collections (id, workspace_id, external_id, character_id, title, channel, status, concept, payload)
    values (v_col, v_ws, 'serie-' || v_id::text, v_char, left(coalesce(nullif(p_series->>'title', ''), 'Serie de continuidad'), 160),
            p_series->>'channel', 'DRAFT', null, jsonb_build_object('series_id', v_id, 'content_level', v_level));
    insert into public.raxi_portfolio_items (workspace_id, collection_id, position, asset_id, payload)
    values (v_ws, v_col, 1, v_base.id, jsonb_build_object('kind', 'SERIES_BASE', 'series_id', v_id));
  else
    v_col := null;
  end if;
  insert into public.raxi_series (id, workspace_id, character_id, channel, level, base_asset_id, base_path, identity_version, ref_asset_ids, ref_paths,
                                  scenes, model, resolution, ceiling_mills, attested_not_real, collection_id, proposal_id, created_by)
  values (v_id, v_ws, v_char, p_series->>'channel', v_level, v_base.id, v_base.object_path, v_identity,
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_series->'ref_asset_ids') x), '{}'),
          coalesce((select array_agg(a.object_path order by array_position((select array_agg(x::uuid) from jsonb_array_elements_text(p_series->'ref_asset_ids') x), a.id))
                      from public.raxi_assets a where a.id in (select x::uuid from jsonb_array_elements_text(p_series->'ref_asset_ids') x)), '{}'),
          p_series->'scenes', p_series->>'model', p_series->>'resolution', (p_series->>'ceiling_mills')::integer, true, v_col,
          nullif(p_series->>'proposal_id', '')::uuid, p_actor);
  perform public.raxi_sheet_insert_takes(v_ws, p_actor, p_takes);
  return v_id;
end $$;

revoke all on function public.raxi_level_rank(text) from public, anon, authenticated;
revoke all on function public.raxi_series_create(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.raxi_series_create(uuid, jsonb, jsonb) to service_role;
