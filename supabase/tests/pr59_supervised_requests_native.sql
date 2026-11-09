-- Synthetic fixture for the manual PR #59 PG17 rehearsal. See the safety gates
-- in RAXI_HQ_SUPERVISED_CAMPAIGN_REQUESTS.md before opening any psql session.
do $$
begin
  if current_database()<>'raxi_validation' or current_user<>'raxi_local'
    or current_setting('server_version_num')::int not between 170000 and 179999
    or inet_server_addr() is not null
    or exists (select 1 from public.raxi_workspaces) or exists (select 1 from auth.users)
    or exists (select 1 from public.raxi_audit_events)
  then raise exception 'PR59 requires a clean, dedicated native lab'; end if;
  if not (select relrowsecurity from pg_class where oid='public.raxi_audit_events'::regclass)
    or has_table_privilege('authenticated','public.raxi_audit_events','INSERT')
    or has_table_privilege('service_role','public.raxi_audit_events','TRUNCATE')
    or has_function_privilege('anon','public.raxi_supervised_campaign_request_commit(jsonb,jsonb,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.raxi_supervised_campaign_request_replay(jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.raxi_supervised_campaign_request_commit(jsonb,jsonb,jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.raxi_supervised_host_identity(jsonb)','EXECUTE')
    or not has_column_privilege('service_role','auth.sessions','not_after','SELECT')
    or not has_column_privilege('service_role','auth.users','is_anonymous','SELECT')
  then raise exception 'PR59 role/RLS contract failed'; end if;
end;
$$;

do $$
declare
  ws constant uuid := '59000000-0000-4000-8000-000000000001';
  owner_id constant uuid := '59000000-0000-4000-8000-000000000002';
  session_id constant uuid := '59000000-0000-4000-8000-000000000003';
  operation_id constant text := '59000000-0000-4000-8000-000000000004';
  idea_id uuid;
  campaign_id uuid;
  strategy_id uuid;
  approval_time text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  strategy jsonb;
  command jsonb;
  items jsonb;
  item jsonb;
begin
  insert into auth.users(id) values(owner_id);
  insert into auth.sessions(id,user_id) values(session_id,owner_id);
  insert into public.raxi_workspaces(id,owner_user_id,slug,name,campaign_version)
    values(ws,owner_id,'pr59-lab','PR59 synthetic',1);
  insert into public.raxi_ideas(workspace_id,external_id,kind,title,status,source)
    values(ws,'IDEA-PR59-FIXTURE','PROPOSAL','Synthetic','SENT_TO_HQ','LOCAL_FIXTURE') returning id into idea_id;
  insert into public.raxi_campaigns(workspace_id,external_id,source_idea_id,title,status,provenance,payload)
    values(ws,'CAMPAIGN-958',idea_id,'Synthetic','PLANNING','REAL','{"id":"CAMPAIGN-958","status":"PLANNING","provenance":"REAL"}')
    returning id into campaign_id;
  select jsonb_agg(jsonb_build_object('id','STRATEGY-ITEM-'||lpad(i::text,3,'0'),'channel','INSTAGRAM_FEED',
    'contentLevel','PUBLIC_SOCIAL','format','PHOTO','quantity',1) order by i) into items from generate_series(1,4) i;
  strategy := jsonb_build_object('campaignId','CAMPAIGN-958','revision',1,'status','APPROVED',
    'approvedBy','LUIS','approvedAt',approval_time,'deliverables',items);
  -- The existing history trigger permits adding deliverables only while the parent is DRAFT.
  insert into public.raxi_strategy_revisions(workspace_id,campaign_id,revision,status,payload)
    values(ws,campaign_id,1,'DRAFT','{}') returning id into strategy_id;
  for item in select value from jsonb_array_elements(items) loop
    insert into public.raxi_strategy_deliverables(workspace_id,strategy_id,external_id,channel,content_level,format,quantity,payload)
      values(ws,strategy_id,item->>'id','INSTAGRAM_FEED','PUBLIC_SOCIAL','PHOTO',1,item);
  end loop;
  update public.raxi_strategy_revisions set status='APPROVED',payload=strategy,
    approved_by=owner_id,approved_at=approval_time::timestamptz where id=strategy_id;
  command := jsonb_build_object('operationId',operation_id,'workspaceId',ws,'expectedVersion',0,
    'action',jsonb_build_object('type','APPROVE_STRATEGY','campaignId','CAMPAIGN-958','revision',1,'confirmed',true));
  insert into public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
    values(ws,'STRATEGY',strategy_id,'APPROVED',owner_id,operation_id,jsonb_build_object('command',command,'snapshot',strategy));
  insert into public.raxi_audit_events(workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,details)
    values(ws,'CAMPAIGN_COMMAND_COMMITTED','HUMAN',owner_id,'WORKSPACE',ws::text,
      jsonb_build_object('command',command,'version',1,'events',jsonb_build_array(jsonb_build_object(
        'action','STRATEGY_APPROVED','campaignId','CAMPAIGN-958','revision',1,'actor','LUIS','timestamp',approval_time))));
end;
$$;

create schema raxi_pr59_fixture;
grant usage on schema raxi_pr59_fixture to service_role;
create function raxi_pr59_fixture.request(item integer, key uuid, seconds integer default 60) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  ws constant uuid := '59000000-0000-4000-8000-000000000001';
  owner_id constant uuid := '59000000-0000-4000-8000-000000000002';
  identity jsonb;
  snapshot jsonb;
  evidence jsonb;
  command jsonb;
begin
  identity := jsonb_build_object('provenance','SUPABASE_AUTH_STAGING','actorId',owner_id,
    'sessionId','59000000-0000-4000-8000-000000000003','workspaceId',ws,
    'projectRef','zzzzzzzzzzzzzzzzzzzz','expiresAt',clock_timestamp()+make_interval(secs=>seconds));
  snapshot := public.raxi_campaign_snapshot(ws,owner_id)-'serverTime';
  evidence := jsonb_build_object('campaign',snapshot->'session'->'campaigns'->0,
    'strategy',snapshot->'session'->'strategies'->0,'approvalReceipt',snapshot->'receipts'->0,
    'approvalEvent',snapshot->'session'->'audit'->0);
  command := jsonb_build_object('workspaceId',ws,'campaignId','CAMPAIGN-958','strategyRevision',1,
    'deliverableId','STRATEGY-ITEM-'||lpad(item::text,3,'0'),'expectedCampaignVersion',1,
    'purpose','PREPARE_VISUAL_BRIEF','requestKey',key,'snapshotHash',repeat('a',64));
  -- Synthetic digest for native SQL tests only. The HTTP integration checks real digests.
  return public.raxi_supervised_campaign_request_commit(identity,command,snapshot,evidence);
end;
$$;
revoke all on function raxi_pr59_fixture.request(integer,uuid,integer) from public, anon, authenticated;
grant execute on function raxi_pr59_fixture.request(integer,uuid,integer) to service_role;
