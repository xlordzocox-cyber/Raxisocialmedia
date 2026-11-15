-- Only synthetic entities for independent-connection PG17 race QA.
-- Loaded into a NEW local disposable DB after the base fixture and proposal.
create table public.raxi_issue49_concurrency_inputs(
 scenario text primary key,workspace_id uuid not null,request_key uuid not null,
 approval_key uuid not null,identity jsonb not null,spec jsonb not null
);
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into auth.sessions(id,user_id,not_after)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '1 hour');
with v(scenario,workspace_id,request_key,approval_key) as(
 values
 ('prepare_same','11111111-1111-4111-8111-111111111111'::uuid,
  '11111111-aaaa-4111-8111-111111111111'::uuid,
  '11111111-bbbb-4111-8111-111111111111'::uuid),
 ('prepare_conflict','22222222-2222-4222-8222-222222222222'::uuid,
  '22222222-aaaa-4222-8222-222222222222'::uuid,
  '22222222-bbbb-4222-8222-222222222222'::uuid),
 ('approval_same','33333333-3333-4333-8333-333333333333'::uuid,
  '33333333-aaaa-4333-8333-333333333333'::uuid,
  '33333333-bbbb-4333-8333-333333333333'::uuid),
 ('approval_conflict','44444444-4444-4444-8444-444444444444'::uuid,
  '44444444-aaaa-4444-8444-444444444444'::uuid,
  '44444444-bbbb-4444-8444-444444444444'::uuid),
 ('approval_rollback','55555555-5555-4555-8555-555555555555'::uuid,
  '55555555-aaaa-4555-8555-555555555555'::uuid,
  '55555555-bbbb-4555-8555-555555555555'::uuid)
)
insert into public.raxi_issue49_concurrency_inputs
select scenario,workspace_id,request_key,approval_key,
 jsonb_build_object('provenance','SUPABASE_AUTH_STAGING',
  'actorId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sessionId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'workspaceId',workspace_id,'projectRef','zvhxjindgyvtasstfjut',
  'expiresAt',to_char(clock_timestamp()+interval '45 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 jsonb_build_object('question','Prepare a synthetic editorial plan and do not execute',
  'externalResearch',false,'provider','openai','model','synthetic-test-model',
  'authorization',jsonb_build_object('confirmed',true,
    'maxCostMicros',5000,
    'expiresAt',to_char(clock_timestamp()+interval '20 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
from v;
insert into public.raxi_workspaces(id,owner_user_id,slug,name)
select workspace_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',scenario,'Synthetic Race QA'
from public.raxi_issue49_concurrency_inputs;
insert into public.raxi_runtime_policies(
 workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,
 max_tasks,max_output_tokens,expires_at)
select workspace_id,true,false,'openai','synthetic-test-model',5000,4000,1,128,
 clock_timestamp()+interval '50 minutes'
from public.raxi_issue49_concurrency_inputs;
