-- REVIEW PROPOSAL ONLY. Depends on campaign/Strategy migration and the B1 identity RPC.
-- Apply only in an authorized isolated environment. No runtime tasks or approvals are written.
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
begin
  if current_user<>'service_role' or p_command->>'workspaceId' is distinct from p_identity->>'workspaceId' then
    raise exception 'request scope denied' using errcode='42501';
  end if;
  perform public.raxi_supervised_host_identity(p_identity);
  workspace := (p_identity->>'workspaceId')::uuid;
  actor := (p_identity->>'actorId')::uuid;
  -- Same serialization boundary as campaign-command. Replay check must happen after waiting.
  perform 1 from public.raxi_workspaces where id=workspace and owner_user_id=actor for update;
  if not found then raise exception 'request scope denied' using errcode='42501'; end if;
  prior := public.raxi_supervised_campaign_request_replay(p_identity,p_command);
  if prior is not null then return prior; end if;
  snapshot := public.raxi_campaign_snapshot(workspace,actor) - 'serverTime';
  if snapshot is distinct from p_expected or snapshot->'version' is distinct from p_command->'expectedCampaignVersion' then
    return jsonb_build_object('status','STALE');
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'object' or (p_evidence - array['campaign','strategy','approvalReceipt','approvalEvent']) <> '{}'::jsonb
    or p_evidence->'campaign'->>'id' is distinct from p_command->>'campaignId'
    or p_evidence->'campaign'->>'status' is distinct from 'PLANNING'
    or p_evidence->'strategy'->>'campaignId' is distinct from p_command->>'campaignId'
    or p_evidence->'strategy'->'revision' is distinct from p_command->'strategyRevision'
    or p_evidence->'strategy'->>'status' is distinct from 'APPROVED'
    or not exists (select 1 from jsonb_array_elements(snapshot->'session'->'campaigns') c where c=p_evidence->'campaign')
    or not exists (select 1 from jsonb_array_elements(snapshot->'session'->'strategies') s where s=p_evidence->'strategy')
    or not exists (select 1 from jsonb_array_elements(snapshot->'receipts') r where r=p_evidence->'approvalReceipt')
    or not exists (select 1 from jsonb_array_elements(snapshot->'session'->'audit') e where e=p_evidence->'approvalEvent')
  then raise exception 'request evidence denied' using errcode='23514'; end if;
  request_id := gen_random_uuid();
  accepted_at := clock_timestamp();
  insert into public.raxi_audit_events(workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,details,occurred_at)
    values(workspace,'SUPERVISED_CAMPAIGN_REQUESTED','HUMAN',actor,'SUPERVISED_CAMPAIGN_REQUEST',request_id::text,
      jsonb_build_object('command',p_command,'evidence',p_evidence,'authorization','PENDING_HUMAN_EXECUTION_AUTH'),accepted_at)
    on conflict do nothing;
  if not found then return jsonb_build_object('status','CONFLICT'); end if;
  return public.raxi_supervised_campaign_request_replay(p_identity,p_command);
end; $$;
revoke all on function public.raxi_supervised_campaign_request_commit(jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.raxi_supervised_campaign_request_commit(jsonb,jsonb,jsonb,jsonb) to service_role;
