-- Prueba A/B de identidad (Luis, 2026-11-18): the same general face and the same scene text go to two models,
-- Seedream 5.5 edit (current) and FLUX-PuLID (WaveSpeed, $0.02 per image, verified 2026-11-18 on its model page).
-- Luis votes blind (A/B is shuffled per scene and hidden until he reveals it). Public level only; a test never
-- archives photos (FLUX.1 [dev] allows testing and evaluation; commercial use of outputs is ambiguous).
-- Same ledger and monthly cap as sheets, series and recreations.

-- Edit models plus an explicit allow-list of reference-to-image models (never a free pattern).
alter table public.raxi_provider_prices drop constraint raxi_provider_prices_model_check;
alter table public.raxi_provider_prices add constraint raxi_provider_prices_model_check
  check (model ~ '^[a-z0-9-]+/[a-z0-9.-]+/edit$' or model in ('wavespeed-ai/flux-pulid'));
insert into public.raxi_provider_prices (model, enabled, out_1k, out_15k, out_2k, per_input, verified_on, source_url)
values ('wavespeed-ai/flux-pulid', true, 0.020, 0.020, 0.020, 0, '2026-11-18', 'https://wavespeed.ai/models/wavespeed-ai/flux-pulid')
on conflict (model) do nothing;

create table public.raxi_model_tests (
  id uuid primary key,
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text not null check (character_id in ('raxi-vox','vesper-corvus')),
  level text not null default 'PUBLIC' check (level = 'PUBLIC'),
  identity_version integer not null,
  face_asset_id uuid not null,
  face_path text not null,
  scenes text[] not null check (array_length(scenes, 1) between 1 and 3),
  models text[] not null check (array_length(models, 1) = 2),
  -- per scene: which model is shown as "A" (0 or 1, index into models). Hidden from the client until revealed.
  a_index integer[] not null,
  votes jsonb not null default '{}'::jsonb,
  revealed boolean not null default false,
  ceiling_mills integer not null check (ceiling_mills between 1 and 10000),
  attested_not_real boolean not null check (attested_not_real),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (array_length(a_index, 1) = array_length(scenes, 1))
);
create index raxi_model_tests_latest on public.raxi_model_tests (workspace_id, created_at desc);
alter table public.raxi_model_tests enable row level security;
-- No client read: the shuffle must stay hidden until the reveal. The server returns a blind view.
revoke all on public.raxi_model_tests from anon, authenticated;

alter table public.raxi_sheet_takes add column test_id uuid references public.raxi_model_tests(id) on delete restrict;
alter table public.raxi_sheet_takes add column test_arm integer check (test_arm between 0 and 1);
alter table public.raxi_sheet_takes drop constraint raxi_sheet_takes_owner_kind;
alter table public.raxi_sheet_takes add constraint raxi_sheet_takes_owner_kind check (
  (run_id is not null and view is not null and series_id is null and shot_no is null and recreation_id is null and variant_no is null and test_id is null and test_arm is null)
  or (run_id is null and view is null and series_id is not null and shot_no is not null and recreation_id is null and variant_no is null and test_id is null and test_arm is null)
  or (run_id is null and view is null and series_id is null and shot_no is null and recreation_id is not null and variant_no is not null and test_id is null and test_arm is null)
  or (run_id is null and view is null and series_id is null and recreation_id is null and variant_no is null and test_id is not null and test_arm is not null and shot_no is not null));
create unique index raxi_sheet_takes_test_arm on public.raxi_sheet_takes (test_id, shot_no, test_arm, take_no) where test_id is not null;

