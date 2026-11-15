-- ISSUE #49 / OFFLINE HISTORICAL CONTRACT SNAPSHOT; NEVER AUTO-APPLY HOSTED.
-- Source: read-only pg_get_functiondef in raxi-hq-staging PostgreSQL 17.11.
-- Expected official host digest SHA256(pg_get_functiondef):
-- 57b94e50e622acb3c6dee7e41707993b1f0d0a2087d358627e2a455d817e67b7
-- This historical RPC exists in staging but its SQL body was not committed in
-- the repo's migration chain. Reconstruct ONLY in isolated PG17 QA.
-- This is NOT a new Supabase migration, no remote SQL, no host deployment.
create table public.raxi_supervised_request_rate_counters (
 workspace_id uuid not null references public.raxi_workspaces(id) on delete cascade,
 actor_user_id uuid not null,
 operation text not null check(operation in ('PREFLIGHT','SUBMIT','REPLAY')),
 window_start timestamptz not null,
 request_count integer not null check(request_count>=0 and request_count<=60),
 primary key(workspace_id,actor_user_id,operation)
);
alter table public.raxi_supervised_request_rate_counters enable row level security;
revoke all on public.raxi_supervised_request_rate_counters from public,anon,authenticated,service_role;
grant select,insert,update on public.raxi_supervised_request_rate_counters to service_role;

-- Captured exact hosted function body, not reconstructed from memory:
CREATE OR REPLACE FUNCTION public.raxi_supervised_request_rate_admit(p_identity jsonb, p_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_workspace uuid;
  v_actor uuid;
  v_limit integer;
  v_bucket timestamptz;
  v_previous_window timestamptz;
  v_count integer;
  v_retry integer;
begin
  if current_user<>'service_role' then
    raise exception 'rate admission denied' using errcode='42501';
  end if;
  v_limit := case p_operation when 'PREFLIGHT' then 30 when 'SUBMIT' then 3 when 'REPLAY' then 60 else null end;
  if v_limit is null then raise exception 'invalid rate operation' using errcode='22023'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'read committed required' using errcode='25001';
  end if;
  -- Server-validated identity is rechecked against the session and workspace in SQL.
  perform public.raxi_supervised_host_identity(p_identity);
  v_workspace := (p_identity->>'workspaceId')::uuid;
  v_actor := (p_identity->>'actorId')::uuid;
  -- Create a zero-count slot atomically; it is never committed alone.
  -- Do not choose the effective minute until the row lock has been acquired.
  insert into public.raxi_supervised_request_rate_counters
    (workspace_id,actor_user_id,operation,window_start,request_count)
    values (v_workspace,v_actor,p_operation,clock_timestamp(),0)
    on conflict (workspace_id,actor_user_id,operation) do nothing;
  select window_start,request_count into v_previous_window,v_count
    from public.raxi_supervised_request_rate_counters
    where workspace_id=v_workspace and actor_user_id=v_actor and operation=p_operation
    for update;
  if not found then raise exception 'rate counter unavailable' using errcode='42501'; end if;
  -- DB clock is observed only AFTER waiting for the counter row, including
  -- another transaction holding it across the fixed-minute boundary.
  v_bucket := to_timestamp((floor(extract(epoch from clock_timestamp()) / 60)::bigint * 60)::double precision);
  if v_previous_window is distinct from v_bucket then
    update public.raxi_supervised_request_rate_counters
      set window_start=v_bucket,request_count=1
      where workspace_id=v_workspace and actor_user_id=v_actor and operation=p_operation;
  elsif v_count<v_limit then
    update public.raxi_supervised_request_rate_counters
      set request_count=v_count+1
      where workspace_id=v_workspace and actor_user_id=v_actor and operation=p_operation;
  else
    -- A denial changes neither this counter nor the audit ledger.
    perform public.raxi_supervised_host_identity(p_identity);
    v_retry := greatest(1,least(60,ceil(extract(epoch from (v_bucket+interval '1 minute'-clock_timestamp())))::integer));
    return jsonb_build_object('status','RATE_LIMITED','operation',p_operation,'retryAfterSeconds',v_retry);
  end if;

  -- A revoked or expired session during lock wait rolls back the count update.
  perform public.raxi_supervised_host_identity(p_identity);
  return jsonb_build_object('status','ALLOWED','operation',p_operation);
end; $function$;

revoke all on function public.raxi_supervised_request_rate_admit(jsonb,text)
 from public,anon,authenticated,service_role;
grant execute on function public.raxi_supervised_request_rate_admit(jsonb,text) to service_role;
