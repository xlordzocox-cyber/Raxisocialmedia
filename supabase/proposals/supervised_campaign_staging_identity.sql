-- PROPOSAL ONLY. Minimal, isolated identity prerequisite for PR59 at staging.
-- NO deployment/approval implied; no Stage A/B agent-runtime functions installed.
-- Pinned to raxi-hq-staging. Never execute in the production Supabase project.
-- Verified preflight on 2026-11-09: auth.sessions(id,user_id,not_after),
-- auth.users(id,is_anonymous), raxi_workspaces(id,owner_user_id) all exist.

grant usage on schema auth to service_role;
grant select(id,user_id,not_after) on auth.sessions to service_role;
grant select(id,is_anonymous) on auth.users to service_role;

create function public.raxi_supervised_host_identity(p_identity jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare
  v_actor uuid;
  v_session uuid;
  v_workspace uuid;
  v_expires_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'server only' using errcode='42501';
  end if;
  if jsonb_typeof(p_identity) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_identity)) <> 6
    or exists(select 1 from jsonb_object_keys(p_identity) f
      where f not in ('provenance','actorId','sessionId','workspaceId','projectRef','expiresAt'))
    or p_identity->>'provenance' is distinct from 'SUPABASE_AUTH_STAGING'
    or p_identity->>'projectRef' is distinct from 'zvhxjindgyvtasstfjut'
  then
    raise exception 'identity claims denied' using errcode='42501';
  end if;
  begin
    v_actor := (p_identity->>'actorId')::uuid;
    v_session := (p_identity->>'sessionId')::uuid;
    v_workspace := (p_identity->>'workspaceId')::uuid;
    v_expires_at := (p_identity->>'expiresAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'identity claims denied' using errcode='42501';
  end;
  if v_actor is null or v_session is null or v_workspace is null
    or v_expires_at is null or v_expires_at <= clock_timestamp()
    or not exists(
      select 1 from auth.sessions s
      join auth.users u on u.id=s.user_id
      join public.raxi_workspaces w on w.id=v_workspace and w.owner_user_id=u.id
      where s.id=v_session and s.user_id=v_actor and u.id=v_actor
        and u.is_anonymous is false and (s.not_after is null or s.not_after > clock_timestamp())
    )
  then
    raise exception 'session or workspace denied' using errcode='42501';
  end if;
  return true;
end; $$;
revoke all on function public.raxi_supervised_host_identity(jsonb) from public, anon, authenticated;
grant execute on function public.raxi_supervised_host_identity(jsonb) to service_role;

-- NOTE: service_role is a trusted server capability, not a tenant-isolated actor.
-- Its key MUST remain exclusively inside the Edge/server runtime.
-- This prerequisite does not create any agent task, grant execution permission,
-- call providers, create audit requests, or install remote routes.