create or replace function public.raxi_sheet_insert_takes(p_ws uuid, p_actor uuid, p_takes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_new integer; v_spent integer;
begin
  if jsonb_typeof(p_takes) is distinct from 'array' then raise exception 'invalid takes' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('raxi_sheet_cap:' || p_ws::text, 0));
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_new from jsonb_array_elements(p_takes) e;
  v_spent := public.raxi_sheet_month_spend(p_actor);
  if v_spent + v_new > 10000 then raise exception 'monthly cap: % + % > 10000', v_spent, v_new using errcode = 'P0001'; end if;
  insert into public.raxi_sheet_takes (id, run_id, series_id, recreation_id, test_id, workspace_id, view, shot_no, variant_no, test_arm, take_no, prompt, input_count, cost_mills, status)
  select (e->>'id')::uuid, (e->>'run_id')::uuid, (e->>'series_id')::uuid, (e->>'recreation_id')::uuid, (e->>'test_id')::uuid, p_ws, e->>'view', (e->>'shot_no')::integer,
         (e->>'variant_no')::integer, (e->>'test_arm')::integer, (e->>'take_no')::integer, e->>'prompt', (e->>'input_count')::integer, (e->>'cost_mills')::integer, 'QUEUED'
  from jsonb_array_elements(p_takes) e
  where exists (select 1 from public.raxi_sheet_runs r where r.id = (e->>'run_id')::uuid and r.workspace_id = p_ws)
     or exists (select 1 from public.raxi_series s where s.id = (e->>'series_id')::uuid and s.workspace_id = p_ws)
     or exists (select 1 from public.raxi_recreations c where c.id = (e->>'recreation_id')::uuid and c.workspace_id = p_ws)
     or exists (select 1 from public.raxi_model_tests m where m.id = (e->>'test_id')::uuid and m.workspace_id = p_ws);
  if (select count(*) from jsonb_array_elements(p_takes)) <> (select count(*) from public.raxi_sheet_takes t where t.id in (select (e->>'id')::uuid from jsonb_array_elements(p_takes) e))
  then raise exception 'foreign run' using errcode = '22023'; end if;
end $$;
revoke all on function public.raxi_sheet_insert_takes(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.raxi_model_test_create(p_actor uuid, p_test jsonb, p_takes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_id uuid := (p_test->>'id')::uuid; v_char text := p_test->>'character_id'; v_identity integer; v_total integer;
  v_face uuid := (p_test->>'face_asset_id')::uuid; v_face_path text; v_model text;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  if coalesce((p_test->>'attested_not_real')::boolean, false) is not true then raise exception 'attestation required' using errcode = '22023'; end if;
  select max(v.version) into v_identity from public.raxi_identity_versions v where v.workspace_id = v_ws and v.character_id = v_char and v.status = 'LOCKED';
  if v_identity is null then raise exception 'identity not locked' using errcode = '22023'; end if;
  -- Only the current general face of this model (never an adult reference).
  select a.object_path into v_face_path from public.raxi_assets a where a.id = v_face and a.workspace_id = v_ws and a.kind = 'REFERENCE'
    and a.metadata->>'character_id' = v_char and a.metadata->>'content_level' = 'PUBLIC' and a.metadata->>'angle' = 'FRONT' and not (a.metadata ? 'superseded_by');
  if v_face_path is null then raise exception 'invalid reference for this level' using errcode = '22023'; end if;
  for v_model in select x from jsonb_array_elements_text(p_test->'models') x loop
    if not exists (select 1 from public.raxi_provider_prices p where p.model = v_model and p.enabled) then raise exception 'model not enabled' using errcode = '22023'; end if;
  end loop;
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_total from jsonb_array_elements(p_takes) e;
  if v_total > (p_test->>'ceiling_mills')::integer then raise exception 'over the test ceiling' using errcode = '22023'; end if;
  insert into public.raxi_model_tests (id, workspace_id, character_id, identity_version, face_asset_id, face_path, scenes, models, a_index, ceiling_mills, attested_not_real, created_by)
  values (v_id, v_ws, v_char, v_identity, v_face, v_face_path,
          (select array_agg(x order by o) from jsonb_array_elements_text(p_test->'scenes') with ordinality t(x, o)),
          (select array_agg(x order by o) from jsonb_array_elements_text(p_test->'models') with ordinality t(x, o)),
          (select array_agg(x::integer order by o) from jsonb_array_elements_text(p_test->'a_index') with ordinality t(x, o)),
          (p_test->>'ceiling_mills')::integer, true, p_actor);
  perform public.raxi_sheet_insert_takes(v_ws, p_actor, p_takes);
  return v_id;
end $$;
revoke all on function public.raxi_model_test_create(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.raxi_model_test_create(uuid, jsonb, jsonb) to service_role;
