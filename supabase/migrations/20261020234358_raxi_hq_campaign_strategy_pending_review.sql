-- PROPOSED ONLY: requires explicit production review/authorization before deployment.
alter table public.raxi_workspaces add column campaign_version bigint not null default 0 check (campaign_version >= 0);
alter table public.raxi_campaigns drop constraint raxi_campaigns_provenance_check;
alter table public.raxi_campaigns add constraint raxi_campaigns_provenance_check check(provenance in ('MOCK','MOCK_SESSION_MODIFIED','LOCAL_SESSION','REAL'));
create unique index raxi_campaign_source_once on public.raxi_campaigns(workspace_id,source_idea_id);
create unique index raxi_campaign_operation_once on public.raxi_audit_events(workspace_id,(details->'command'->>'operationId')) where action='CAMPAIGN_COMMAND_COMMITTED';

create function public.raxi_campaign_snapshot(p_workspace uuid, p_actor uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid; version bigint; result jsonb;
begin
  actor := case when current_user='service_role' then p_actor else auth.uid() end;
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'account required' using errcode='42501'; end if;
  select w.campaign_version into version from public.raxi_workspaces w where w.id=p_workspace and w.owner_user_id=actor;
  if not found then raise exception 'workspace denied' using errcode='42501'; end if;
  select jsonb_build_object('workspaceId',p_workspace,'ownerId',actor,'version',version,'serverTime',clock_timestamp(),
    'ideas',coalesce((select jsonb_agg(i.payload order by i.created_at,i.id) from public.raxi_ideas i where i.workspace_id=p_workspace and i.source='MANUAL_LUIS' and i.external_id like 'IDEA-REAL-%'),'[]'::jsonb),
    'handoffs',coalesce((select jsonb_agg(jsonb_build_object('handoff',h.payload,'provenance','REAL') order by i.created_at,i.id) from public.raxi_idea_handoffs h join public.raxi_ideas i on i.id=h.idea_id and i.workspace_id=h.workspace_id where h.workspace_id=p_workspace),'[]'::jsonb),
    'session',jsonb_build_object(
      'campaigns',coalesce((select jsonb_agg(c.payload order by c.external_id) from public.raxi_campaigns c where c.workspace_id=p_workspace and c.provenance='REAL'),'[]'::jsonb),
      'strategies',coalesce((select jsonb_agg(s.payload order by c.external_id,s.revision) from public.raxi_strategy_revisions s join public.raxi_campaigns c on c.id=s.campaign_id and c.workspace_id=s.workspace_id where s.workspace_id=p_workspace and c.provenance='REAL'),'[]'::jsonb),
      'decisions',coalesce((select jsonb_agg(a.context->'decision' order by a.decided_at,a.id) from public.raxi_approvals a where a.workspace_id=p_workspace and a.context ? 'decision'),'[]'::jsonb),
      'audit',coalesce((select jsonb_agg(e.event order by a.id,e.ordinality) from public.raxi_audit_events a cross join lateral jsonb_array_elements(a.details->'events') with ordinality e(event,ordinality) where a.workspace_id=p_workspace and a.action='CAMPAIGN_COMMAND_COMMITTED'),'[]'::jsonb),
      'nextCampaignNumber',1+(select count(*) from public.raxi_campaigns c where c.workspace_id=p_workspace and c.provenance='REAL')),
    'receipts',coalesce((select jsonb_agg(jsonb_build_object('operationId',a.details->'command'->>'operationId','command',a.details->'command') order by a.id) from public.raxi_audit_events a where a.workspace_id=p_workspace and a.action='CAMPAIGN_COMMAND_COMMITTED'),'[]'::jsonb)
  ) into result;
  return result;
end; $$;

create function public.raxi_protect_strategy_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' or (old.status in ('APPROVED','CHANGES_REQUESTED') and old is distinct from new) then
    raise exception 'historical revision is immutable' using errcode='23514';
  end if;
  if old.status='IN_REVIEW' and (new.status not in ('APPROVED','CHANGES_REQUESTED') or
    (old.payload-array['status','updatedAt','approvedAt','approvedBy','changeReason']) is distinct from (new.payload-array['status','updatedAt','approvedAt','approvedBy','changeReason'])) then
    raise exception 'submitted content is immutable' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger raxi_strategy_history before update or delete on public.raxi_strategy_revisions for each row execute function public.raxi_protect_strategy_history();

create function public.raxi_protect_deliverable_history() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent uuid; scope uuid;
begin
  if tg_op='UPDATE' and (old.strategy_id is distinct from new.strategy_id or old.workspace_id is distinct from new.workspace_id) then raise exception 'deliverable identity is immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then parent:=old.strategy_id; scope:=old.workspace_id; else parent:=new.strategy_id; scope:=new.workspace_id; end if;
  if exists(select 1 from public.raxi_strategy_revisions s where s.workspace_id=scope and s.id=parent and s.status<>'DRAFT') then raise exception 'historical deliverables are immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger raxi_deliverable_history before insert or update or delete on public.raxi_strategy_deliverables for each row execute function public.raxi_protect_deliverable_history();
create function public.raxi_protect_approval_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'human decisions are immutable' using errcode='23514'; end; $$;
create trigger raxi_approval_history before update or delete on public.raxi_approvals for each row execute function public.raxi_protect_approval_history();
create unique index raxi_strategy_approval_once on public.raxi_approvals(workspace_id,subject_id) where subject_kind='STRATEGY' and action='APPROVED';

create function public.raxi_campaign_commit(p_actor uuid,p_command jsonb,p_next jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  workspace uuid; version bigint; prior jsonb; previous jsonb; request_type text; action jsonb; target text;
  item jsonb; subitem jsonb; old_payload jsonb; old_status text; resource uuid; campaign uuid; idea uuid; strategy uuid;
  decision jsonb; approval_subject uuid; approval_kind text; approval_action text; approval_snapshot jsonb;
  event_count integer; timestamp_now timestamptz:=clock_timestamp();
begin
  if p_actor is null or jsonb_typeof(p_command) is distinct from 'object' or jsonb_typeof(p_next) is distinct from 'object' then raise exception 'invalid command' using errcode='22023'; end if;
  workspace:=(p_command->>'workspaceId')::uuid;
  action:=p_command->'action'; request_type:=action->>'type';
  if (p_command->>'operationId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_command->>'operationId' is null or
    request_type is null or request_type not in ('REVIEW_IDEA','APPROVE_IDEA','HANDOFF_IDEA','CREATE_CAMPAIGN','REJECT_PROPOSAL','TRANSITION_CAMPAIGN','SAVE_STRATEGY','SUBMIT_STRATEGY','SUBMIT_STRATEGY_WITH_INPUT','REQUEST_STRATEGY_CHANGES','APPROVE_STRATEGY','START_STRATEGY_REVISION') then raise exception 'invalid action' using errcode='22023'; end if;
  select w.campaign_version into version from public.raxi_workspaces w where w.id=workspace and w.owner_user_id=p_actor for update;
  if not found then raise exception 'workspace denied' using errcode='42501'; end if;
  select a.details->'command' into prior from public.raxi_audit_events a where a.workspace_id=workspace and a.action='CAMPAIGN_COMMAND_COMMITTED' and a.details->'command'->>'operationId'=p_command->>'operationId';
  if found then
    if prior is distinct from p_command then raise exception 'operation conflict' using errcode='23505'; end if;
    return public.raxi_campaign_snapshot(workspace,p_actor);
  end if;
  if version is distinct from (p_command->>'expectedVersion')::bigint or (p_next->>'version')::bigint is distinct from version+1 then raise exception 'stale version' using errcode='40001'; end if;
  if p_next->>'ownerId' is distinct from p_actor::text or p_next->>'workspaceId' is distinct from workspace::text or
    jsonb_typeof(p_next->'session') is distinct from 'object' or jsonb_typeof(p_next->'ideas') is distinct from 'array' then raise exception 'invalid projection' using errcode='22023'; end if;
  previous:=public.raxi_campaign_snapshot(workspace,p_actor);
  if jsonb_array_length(p_next->'session'->'campaigns')<jsonb_array_length(previous->'session'->'campaigns') or
    jsonb_array_length(p_next->'session'->'strategies')<jsonb_array_length(previous->'session'->'strategies') then raise exception 'history cannot disappear' using errcode='23514'; end if;
  -- Only the specifically requested idea may change, and only through valid transitions.
  for item in select value from jsonb_array_elements(p_next->'ideas') loop
    select i.id,i.payload into idea,old_payload from public.raxi_ideas i where i.workspace_id=workspace and i.external_id=item->>'id';
    if not found then raise exception 'idea missing' using errcode='23514'; end if;
    if old_payload is distinct from item then
      if request_type not in ('REVIEW_IDEA','APPROVE_IDEA','HANDOFF_IDEA') or action->>'ideaId' is distinct from item->>'id' or
        action->>'expectedUpdatedAt' is distinct from old_payload->>'updatedAt' or action->'confirmed' is distinct from 'true'::jsonb or
        (old_payload-array['status','updatedAt','approvedAt','sentToHqAt']) is distinct from (item-array['status','updatedAt','approvedAt','sentToHqAt']) or
        not ((request_type='REVIEW_IDEA' and old_payload->>'status'='PROPOSED' and item->>'status'='UNDER_REVIEW') or
          (request_type='APPROVE_IDEA' and old_payload->>'status'='UNDER_REVIEW' and item->>'status'='APPROVED_FOR_HQ') or
          (request_type='HANDOFF_IDEA' and old_payload->>'status'='APPROVED_FOR_HQ' and item->>'status'='SENT_TO_HQ')) then raise exception 'idea transition denied' using errcode='23514'; end if;
      update public.raxi_ideas set status=item->>'status',payload=item,updated_at=(item->>'updatedAt')::timestamptz where id=idea and workspace_id=workspace;
      if request_type='APPROVE_IDEA' then approval_subject:=idea; approval_kind:='IDEA'; approval_action:='APPROVED'; approval_snapshot:=item; end if;
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_next->'handoffs') loop
    select i.id into idea from public.raxi_ideas i where i.workspace_id=workspace and i.external_id=item->'handoff'->>'ideaId' and i.status='SENT_TO_HQ';
    if not found then raise exception 'unapproved handoff' using errcode='23514'; end if;
    insert into public.raxi_idea_handoffs(workspace_id,idea_id,sent_at,payload) values(workspace,idea,(item->'handoff'->>'sentAt')::timestamptz,item->'handoff') on conflict(workspace_id,idea_id) do nothing;
  end loop;
  for item in select value from jsonb_array_elements(p_next->'session'->'campaigns') loop
    select c.id,c.payload,c.status into campaign,old_payload,old_status from public.raxi_campaigns c where c.workspace_id=workspace and c.external_id=item->>'id';
    if not found then
      if request_type<>'CREATE_CAMPAIGN' or item->>'sourceIdeaId' is distinct from action->>'ideaId' or item->>'status'<>'DRAFT' or item->>'provenance'<>'REAL' then raise exception 'campaign creation denied' using errcode='23514'; end if;
      select i.id into idea from public.raxi_ideas i join public.raxi_idea_handoffs h on h.workspace_id=i.workspace_id and h.idea_id=i.id where i.workspace_id=workspace and i.external_id=item->>'sourceIdeaId' and i.status='SENT_TO_HQ';
      if not found then raise exception 'approved source required' using errcode='23514'; end if;
      insert into public.raxi_campaigns(workspace_id,external_id,source_idea_id,title,status,provenance,payload,created_at,updated_at) values(workspace,item->>'id',idea,item->>'title','DRAFT','REAL',item,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz) returning id into campaign;
    elsif old_payload is distinct from item then
      if request_type<>'TRANSITION_CAMPAIGN' or action->>'campaignId' is distinct from item->>'id' or
        (old_payload-array['status','updatedAt']) is distinct from (item-array['status','updatedAt']) or
        not ((old_status='DRAFT' and item->>'status' in ('PLANNING','CANCELED')) or (old_status='PLANNING' and item->>'status' in ('BLOCKED','CANCELED')) or (old_status='BLOCKED' and item->>'status' in ('PLANNING','CANCELED'))) then raise exception 'campaign transition denied' using errcode='23514'; end if;
      update public.raxi_campaigns set status=item->>'status',payload=item,updated_at=(item->>'updatedAt')::timestamptz where id=campaign and workspace_id=workspace;
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_next->'session'->'strategies') loop
    select c.id into campaign from public.raxi_campaigns c where c.workspace_id=workspace and c.external_id=item->>'campaignId';
    if not found then raise exception 'campaign missing' using errcode='23514'; end if;
    select s.id,s.payload,s.status into strategy,old_payload,old_status from public.raxi_strategy_revisions s where s.workspace_id=workspace and s.campaign_id=campaign and s.revision=(item->>'revision')::integer;
    if old_payload is not distinct from item then continue; end if;
    if action->>'campaignId' is distinct from item->>'campaignId' or (select c.status from public.raxi_campaigns c where c.id=campaign)<>'PLANNING' then raise exception 'strategy write denied' using errcode='23514'; end if;
    if strategy is null then
      if request_type='SAVE_STRATEGY' and exists(select 1 from public.raxi_strategy_revisions s where s.campaign_id=campaign) then raise exception 'explicit new revision required' using errcode='23514'; end if;
      if request_type not in ('SAVE_STRATEGY','START_STRATEGY_REVISION') or item->>'status'<>'DRAFT' or (item->>'revision')::integer<>coalesce((select max(s.revision) from public.raxi_strategy_revisions s where s.campaign_id=campaign),0)+1 then raise exception 'invalid new revision' using errcode='23514'; end if;
      if request_type='START_STRATEGY_REVISION' and (action->'confirmed' is distinct from 'true'::jsonb or (action->>'revision')::integer is distinct from (select max(s.revision) from public.raxi_strategy_revisions s where s.campaign_id=campaign) or not exists(select 1 from public.raxi_strategy_revisions s where s.campaign_id=campaign and s.revision=(action->>'revision')::integer and s.status in ('APPROVED','CHANGES_REQUESTED'))) then raise exception 'revision not confirmed' using errcode='23514'; end if;
      insert into public.raxi_strategy_revisions(workspace_id,campaign_id,revision,status,payload,created_at,updated_at) values(workspace,campaign,(item->>'revision')::integer,'DRAFT',item,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz) returning id into strategy;
    else
      if request_type<>'SAVE_STRATEGY' and (action->>'revision')::integer is distinct from (item->>'revision')::integer then raise exception 'revision mismatch' using errcode='23514'; end if;
      if old_status in ('APPROVED','CHANGES_REQUESTED') or
        not ((old_status='DRAFT' and ((request_type='SAVE_STRATEGY' and item->>'status'='DRAFT') or (request_type in ('SUBMIT_STRATEGY','SUBMIT_STRATEGY_WITH_INPUT') and item->>'status'='IN_REVIEW'))) or
          (old_status='IN_REVIEW' and ((request_type='APPROVE_STRATEGY' and item->>'status'='APPROVED' and action->'confirmed'='true'::jsonb) or (request_type='REQUEST_STRATEGY_CHANGES' and item->>'status'='CHANGES_REQUESTED')))) then raise exception 'invalid strategy transition' using errcode='23514'; end if;
    end if;
    if old_status is null or old_status='DRAFT' then
      delete from public.raxi_strategy_deliverables d where d.workspace_id=workspace and d.strategy_id=strategy and not exists(select 1 from jsonb_array_elements(item->'deliverables') v where v->>'id'=d.external_id);
      for subitem in select value from jsonb_array_elements(item->'deliverables') loop
        insert into public.raxi_strategy_deliverables(workspace_id,strategy_id,external_id,channel,content_level,format,quantity,payload) values(workspace,strategy,subitem->>'id',subitem->>'channel',subitem->>'contentLevel',subitem->>'format',(subitem->>'quantity')::integer,subitem)
        on conflict(workspace_id,strategy_id,external_id) do update set channel=excluded.channel,content_level=excluded.content_level,format=excluded.format,quantity=excluded.quantity,payload=excluded.payload;
      end loop;
    end if;
    update public.raxi_strategy_revisions set status=item->>'status',payload=item,updated_at=(item->>'updatedAt')::timestamptz,
      approved_by=case when item->>'status'='APPROVED' then p_actor else null end,approved_at=case when item->>'status'='APPROVED' then (item->>'approvedAt')::timestamptz else null end where id=strategy and workspace_id=workspace;
    if request_type in ('APPROVE_STRATEGY','REQUEST_STRATEGY_CHANGES') then approval_subject:=strategy; approval_kind:='STRATEGY'; approval_action:=case when request_type='APPROVE_STRATEGY' then 'APPROVED' else 'CHANGES_REQUESTED' end; approval_snapshot:=item; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_next->'session'->'decisions') loop
    if exists(select 1 from jsonb_array_elements(previous->'session'->'decisions') d where d->>'ideaId'=item->>'ideaId') then continue; end if;
    select i.id into idea from public.raxi_ideas i where i.workspace_id=workspace and i.external_id=item->>'ideaId' and i.status='SENT_TO_HQ';
    if not found or request_type not in ('CREATE_CAMPAIGN','REJECT_PROPOSAL') or action->>'ideaId' is distinct from item->>'ideaId' then raise exception 'decision denied' using errcode='23514'; end if;
    insert into public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context,decided_at)
      values(workspace,'IDEA',idea,case when item->>'status'='ACCEPTED' then 'APPROVED' else 'REJECTED' end,p_actor,p_command->>'operationId',jsonb_build_object('decision',item,'command',p_command),timestamp_now);
  end loop;
  if approval_subject is not null then
    insert into public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context,decided_at)
      values(workspace,approval_kind,approval_subject,approval_action,p_actor,p_command->>'operationId',jsonb_build_object('snapshot',approval_snapshot,'command',p_command),timestamp_now);
  end if;
  event_count:=jsonb_array_length(previous->'session'->'audit');
  if (select coalesce(jsonb_agg(v order by n),'[]'::jsonb) from jsonb_array_elements(p_next->'session'->'audit') with ordinality a(v,n) where n<=event_count) is distinct from previous->'session'->'audit' then raise exception 'audit history changed' using errcode='23514'; end if;
  insert into public.raxi_audit_events(workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,source_ref,details,occurred_at)
    values(workspace,'CAMPAIGN_COMMAND_COMMITTED','HUMAN',p_actor,'WORKSPACE',workspace::text,'edge:campaign-command',jsonb_build_object('command',p_command,'version',version+1,'events',(select coalesce(jsonb_agg(v order by n),'[]'::jsonb) from jsonb_array_elements(p_next->'session'->'audit') with ordinality a(v,n) where n>event_count)),timestamp_now);
  update public.raxi_workspaces set campaign_version=version+1 where id=workspace;
  return public.raxi_campaign_snapshot(workspace,p_actor);
end; $$;
revoke all on function public.raxi_campaign_snapshot(uuid,uuid),public.raxi_campaign_commit(uuid,jsonb,jsonb),public.raxi_protect_strategy_history(),public.raxi_protect_deliverable_history(),public.raxi_protect_approval_history() from public,anon,authenticated;
grant execute on function public.raxi_campaign_snapshot(uuid,uuid) to authenticated,service_role;
grant execute on function public.raxi_campaign_commit(uuid,jsonb,jsonb) to service_role;
