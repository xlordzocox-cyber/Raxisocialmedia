-- v0.9: built against the three fetched, already-applied migrations.
-- Operational table grants/RLS stay read-only for authenticated clients.
create unique index if not exists raxi_manual_idea_operation_once
on public.raxi_audit_events (workspace_id, (details->>'operationId'))
where action = 'IDEA_MANUAL_CREATED' and resource_kind = 'IDEA';
create unique index if not exists raxi_manual_idea_audit_once
on public.raxi_audit_events (workspace_id, resource_id)
where action = 'IDEA_MANUAL_CREATED' and resource_kind = 'IDEA';

create or replace function public.raxi_get_workspace() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', w.id, 'ownerId', w.owner_user_id, 'name', w.slug)
  from public.raxi_workspaces w where w.owner_user_id = (select auth.uid()) and w.slug = 'raxi-hq';
$$;
create or replace function public.raxi_create_workspace() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'authenticated account required' using errcode = '42501';
  end if;
  insert into public.raxi_workspaces (owner_user_id, slug, name)
    values (actor, 'raxi-hq', 'Raxi HQ') on conflict (owner_user_id, slug) do nothing;
  return public.raxi_get_workspace();
end;
$$;

create or replace function public.raxi_list_manual_ideas(p_workspace uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.raxi_workspaces w where w.id = p_workspace and w.owner_user_id = (select auth.uid())) then
    raise exception 'workspace denied' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'databaseId', i.id, 'workspaceId', i.workspace_id, 'ownerId', a.actor_user_id,
    'auditId', a.id::text, 'provenance', 'MANUAL_LUIS', 'idea', i.payload
  ) order by i.created_at, i.id)
  from public.raxi_ideas i join public.raxi_audit_events a on a.workspace_id = i.workspace_id
    and a.resource_id = i.id::text and a.resource_kind = 'IDEA' and a.action = 'IDEA_MANUAL_CREATED'
  where i.workspace_id = p_workspace and i.source = 'MANUAL_LUIS' and i.external_id like 'IDEA-REAL-%'), '[]'::jsonb);
end;
$$;

-- Only the managed Edge service role can call this transaction. The actor is
-- obtained by Edge getUser(JWT), never from a request body or local storage.
create or replace function public.raxi_create_manual_idea(p_actor uuid, p_command jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  workspace uuid;
  operation text;
  external text;
  input jsonb;
  timestamp_now timestamptz := clock_timestamp();
  idea public.raxi_ideas;
  audit public.raxi_audit_events;
  snapshot jsonb;
begin
  if p_actor is null or jsonb_typeof(p_command) is distinct from 'object' or
    exists (select 1 from jsonb_object_keys(p_command) k where k not in ('workspaceId','operationId','externalId','input')) then
    raise exception 'invalid command' using errcode = '22023';
  end if;
  workspace := (p_command->>'workspaceId')::uuid;
  operation := p_command->>'operationId';
  external := p_command->>'externalId';
  input := p_command->'input';
  if workspace is null or operation is null or operation !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
    external is null or external !~* '^IDEA-REAL-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
    jsonb_typeof(input) is distinct from 'object' then
    raise exception 'invalid identifiers or input' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(input) k where k not in ('title','note','priority','sourceRef')) or
    jsonb_typeof(input->'title') is distinct from 'string' or
    jsonb_typeof(input->'note') is distinct from 'string' or
    jsonb_typeof(input->'priority') is distinct from 'string' or
    length(btrim(input->>'title')) = 0 or length(input->>'title') > 120 or (input->>'title') ~ '[[:cntrl:]]' or
    length(btrim(input->>'note')) = 0 or length(input->>'note') > 1000 or replace(input->>'note', chr(10), '') ~ '[[:cntrl:]]' or
    input->>'priority' not in ('LOW','MEDIUM','HIGH','URGENT') or
    (input ? 'sourceRef' and (jsonb_typeof(input->'sourceRef') is distinct from 'string' or length(btrim(input->>'sourceRef')) = 0 or length(input->>'sourceRef') > 256 or (input->>'sourceRef') ~ '[[:cntrl:]]')) then
    raise exception 'invalid manual fields or transition' using errcode = '22023';
  end if;
  -- Ownership check and workspace lock precede ALL reads of idempotency records.
  perform 1 from public.raxi_workspaces w where w.id = workspace and w.owner_user_id = p_actor for update;
  if not found then raise exception 'workspace denied' using errcode = '42501'; end if;
  select * into audit from public.raxi_audit_events a where a.workspace_id = workspace
    and a.action = 'IDEA_MANUAL_CREATED' and a.resource_kind = 'IDEA' and a.details->>'operationId' = operation;
  if found then
    if audit.actor_user_id is distinct from p_actor or audit.details->'command' is distinct from p_command then
      raise exception 'idempotency conflict' using errcode = '23505';
    end if;
    select * into strict idea from public.raxi_ideas i where i.workspace_id = workspace and i.id::text = audit.resource_id;
  else
    snapshot := jsonb_build_object('id', external, 'title', input->>'title', 'summary', input->>'note',
      'source','MANUAL_LUIS','status','PROPOSED','priority',input->>'priority',
      'createdAt',timestamp_now,'updatedAt',timestamp_now,
      'reason','Captura manual de Luis. Sin investigación verificada.',
      'suggestedChannels','[]'::jsonb,'tags','[]'::jsonb,'fitScore',0,'confidenceScore',0,
      'evidence',case when input ? 'sourceRef' then jsonb_build_array(jsonb_build_object(
        'id',external || '-REF','kind','MANUAL_NOTE','label','Referencia manual sin verificar',
        'sourceRef',input->>'sourceRef','capturedAt',timestamp_now)) else '[]'::jsonb end);
    insert into public.raxi_ideas (workspace_id,external_id,kind,title,status,source,summary,priority,payload,created_at,updated_at)
      values (workspace,external,'PROPOSAL',input->>'title','PROPOSED','MANUAL_LUIS',input->>'note',input->>'priority',snapshot,timestamp_now,timestamp_now)
      returning * into idea;
    insert into public.raxi_audit_events (workspace_id,action,actor_kind,actor_user_id,resource_kind,resource_id,source_ref,details,occurred_at)
      values (workspace,'IDEA_MANUAL_CREATED','HUMAN',p_actor,'IDEA',idea.id::text,'edge:create-real-idea',
        jsonb_build_object('operationId',operation,'externalId',external,'command',p_command),timestamp_now)
      returning * into audit;
  end if;
  return jsonb_build_object('databaseId',idea.id,'workspaceId',workspace,'ownerId',p_actor,
    'auditId',audit.id::text,'provenance','MANUAL_LUIS','idea',idea.payload);
end;
$$;

revoke all on function public.raxi_get_workspace() from public, anon;
revoke all on function public.raxi_create_workspace() from public, anon;
revoke all on function public.raxi_list_manual_ideas(uuid) from public, anon;
revoke all on function public.raxi_create_manual_idea(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.raxi_get_workspace(), public.raxi_create_workspace(), public.raxi_list_manual_ideas(uuid) to authenticated;
grant execute on function public.raxi_create_manual_idea(uuid,jsonb) to service_role;
