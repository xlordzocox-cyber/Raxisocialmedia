-- ISSUE #49: REAL native PostgreSQL17 OFFLINE rate-contract acceptance.
-- Run after synthetic fixture + hosted function snapshot, never on Supabase.
\set ON_ERROR_STOP on
create function pg_temp.expect_rate_denied(p_label text,p_statement text) returns void
 language plpgsql as $f$
begin
 begin
  execute p_statement;
 exception when sqlstate '42501' or sqlstate '22023' then
  raise notice 'PASS_EXPECTED_RATE_DENIAL: %',p_label;
  return;
 end;
 raise exception 'RATE_DENIAL_EXPECTED: %',p_label;
end; $f$;

do $acl$
begin
 if not (select relrowsecurity from pg_class
  where oid='public.raxi_supervised_request_rate_counters'::regclass) or
  has_table_privilege('anon','public.raxi_supervised_request_rate_counters','SELECT') or
  has_table_privilege('authenticated','public.raxi_supervised_request_rate_counters','SELECT') or
  has_table_privilege('service_role','public.raxi_supervised_request_rate_counters','DELETE') or
  has_table_privilege('service_role','public.raxi_supervised_request_rate_counters','TRUNCATE') or
  has_function_privilege('anon','public.raxi_supervised_request_rate_admit(jsonb,text)','EXECUTE') or
  has_function_privilege('authenticated','public.raxi_supervised_request_rate_admit(jsonb,text)','EXECUTE') or
  not has_function_privilege('service_role','public.raxi_supervised_request_rate_admit(jsonb,text)','EXECUTE')
 then raise exception 'RATE_RPC_ACL_NO_GO';end if;
 raise notice 'PASS_RATE_RPC_RLS_AND_SERVICE_ONLY_ACL';
end; $acl$;
-- The function's actual PostgreSQL catalog serialization MUST match staging.
do $sha$
begin
 if encode(sha256(convert_to(
    pg_get_functiondef('public.raxi_supervised_request_rate_admit(jsonb,text)'::regprocedure),
    'UTF8')),'hex') is distinct from
    '57b94e50e622acb3c6dee7e41707993b1f0d0a2087d358627e2a455d817e67b7'
 then raise exception 'RATE_HOSTED_FUNCTION_SHA_PARITY_NO_GO';end if;
 raise notice 'PASS_RATE_HOSTED_FUNCTION_SHA_PARITY';
end; $sha$;
do $fixture$
declare
 wid uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 owner_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 sid uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
begin
 insert into auth.users(id) values(owner_id);
 insert into auth.sessions(id,user_id,not_after)
  values(sid,owner_id,clock_timestamp()+interval '2 hours');
 insert into public.raxi_workspaces(id,owner_user_id,slug,name)
  values(wid,owner_id,'rate-lab','Rate lab only');
end; $fixture$;

set role service_role;
do $test$
declare
 identity jsonb;
 v text;
 n int;
begin
 identity:=jsonb_build_object(
  'provenance','SUPABASE_AUTH_STAGING',
  'actorId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sessionId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'workspaceId','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'projectRef','zvhxjindgyvtasstfjut',
  'expiresAt',to_char(clock_timestamp()+interval '45 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 for n in 1..30 loop
  select public.raxi_supervised_request_rate_admit(identity,'PREFLIGHT')->>'status'
   into v;
  if v <> 'ALLOWED' then raise exception 'RATE_EXPECTED_ALLOWED_%',n;end if;
 end loop;
 select public.raxi_supervised_request_rate_admit(identity,'PREFLIGHT')->>'status'
  into v;
 if v<>'RATE_LIMITED' then raise exception 'RATE_EXPECTED_DENIAL_31';end if;
 if (select request_count from public.raxi_supervised_request_rate_counters
     where operation='PREFLIGHT')<>30 then
  raise exception 'RATE_DENIED_REQUEST_CHANGED_COUNTER';end if;
 raise notice 'PASS_RATE_SQL_30_ALLOWED_31ST_DENIED_NO_INCREMENT';

 for n in 1..3 loop
  select public.raxi_supervised_request_rate_admit(identity,'SUBMIT')->>'status'
   into v;
  if v<>'ALLOWED' then raise exception 'SUBMIT_RATE_FAIL';end if;
 end loop;
 if (public.raxi_supervised_request_rate_admit(identity,'SUBMIT')->>'status')<>'RATE_LIMITED'
 then raise exception 'SUBMIT_RATE_LIMIT_NOT_ENFORCED';end if;
 raise notice 'PASS_RATE_SUBMIT_LIMIT_THREE';

 perform pg_temp.expect_rate_denied('invalid operation',
   format('select public.raxi_supervised_request_rate_admit(%L::jsonb,%L)',
     identity::text,'EXECUTE'));
 -- Read-only synthetic session revocation, never hosted Auth mutation.
 update auth.sessions set not_after=clock_timestamp()-interval '1 second'
  where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid;
 perform pg_temp.expect_rate_denied('revoked session',
   format('select public.raxi_supervised_request_rate_admit(%L::jsonb,%L)',
    identity::text,'PREFLIGHT'));
 if (select request_count from public.raxi_supervised_request_rate_counters
     where operation='PREFLIGHT')<>30 then raise exception 'REVOKE_CHANGED_COUNTER';end if;
 raise notice 'PASS_RATE_REVOKED_SESSION_BLOCKS_DB_ADMISSION';
end; $test$;
reset role;
select 'PASS_RATE_NATIVE_PG17_OFFLINE_CONTRACT' as final_result;
