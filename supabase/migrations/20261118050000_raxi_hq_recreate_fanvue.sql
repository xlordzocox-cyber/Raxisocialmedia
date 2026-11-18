-- Recrear for Fanvue (Luis, 2026-11-18): hybrid prompt. Claude writes only scene, pose, light and framing;
-- Luis writes the wardrobe and adult part himself (adult_text). The content level always follows the channel
-- (Fanvue feed = NSFW, Fanvue chat = EXPLICIT) and is decided here, never by the client.
-- Rules enforced here: adult targets live in their own drafts folder (an adult target never feeds a public recreation),
-- public recreations use only public references; Fanvue may add the current adult body reference; adult_text is required
-- for Fanvue and forbidden for public channels.

alter table public.raxi_recreations drop constraint raxi_recreations_channel_check;
alter table public.raxi_recreations add constraint raxi_recreations_channel_check
  check (channel in ('INSTAGRAM','INSTAGRAM_STORY','TEASER','FANVUE_FEED','FANVUE_CHAT'));
alter table public.raxi_recreations drop constraint raxi_recreations_level_check;
alter table public.raxi_recreations alter column level drop default;
alter table public.raxi_recreations add constraint raxi_recreations_level_check check (
  (channel in ('INSTAGRAM','INSTAGRAM_STORY','TEASER') and level = 'PUBLIC')
  or (channel = 'FANVUE_FEED' and level = 'NSFW')
  or (channel = 'FANVUE_CHAT' and level = 'EXPLICIT'));
alter table public.raxi_recreations add column adult_text text check (adult_text is null or length(adult_text) between 1 and 1500);
alter table public.raxi_recreations add constraint raxi_recreations_adult_text_level
  check ((level = 'PUBLIC') = (adult_text is null));

create or replace function public.raxi_recreation_create(p_actor uuid, p_rec jsonb, p_takes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_id uuid := (p_rec->>'id')::uuid; v_char text := p_rec->>'character_id'; v_channel text := p_rec->>'channel';
  v_level text; v_folder text; v_adult text := nullif(btrim(coalesce(p_rec->>'adult_text', '')), ''); v_identity integer; v_total integer; v_ref uuid;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  if coalesce((p_rec->>'attested_not_real')::boolean, false) is not true then raise exception 'attestation required' using errcode = '22023'; end if;
  v_level := case when v_channel in ('INSTAGRAM','INSTAGRAM_STORY','TEASER') then 'PUBLIC' when v_channel = 'FANVUE_FEED' then 'NSFW'
                  when v_channel = 'FANVUE_CHAT' then 'EXPLICIT' end;
  if v_level is null then raise exception 'invalid channel' using errcode = '22023'; end if;
  if v_level = 'PUBLIC' and v_adult is not null then raise exception 'adult text not allowed on public channels' using errcode = '22023'; end if;
  if v_level <> 'PUBLIC' and v_adult is null then raise exception 'adult text required for Fanvue' using errcode = '22023'; end if;
  select max(v.version) into v_identity from public.raxi_identity_versions v where v.workspace_id = v_ws and v.character_id = v_char and v.status = 'LOCKED';
  if v_identity is null then raise exception 'identity not locked' using errcode = '22023'; end if;
  -- The target photo must have been stored by the server in this workspace's drafts folder for this level.
  v_folder := case when v_level = 'PUBLIC' then 'drafts' else 'drafts-adult' end;
  if coalesce(p_rec->>'objective_path', '') !~ ('^' || v_ws::text || '/recreate/' || v_folder || '/[0-9a-f-]{36}\.(png|jpg|webp)$')
  then raise exception 'invalid target photo' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_rec->'ref_asset_ids', '[]'::jsonb)) < 1 then raise exception 'reference required' using errcode = '22023'; end if;
  for v_ref in select x::uuid from jsonb_array_elements_text(p_rec->'ref_asset_ids') x loop
    if not exists (select 1 from public.raxi_assets a where a.id = v_ref and a.workspace_id = v_ws and a.kind = 'REFERENCE'
                   and a.metadata->>'character_id' = v_char and not (a.metadata ? 'superseded_by')
                   and (a.metadata->>'content_level' = 'PUBLIC'
                        or (v_level <> 'PUBLIC' and a.metadata->>'content_level' = 'NSFW' and a.metadata->>'angle' = 'BODY_FRONT')))
    then raise exception 'invalid reference for this level' using errcode = '22023'; end if;
  end loop;
  select coalesce(sum((e->>'cost_mills')::integer), 0) into v_total from jsonb_array_elements(p_takes) e;
  if v_total > (p_rec->>'ceiling_mills')::integer then raise exception 'over the recreation ceiling' using errcode = '22023'; end if;
  insert into public.raxi_recreations (id, workspace_id, character_id, channel, level, objective_path, identity_version, ref_asset_ids, ref_paths, style, scene,
                                       prompt, adult_text, prompt_cost_mills, variants, model, resolution, ceiling_mills, attested_not_real, created_by)
  values (v_id, v_ws, v_char, v_channel, v_level, p_rec->>'objective_path', v_identity,
          (select array_agg(x::uuid) from jsonb_array_elements_text(p_rec->'ref_asset_ids') x),
          (select array_agg(a.object_path order by array_position((select array_agg(x::uuid) from jsonb_array_elements_text(p_rec->'ref_asset_ids') x), a.id))
             from public.raxi_assets a where a.id in (select x::uuid from jsonb_array_elements_text(p_rec->'ref_asset_ids') x)),
          p_rec->>'style', nullif(p_rec->>'scene', ''), p_rec->>'prompt', v_adult, coalesce((p_rec->>'prompt_cost_mills')::integer, 0),
          (p_rec->>'variants')::integer, p_rec->>'model', p_rec->>'resolution', (p_rec->>'ceiling_mills')::integer, true, p_actor);
  perform public.raxi_sheet_insert_takes(v_ws, p_actor, p_takes);
  return v_id;
end $$;
revoke all on function public.raxi_recreation_create(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.raxi_recreation_create(uuid, jsonb, jsonb) to service_role;
