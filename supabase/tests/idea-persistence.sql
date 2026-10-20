-- Run via an authorized database connection. All probe rows are ROLLED BACK.
-- The owner is looked up from the real workspace; never copied into source.
begin;
do $$
declare
  workspace uuid;
  owner_id uuid;
  foreign_id uuid := gen_random_uuid();
  command jsonb;
  first_response jsonb;
  second_response jsonb;
  before_ideas bigint;
  before_audits bigint;
begin
  select w.id, w.owner_user_id into strict workspace, owner_id from public.raxi_workspaces w where w.slug='raxi-hq' limit 1;
  select count(*) into before_ideas from public.raxi_ideas;
  select count(*) into before_audits from public.raxi_audit_events;
  command := jsonb_build_object('workspaceId',workspace,'externalId','IDEA-REAL-'||gen_random_uuid(),
    'operationId',gen_random_uuid(),'input',jsonb_build_object('title','Transactional persistence probe','note','This row must roll back.','priority','MEDIUM'));

  execute 'set local role anon';
  begin
    insert into public.raxi_ideas(workspace_id,external_id,kind,title,status,source)
      values(workspace,command->>'externalId','PROPOSAL','Unauthorized','PROPOSED','MANUAL_LUIS');
    raise exception 'FAIL anonymous write accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.raxi_create_manual_idea(owner_id,command);
    raise exception 'FAIL anonymous RPC accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  -- A different JWT subject, evaluated by the actual authenticated role and RLS.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',foreign_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.raxi_workspaces where id=workspace) or exists(select 1 from public.raxi_ideas where workspace_id=workspace) then
    raise exception 'FAIL foreign workspace visible';
  end if;
  begin
    perform public.raxi_list_manual_ideas(workspace);
    raise exception 'FAIL foreign read RPC accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.raxi_workspaces(owner_user_id,slug,name) values(owner_id,'foreign-probe','Forbidden');
    raise exception 'FAIL foreign owner accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.raxi_create_manual_idea(owner_id,command);
    raise exception 'FAIL authenticated caller bypassed Edge';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if public.raxi_get_workspace()->>'id' is distinct from workspace::text then raise exception 'FAIL owner cannot read workspace'; end if;
  if public.raxi_create_workspace()->>'id' is distinct from workspace::text then raise exception 'FAIL workspace creation not idempotent'; end if;
  begin
    insert into public.raxi_ideas(workspace_id,external_id,kind,title,status,source)
      values(workspace,command->>'externalId','PROPOSAL','Bypass','PROPOSED','MANUAL_LUIS');
    raise exception 'FAIL direct owner write accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  execute 'set local role service_role';
  first_response := public.raxi_create_manual_idea(owner_id,command);
  second_response := public.raxi_create_manual_idea(owner_id,command);
  if first_response is distinct from second_response then raise exception 'FAIL replay changed canonical result'; end if;
  if first_response->'idea'->>'id' is distinct from command->>'externalId' or first_response->>'auditId' is null then raise exception 'FAIL external ID or audit missing'; end if;
  begin
    perform public.raxi_create_manual_idea(owner_id,jsonb_set(command,'{input,title}','"Different payload"'));
    raise exception 'FAIL idempotency conflict accepted';
  exception when unique_violation then null; end;
  begin
    perform public.raxi_create_manual_idea(owner_id,jsonb_set(command,'{operationId}',to_jsonb(gen_random_uuid()::text)));
    raise exception 'FAIL duplicate external ID accepted';
  exception when unique_violation then null; end;
  begin
    perform public.raxi_create_manual_idea(foreign_id,command);
    raise exception 'FAIL foreign actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.raxi_create_manual_idea(owner_id,command||'{"status":"APPROVED_FOR_HQ"}'::jsonb);
    raise exception 'FAIL approval injected';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  if (select count(*) from public.raxi_ideas) <> before_ideas+1 or (select count(*) from public.raxi_audit_events) <> before_audits+1 then raise exception 'FAIL operation was not exactly once'; end if;
end;
$$;
select 'PASS' as authorization_idempotency_audit, 'ROLLBACK: no probe rows persisted' as disposition;
rollback;
