-- Ephemeral PG17 test fixture extracted from the PR59 staging DB.
-- No credentials/user data; pinned exact SHA256 of catalog-normalized definition.
CREATE OR REPLACE FUNCTION public.raxi_supervised_host_identity(p_identity jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_session uuid;
  v_workspace uuid;
  v_expires_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'server only' using errcode='42501';
  end if;
  if jsonb_typeof(p_identity) is distinct from 'object' then
    raise exception 'identity claims denied' using errcode='42501';
  end if;
  if (select count(*) from jsonb_object_keys(p_identity)) <> 6
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
end; $function$;
revoke all on function public.raxi_supervised_host_identity(jsonb) from public,anon,authenticated;
grant execute on function public.raxi_supervised_host_identity(jsonb) to service_role;
create table public.raxi_qa_identity_fingerprint(expected_definition text not null);
insert into public.raxi_qa_identity_fingerprint values ('a99f644a5b4506d9db3fe426435bf4fefba30839592eea6ebdad4fee059a0fbf');
DO $fixture_identity$
BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.raxi_supervised_host_identity(jsonb)')),'UTF8')),'hex') is distinct from 'a99f644a5b4506d9db3fe426435bf4fefba30839592eea6ebdad4fee059a0fbf'
 THEN RAISE EXCEPTION 'reference PR59 fixture drifted from staging-approved definition'; END IF;
 RAISE NOTICE 'PASS: offline fixture matches pinned PR59 identity SHA256';
END;
$fixture_identity$;
