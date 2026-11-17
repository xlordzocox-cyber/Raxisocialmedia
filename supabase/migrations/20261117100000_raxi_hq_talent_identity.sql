-- Talento v1: versioned identity per model (360 references + identity text), locked by the owner.
-- Locking a version copies its text to raxi_character_profiles.fixed_prompt, which Production already prepends in Aria.
create table public.raxi_identity_versions (
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text not null check (character_id in ('raxi-vox','vesper-corvus')),
  version integer not null check (version between 1 and 999),
  identity_text text not null default '' check (length(identity_text) <= 4000),
  marks jsonb not null default '[]'::jsonb check (jsonb_typeof(marks) = 'array'),
  accessories jsonb not null default '[]'::jsonb check (jsonb_typeof(accessories) = 'array'),
  reference_asset_ids uuid[] not null default '{}',
  status text not null default 'DRAFT' check (status in ('DRAFT','LOCKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid references auth.users(id),
  primary key (workspace_id, character_id, version),
  check ((status = 'LOCKED') = (locked_at is not null and locked_by is not null))
);
create unique index raxi_identity_one_draft on public.raxi_identity_versions (workspace_id, character_id) where status = 'DRAFT';
alter table public.raxi_identity_versions enable row level security;
create policy raxi_identity_versions_owner_read on public.raxi_identity_versions for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_identity_versions from anon, authenticated;
grant select on public.raxi_identity_versions to authenticated;

create or replace function public.raxi_identity_save_draft(p_character text, p_text text, p_marks jsonb, p_accessories jsonb, p_refs uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_draft int;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'owner required' using errcode = '42501'; end if;
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = auth.uid() and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  if p_character not in ('raxi-vox','vesper-corvus') then raise exception 'unknown character' using errcode = '22023'; end if;
  if p_text is null or length(p_text) > 4000 then raise exception 'invalid text' using errcode = '22023'; end if;
  if jsonb_typeof(p_marks) is distinct from 'array' or jsonb_typeof(p_accessories) is distinct from 'array'
     or jsonb_array_length(p_marks) > 20 or jsonb_array_length(p_accessories) > 20
     or exists (select 1 from jsonb_array_elements(p_marks || p_accessories) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 200)
  then raise exception 'invalid lists' using errcode = '22023'; end if;
  if coalesce(cardinality(p_refs), 0) > 12 then raise exception 'too many references' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_refs, '{}'::uuid[])) r where not exists (
       select 1 from public.raxi_assets a where a.id = r and a.workspace_id = v_ws and a.kind = 'REFERENCE' and a.metadata->>'character_id' = p_character))
  then raise exception 'invalid reference' using errcode = '22023'; end if;
  select v.version into v_draft from public.raxi_identity_versions v
   where v.workspace_id = v_ws and v.character_id = p_character and v.status = 'DRAFT' for update;
  if found then
    update public.raxi_identity_versions set identity_text = p_text, marks = p_marks, accessories = p_accessories,
      reference_asset_ids = coalesce(p_refs, '{}'::uuid[]), updated_at = now()
     where workspace_id = v_ws and character_id = p_character and version = v_draft;
  else
    select coalesce(max(v.version), 0) + 1 into v_draft from public.raxi_identity_versions v where v.workspace_id = v_ws and v.character_id = p_character;
    insert into public.raxi_identity_versions (workspace_id, character_id, version, identity_text, marks, accessories, reference_asset_ids)
     values (v_ws, p_character, v_draft, p_text, p_marks, p_accessories, coalesce(p_refs, '{}'::uuid[]));
  end if;
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'IDENTITY_DRAFT_SAVED', 'HUMAN', auth.uid(), 'raxi_identity_versions', p_character, 'raxi-hq-talento', jsonb_build_object('character', p_character, 'version', v_draft), now(), now());
  return jsonb_build_object('character', p_character, 'version', v_draft, 'status', 'DRAFT');
end $$;

create or replace function public.raxi_identity_lock(p_character text, p_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v public.raxi_identity_versions;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'owner required' using errcode = '42501'; end if;
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = auth.uid() and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  select * into v from public.raxi_identity_versions x
   where x.workspace_id = v_ws and x.character_id = p_character and x.version = p_version for update;
  if not found or v.status <> 'DRAFT' then raise exception 'not a draft' using errcode = '22023'; end if;
  if length(trim(v.identity_text)) < 20 then raise exception 'identity text required' using errcode = '22023'; end if;
  if not exists (select 1 from public.raxi_assets a where a.id = any (v.reference_asset_ids) and a.workspace_id = v_ws
                 and a.kind = 'REFERENCE' and a.metadata->>'angle' = 'FRONT' and a.metadata->>'content_level' = 'PUBLIC')
  then raise exception 'front reference required' using errcode = '22023'; end if;
  update public.raxi_identity_versions set status = 'LOCKED', locked_at = now(), locked_by = auth.uid(), updated_at = now()
   where workspace_id = v_ws and character_id = p_character and version = p_version;
  insert into public.raxi_character_profiles (workspace_id, character_id, fixed_prompt, updated_at)
   values (v_ws, p_character, v.identity_text, now())
   on conflict (workspace_id, character_id) do update set fixed_prompt = excluded.fixed_prompt, updated_at = now();
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'IDENTITY_LOCKED', 'HUMAN', auth.uid(), 'raxi_identity_versions', p_character, 'raxi-hq-talento', jsonb_build_object('character', p_character, 'version', p_version), now(), now());
  return jsonb_build_object('character', p_character, 'version', p_version, 'status', 'LOCKED');
end $$;

revoke all on function public.raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[]) from public, anon;
revoke all on function public.raxi_identity_lock(text, integer) from public, anon;
grant execute on function public.raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[]) to authenticated;
grant execute on function public.raxi_identity_lock(text, integer) to authenticated;
