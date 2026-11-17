-- One chosen reference per view (Luis, 2026-11-17): choosing or uploading a new reference for a model's view and level
-- retires the previous ones (metadata.superseded_by). Retired references stay stored but leave Talento and the creator.
-- Source photos (angle SOURCE) are not views and are never retired.
create or replace function public.raxi_reference_supersede(p_ws uuid, p_character text, p_angle text, p_level text, p_keep uuid)
returns integer language sql security definer set search_path = '' as $$
  with old as (
    update public.raxi_assets a
       set metadata = a.metadata || jsonb_build_object('superseded_by', p_keep::text), updated_at = now()
     where a.workspace_id = p_ws and a.kind = 'REFERENCE' and a.id <> p_keep and p_angle <> 'SOURCE'
       and a.metadata->>'character_id' = p_character and a.metadata->>'angle' = p_angle and a.metadata->>'content_level' = p_level
       and not (a.metadata ? 'superseded_by')
    returning a.id
  ), unchosen as (
    update public.raxi_sheet_takes t set chosen_asset_id = null, updated_at = now()
     where t.workspace_id = p_ws and t.chosen_asset_id in (select id from old)
    returning 1
  )
  select (select count(*) from old)::integer + 0 * (select count(*) from unchosen)::integer;
$$;
revoke all on function public.raxi_reference_supersede(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.raxi_reference_supersede(uuid, text, text, text, uuid) to service_role;

-- One-time cleanup: keep the newest reference per model, view and level; retire the rest.
with ranked as (
  select a.id, a.workspace_id,
         first_value(a.id) over (partition by a.workspace_id, a.metadata->>'character_id', a.metadata->>'angle', a.metadata->>'content_level' order by a.created_at desc, a.id desc) as keep
    from public.raxi_assets a
   where a.kind = 'REFERENCE' and a.metadata->>'angle' <> 'SOURCE' and not (a.metadata ? 'superseded_by')
), retired as (
  update public.raxi_assets a set metadata = a.metadata || jsonb_build_object('superseded_by', r.keep::text), updated_at = now()
    from ranked r where a.id = r.id and r.id <> r.keep
  returning a.id, a.workspace_id
)
update public.raxi_sheet_takes t set chosen_asset_id = null, updated_at = now()
  from retired r where t.workspace_id = r.workspace_id and t.chosen_asset_id = r.id;
