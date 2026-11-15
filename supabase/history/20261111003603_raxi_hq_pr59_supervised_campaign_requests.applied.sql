-- REVIEW PROPOSAL ONLY. Depends on campaign/Strategy migration and the B1 identity RPC.
-- Apply only in an authorized isolated environment. No runtime tasks or approvals are written.
revoke truncate on public.raxi_audit_events from public, anon, authenticated, service_role;


-- DRAFT: distributed fixed-minute admission counters. No hosted deployment or public endpoint.
-- One row per verified (workspace, actor, operation), never one row per request or minute.
-- Candidate values only: PREFLIGHT 30/min, SUBMIT 3/min, REPLAY 60/min.
create table public.raxi_supervised_request_rate_counters (
  workspace_id uuid not null references public.raxi_workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  operation text not null check (operation in ('PREFLIGHT','SUBMIT','REPLAY')),
  window_start timestamptz not null,
  request_count integer not null check (request_count between 0 and 60),
  primary key (workspace_id,actor_user_id,operation)
);
alter table public.raxi_supervised_request_rate_counters enable row level security;
revoke all on public.raxi_supervised_request_rate_counters from public,anon,authenticated,service_role;
grant select,insert,update on public.raxi_supervised_request_rate_counters to service_role;

create function public.raxi_supervised_request_rate_admit(p_identity jsonb, p_operation text) returns jsonb
language plpgsql security invoker set search_path='' as $$
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
end; $$;
revoke all on function public.raxi_supervised_request_rate_admit(jsonb,text) from public,anon,authenticated;
grant execute on function public.raxi_supervised_request_rate_admit(jsonb,text) to service_role;

create unique index raxi_supervised_campaign_request_key on public.raxi_audit_events
  (workspace_id, actor_user_id, (details->'command'->>'requestKey'))
  where action='SUPERVISED_CAMPAIGN_REQUESTED';

create unique index raxi_supervised_campaign_request_subject on public.raxi_audit_events
  (workspace_id, (details->'command'->>'campaignId'), (details->'command'->>'strategyRevision'),
   (details->'command'->>'deliverableId'), (details->'command'->>'purpose'))
  where action='SUPERVISED_CAMPAIGN_REQUESTED';

create function public.raxi_protect_supervised_campaign_request() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.action='SUPERVISED_CAMPAIGN_REQUESTED' or
    (tg_op='UPDATE' and new.action='SUPERVISED_CAMPAIGN_REQUESTED') then
    raise exception 'request receipt is immutable' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function public.raxi_protect_supervised_campaign_request() from public, anon, authenticated;
create trigger raxi_protect_supervised_campaign_request before update or delete on public.raxi_audit_events
  for each row execute function public.raxi_protect_supervised_campaign_request();

