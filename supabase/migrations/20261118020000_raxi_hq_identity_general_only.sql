-- The identity is anchored on the general sheet only (Luis, 2026-11-17). Adult references stay Fanvue-only and can never
-- be part of an identity version, so nothing that reads the identity's references can carry NSFW material to public work.
-- Retired references (superseded_by) are refused too.
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
       select 1 from public.raxi_assets a where a.id = r and a.workspace_id = v_ws and a.kind = 'REFERENCE' and a.metadata->>'character_id' = p_character
         and a.metadata->>'content_level' = 'PUBLIC' and not (a.metadata ? 'superseded_by')))
  then raise exception 'invalid reference: identity uses only current general references' using errcode = '22023'; end if;
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
revoke all on function public.raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[]) to authenticated;
