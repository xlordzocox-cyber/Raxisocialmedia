-- Módulo de Creación M2: ficha 360 creator. Takes double as the cost ledger (cost in integer mills).
-- The $10/month cap is enforced here, atomically, by the only functions allowed to create takes (service_role).

create table public.raxi_provider_prices (
  model text primary key check (model ~ '^[a-z0-9-]+/[a-z0-9.-]+/edit$'),
  enabled boolean not null default false,
  out_1k numeric(6,3), out_15k numeric(6,3), out_2k numeric(6,3), per_input numeric(6,3),
  verified_on date, source_url text,
  check (not enabled or (out_1k is not null and out_15k is not null and out_2k is not null and per_input is not null and verified_on is not null))
);
insert into public.raxi_provider_prices (model, enabled, out_1k, out_15k, out_2k, per_input, verified_on, source_url) values
  ('bytedance/seedream-v5.5/edit', true, 0.020, 0.020, 0.035, 0.008, date '2026-11-17', 'https://wavespeed.ai/models/bytedance/seedream-v5.5/edit'),
  ('bytedance/seedream-v5.0-pro/edit', false, null, null, null, null, null, null);
alter table public.raxi_provider_prices enable row level security;
create policy raxi_provider_prices_read on public.raxi_provider_prices for select to authenticated using (true);
revoke all on public.raxi_provider_prices from anon, authenticated;
grant select on public.raxi_provider_prices to authenticated;

create table public.raxi_sheet_runs (
  id uuid primary key,
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text not null check (character_id in ('raxi-vox','vesper-corvus')),
  level text not null check (level in ('GENERAL','ADULT')),
  model text not null references public.raxi_provider_prices(model),
  resolution text not null check (resolution in ('1k','1.5k','2k')),
  source_asset_ids uuid[] not null default '{}',
  source_paths text[] not null default '{}',
  attested_not_real boolean not null check (attested_not_real),
  adult_template text check (adult_template is null or (level = 'ADULT' and length(adult_template) <= 1500)),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index raxi_sheet_runs_latest on public.raxi_sheet_runs (workspace_id, character_id, level, created_at desc);

create table public.raxi_sheet_takes (
  id uuid primary key,
  run_id uuid not null references public.raxi_sheet_runs(id) on delete restrict,
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  view text not null check (view in ('FRONT','THREE_QUARTER','PROFILE','BODY_FRONT','BODY_SIDE','BODY_BACK')),
  take_no integer not null check (take_no between 1 and 99),
  prompt text not null check (length(prompt) between 1 and 4000),
  input_count integer not null check (input_count between 1 and 10),
  cost_mills integer not null check (cost_mills between 1 and 1000),
  status text not null default 'QUEUED' check (status in ('QUEUED','PENDING','SUCCEEDED','FAILED','CANCELLED')),
  prediction_id text check (prediction_id is null or prediction_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  object_path text, sha256 text, byte_size integer, mime_type text,
  error text check (error is null or length(error) <= 300),
  chosen_asset_id uuid references public.raxi_assets(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, view, take_no)
);
create index raxi_sheet_takes_month on public.raxi_sheet_takes (workspace_id, created_at);

alter table public.raxi_sheet_runs enable row level security;
alter table public.raxi_sheet_takes enable row level security;
create policy raxi_sheet_runs_owner_read on public.raxi_sheet_runs for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
create policy raxi_sheet_takes_owner_read on public.raxi_sheet_takes for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_sheet_runs from anon, authenticated;
revoke all on public.raxi_sheet_takes from anon, authenticated;
grant select on public.raxi_sheet_runs to authenticated;
grant select on public.raxi_sheet_takes to authenticated;

-- Spend of the current UTC month. A take counts while reserved or running, when it succeeded, and when it failed after
-- being submitted (conservative: whether WaveSpeed bills failed tasks is not verified). Cancelled takes never count.
create or replace function public.raxi_sheet_month_spend(p_actor uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(t.cost_mills), 0)::integer
  from public.raxi_sheet_takes t
  join public.raxi_workspaces w on w.id = t.workspace_id and w.owner_user_id = p_actor and w.slug = 'raxi-hq'
  where t.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    and (t.status in ('QUEUED','PENDING','SUCCEEDED') or (t.status = 'FAILED' and t.prediction_id is not null));
$$;

create or replace function public.raxi_sheet_insert_takes(p_ws uuid, p_actor uuid, p_takes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_new integer; v_spent integer;
begin
  if jsonb_typeof(p_takes) is distinct from 'array' then raise exception 'invalid takes' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('raxi_sheet_cap:' || p_ws::text, 0));
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_new from jsonb_array_elements(p_takes) e;
  v_spent := public.raxi_sheet_month_spend(p_actor);
  if v_spent + v_new > 10000 then raise exception 'monthly cap: % + % > 10000', v_spent, v_new using errcode = 'P0001'; end if;
  insert into public.raxi_sheet_takes (id, run_id, workspace_id, view, take_no, prompt, input_count, cost_mills, status)
  select (e->>'id')::uuid, (e->>'run_id')::uuid, p_ws, e->>'view', (e->>'take_no')::integer, e->>'prompt', (e->>'input_count')::integer, (e->>'cost_mills')::integer, 'QUEUED'
  from jsonb_array_elements(p_takes) e
  where exists (select 1 from public.raxi_sheet_runs r where r.id = (e->>'run_id')::uuid and r.workspace_id = p_ws);
  if (select count(*) from jsonb_array_elements(p_takes)) <> (select count(*) from public.raxi_sheet_takes t where t.id in (select (e->>'id')::uuid from jsonb_array_elements(p_takes) e))
  then raise exception 'foreign run' using errcode = '22023'; end if;
end $$;

create or replace function public.raxi_sheet_create_run(p_actor uuid, p_run jsonb, p_takes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_id uuid := (p_run->>'id')::uuid;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  if coalesce((p_run->>'attested_not_real')::boolean, false) is not true then raise exception 'attestation required' using errcode = '22023'; end if;
  insert into public.raxi_sheet_runs (id, workspace_id, character_id, level, model, resolution, source_asset_ids, source_paths, attested_not_real, adult_template, created_by)
  values (v_id, v_ws, p_run->>'character_id', p_run->>'level', p_run->>'model', p_run->>'resolution',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_run->'source_asset_ids') x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_run->'source_paths') x), '{}'),
    true, nullif(p_run->>'adult_template', ''), p_actor);
  if exists (select 1 from unnest((select r.source_paths from public.raxi_sheet_runs r where r.id = v_id)) p where p not like v_ws::text || '/%')
  then raise exception 'foreign source' using errcode = '22023'; end if;
  perform public.raxi_sheet_insert_takes(v_ws, p_actor, p_takes);
  return v_id;
end $$;

create or replace function public.raxi_sheet_add_take(p_actor uuid, p_take jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  perform public.raxi_sheet_insert_takes(v_ws, p_actor, jsonb_build_array(p_take));
end $$;

revoke all on function public.raxi_sheet_month_spend(uuid) from public, anon, authenticated;
revoke all on function public.raxi_sheet_insert_takes(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.raxi_sheet_create_run(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.raxi_sheet_add_take(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.raxi_sheet_month_spend(uuid) to service_role;
grant execute on function public.raxi_sheet_create_run(uuid, jsonb, jsonb) to service_role;
grant execute on function public.raxi_sheet_add_take(uuid, jsonb) to service_role;