create function public.raxi_supervised_campaign_request_replay(p_identity jsonb, p_command jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior public.raxi_audit_events%rowtype;
begin
  if current_user<>'service_role' or p_command->>'workspaceId' is distinct from p_identity->>'workspaceId' then
    raise exception 'request scope denied' using errcode='42501';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'read committed required' using errcode='25001';
  end if;
  perform public.raxi_supervised_host_identity(p_identity);
  select * into prior from public.raxi_audit_events
    where workspace_id=(p_identity->>'workspaceId')::uuid and actor_user_id=(p_identity->>'actorId')::uuid
      and action='SUPERVISED_CAMPAIGN_REQUESTED' and details->'command'->>'requestKey'=p_command->>'requestKey';
  if not found then return null; end if;
  if prior.details->'command' is distinct from p_command then return jsonb_build_object('status','CONFLICT'); end if;
  return jsonb_build_object('status','REQUESTED','authorization','PENDING_HUMAN_EXECUTION_AUTH',
    'requestId',prior.resource_id,'actorId',prior.actor_user_id,'createdAt',prior.occurred_at,'command',prior.details->'command','evidence',prior.details->'evidence');
end; $$;
revoke all on function public.raxi_supervised_campaign_request_replay(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.raxi_supervised_campaign_request_replay(jsonb,jsonb) to service_role;

-- Only the trusted host supplies p_expected after evaluating the canonical snapshot and binding its hash.
create function public.raxi_supervised_campaign_request_commit(p_identity jsonb, p_command jsonb, p_expected jsonb, p_evidence jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  workspace uuid;
  actor uuid;
  prior jsonb;
  snapshot jsonb;
  request_id uuid;
  accepted_at timestamptz;
  evidence_campaign jsonb;
  evidence_strategy jsonb;
  evidence_receipt jsonb;
  evidence_event jsonb;
  evidence_count bigint;
  receipt_details jsonb;
begin
  if current_user<>'service_role' or p_command->>'workspaceId' is distinct from p_identity->>'workspaceId' then
    raise exception 'request scope denied' using errcode='42501';
  end if;
  perform public.raxi_supervised_host_identity(p_identity);
  if jsonb_typeof(p_command) is distinct from 'object'
    or (p_command - array['workspaceId','campaignId','strategyRevision','deliverableId','expectedCampaignVersion','requestKey','purpose','snapshotHash']) <> '{}'::jsonb
    or coalesce(p_command->>'campaignId','') !~ '^CAMPAIGN-[0-9]{3}$'
    or coalesce(p_command->>'deliverableId','') !~ '^STRATEGY-ITEM-[0-9]{3}$'
    or jsonb_typeof(p_command->'strategyRevision') is distinct from 'number'
    or coalesce(p_command->>'strategyRevision','') !~ '^([1-9]|10)$'
    or jsonb_typeof(p_command->'expectedCampaignVersion') is distinct from 'number'
    or coalesce(p_command->>'expectedCampaignVersion','') !~ '^(0|[1-9][0-9]{0,15})$'
    or coalesce(p_command->>'requestKey','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_command->>'snapshotHash','') !~ '^[0-9a-f]{64}$'
    or p_command->>'purpose' is distinct from 'PREPARE_VISUAL_BRIEF'
  then raise exception 'invalid request command' using errcode='22023'; end if;
  workspace := (p_identity->>'workspaceId')::uuid;
  actor := (p_identity->>'actorId')::uuid;
  -- Same serialization boundary as campaign-command. Replay check must happen after waiting.
  perform 1 from public.raxi_workspaces where id=workspace and owner_user_id=actor for update;
  if not found then raise exception 'request scope denied' using errcode='42501'; end if;
  prior := public.raxi_supervised_campaign_request_replay(p_identity,p_command);
  if prior is not null then return prior; end if;
  -- New writes are size-limited; historical replays remain recoverable.
  -- The host guard is deliberately smaller to leave room for JSONB formatting and metadata.
  if octet_length(p_evidence::text)>262144 then
    raise exception 'request evidence exceeds storage budget' using errcode='22023';
  end if;
  snapshot := public.raxi_campaign_snapshot(workspace,actor) - 'serverTime';
  if snapshot is distinct from p_expected or snapshot->'version' is distinct from p_command->'expectedCampaignVersion' then
    return jsonb_build_object('status','STALE');
  end if;
  -- Read the relational subjects and their original human decision together.
  -- The host performs richer editorial validation; it cannot choose unrelated evidence.
  select c.payload,s.payload,
    jsonb_build_object('operationId',a.idempotency_key,'command',a.context->'command'), e.value,count(*) over ()
  into evidence_campaign,evidence_strategy,evidence_receipt,evidence_event,evidence_count
  from public.raxi_campaigns c
  join public.raxi_strategy_revisions s on s.workspace_id=c.workspace_id and s.campaign_id=c.id
  join public.raxi_strategy_deliverables d on d.workspace_id=s.workspace_id and d.strategy_id=s.id
  join public.raxi_approvals a on a.workspace_id=s.workspace_id and a.subject_id=s.id
  join public.raxi_audit_events h on h.workspace_id=a.workspace_id and h.action='CAMPAIGN_COMMAND_COMMITTED'
    and h.actor_kind='HUMAN' and h.actor_user_id=a.actor_user_id and h.details->'command'=a.context->'command'
  cross join lateral jsonb_array_elements(h.details->'events') e(value)
  where c.workspace_id=workspace and c.external_id=p_command->>'campaignId'
    and c.status='PLANNING' and c.provenance='REAL'
    and s.revision=(p_command->>'strategyRevision')::integer and s.status='APPROVED' and s.approved_by=actor
    and s.approved_at<=clock_timestamp() and s.payload->>'approvedBy'='LUIS'
    and s.approved_at=(s.payload->>'approvedAt')::timestamptz
    and not exists (select 1 from public.raxi_strategy_revisions newer
      where newer.workspace_id=s.workspace_id and newer.campaign_id=s.campaign_id and newer.revision>s.revision)
    and d.external_id=p_command->>'deliverableId' and d.channel='INSTAGRAM_FEED' and d.content_level='PUBLIC_SOCIAL' and d.format='PHOTO'
    and (select count(*) from jsonb_array_elements(s.payload->'deliverables') i where i->>'id'=d.external_id)=1
    and exists (select 1 from jsonb_array_elements(s.payload->'deliverables') i where i=d.payload)
    and a.subject_kind='STRATEGY' and a.action='APPROVED' and a.actor_user_id=actor and a.context->'snapshot'=s.payload
    and a.context->'command'->>'workspaceId'=workspace::text and a.context->'command'->>'operationId'=a.idempotency_key
    and a.context->'command'->'action'=jsonb_build_object('type','APPROVE_STRATEGY','campaignId',c.external_id,'revision',s.revision,'confirmed',true)
    and (a.context->'command'->>'expectedVersion')::bigint < (p_command->>'expectedCampaignVersion')::bigint
    and e.value->>'action'='STRATEGY_APPROVED' and e.value->>'campaignId'=c.external_id
    and e.value->'revision'=to_jsonb(s.revision) and e.value->>'actor'='LUIS'
    and e.value->>'timestamp'=s.payload->>'approvedAt';
  if evidence_count is distinct from 1 or p_evidence is distinct from jsonb_build_object('campaign',evidence_campaign,'strategy',evidence_strategy,
      'approvalReceipt',evidence_receipt,'approvalEvent',evidence_event)
  then raise exception 'request evidence denied' using errcode='23514'; end if;
  receipt_details := jsonb_build_object('command',p_command,'evidence',p_evidence,
    'authorization','PENDING_HUMAN_EXECUTION_AUTH');
  if octet_length(receipt_details::text)>262144 then
    raise exception 'request receipt exceeds storage budget' using errcode='22023';
  end if;
  request_id := gen_random_uuid();
  accepted_at := clock_timestamp();
  insert into public.raxi_audit_events(workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,details,occurred_at)
    values(workspace,'SUPERVISED_CAMPAIGN_REQUESTED','HUMAN',actor,'SUPERVISED_CAMPAIGN_REQUEST',request_id::text,
      receipt_details,accepted_at)
    on conflict do nothing;
  if not found then return jsonb_build_object('status','CONFLICT'); end if;
  return public.raxi_supervised_campaign_request_replay(p_identity,p_command);
end; $$;
revoke all on function public.raxi_supervised_campaign_request_commit(jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.raxi_supervised_campaign_request_commit(jsonb,jsonb,jsonb,jsonb) to service_role;
