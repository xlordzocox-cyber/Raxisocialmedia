-- Issue49 Director pre-JWT rate proposal: PostgreSQL17 executable QA only.
-- Run in disposable --network none cluster after synthetic fixture + candidate.
\set ON_ERROR_STOP on

do $acl$
begin
 if to_regclass('public.raxi_director_preauth_counters') is null or
    not (select relrowsecurity from pg_class
         where oid='public.raxi_director_preauth_counters'::regclass) or
    has_table_privilege('anon','public.raxi_director_preauth_counters','SELECT') or
    has_table_privilege('authenticated','public.raxi_director_preauth_counters','INSERT') or
    has_table_privilege('authenticated','public.raxi_director_preauth_counters','DELETE') or
    has_function_privilege('anon','public.raxi_director_preauth_admit(text)','EXECUTE') or
    has_function_privilege('authenticated','public.raxi_director_preauth_admit(text)','EXECUTE') or
    has_table_privilege('service_role','public.raxi_director_preauth_counters','TRUNCATE') or
    not has_function_privilege('service_role','public.raxi_director_preauth_admit(text)','EXECUTE')
 then raise exception 'PREAUTH_ACL_OR_RLS_NO_GO';end if;
 raise notice 'PASS_PREAUTH_SQL_SERVICE_ONLY_RLS_ACL';
end; $acl$;

set role service_role;
do $qa$
declare v jsonb; i integer; v_digest text; v_start_minute bigint;
begin
 -- Constrain the entire sequential quota exercise to one PostgreSQL minute.
 -- If the window changes, the wrapper will discard the attempt and retry.
 v_start_minute:=floor(extract(epoch from clock_timestamp())/60)::bigint;
 -- Without a signed JWT, the trusted host uses an HMAC digest; the DB
 -- consumes only a 64-hex digest, never a raw IP or caller header.
 for i in 1..8 loop
  v:=public.raxi_director_preauth_admit(repeat('a',64));
  if floor(extract(epoch from clock_timestamp())/60)::bigint<>v_start_minute
   then raise exception 'PREAUTH_QA_MINUTE_ROLLOVER_RETRY'; end if;
  if v is distinct from '{"status":"ALLOWED"}'::jsonb then
   raise exception 'PREAUTH_CLIENT_ALLOWED_%',i;end if;
 end loop;
 for i in 1..3 loop
  v:=public.raxi_director_preauth_admit(repeat('a',64));
  if floor(extract(epoch from clock_timestamp())/60)::bigint<>v_start_minute
   then raise exception 'PREAUTH_QA_MINUTE_ROLLOVER_RETRY'; end if;
  if v is distinct from '{"status":"RATE_LIMITED"}'::jsonb then
   raise exception 'PREAUTH_CLIENT_DENIAL_%',i;end if;
 end loop;
  if floor(extract(epoch from clock_timestamp())/60)::bigint<>v_start_minute
   then raise exception 'PREAUTH_QA_MINUTE_ROLLOVER_RETRY'; end if;
 if (select hit_count from public.raxi_director_preauth_counters
      where slot='CLIENT:'||repeat('a',64))<>8 or
    (select hit_count from public.raxi_director_preauth_counters
      where slot='GLOBAL')<>8
 then raise exception 'PREAUTH_CLIENT_DENIAL_INCREMENTED'; end if;
 raise notice 'PASS_PREAUTH_CLIENT_8_ALLOWED_9TH_DENIED';

 -- Distinct host-minted client identities share one atomic global quota.
 for i in 1..52 loop
  v_digest:=lpad(to_hex(i),64,'0');
  v:=public.raxi_director_preauth_admit(v_digest);
  if floor(extract(epoch from clock_timestamp())/60)::bigint<>v_start_minute
   then raise exception 'PREAUTH_QA_MINUTE_ROLLOVER_RETRY'; end if;
  if v is distinct from '{"status":"ALLOWED"}'::jsonb then
   raise exception 'PREAUTH_GLOBAL_ALLOWED_%',i;end if;
 end loop;
 v:=public.raxi_director_preauth_admit(repeat('b',64));
  if floor(extract(epoch from clock_timestamp())/60)::bigint<>v_start_minute
   then raise exception 'PREAUTH_QA_MINUTE_ROLLOVER_RETRY'; end if;
 if v is distinct from '{"status":"RATE_LIMITED"}'::jsonb then
  raise exception 'PREAUTH_GLOBAL_LIMIT_NOT_ENFORCED'; end if;
  if floor(extract(epoch from clock_timestamp())/60)::bigint<>v_start_minute
   then raise exception 'PREAUTH_QA_MINUTE_ROLLOVER_RETRY'; end if;
 if (select hit_count from public.raxi_director_preauth_counters
      where slot='GLOBAL')<>60 or
    exists(select 1 from public.raxi_director_preauth_counters
      where slot='CLIENT:'||repeat('b',64))
 then raise exception 'PREAUTH_DENIAL_MUTATED_COUNTER_OR_ALLOCATED_KEY'; end if;
 raise notice 'PASS_PREAUTH_GLOBAL_60_ALLOWED_61ST_DENIED_NO_KEY_ALLOCATION';

 for i in 1..3 loop
  begin
   perform public.raxi_director_preauth_admit(
    case i when 1 then 'untrusted'
      when 2 then upper(repeat('a',64))
      else null end);
   raise exception 'PREAUTH_ACCEPTED_BAD_DIGEST_%',i;
  exception when sqlstate '22023' then null;end;
 end loop;
 raise notice 'PASS_PREAUTH_REJECTS_UNTRUSTED_DIGESTS';

 -- Simulate a new minute and check bounded retention of inactive keyed rows.
 update public.raxi_director_preauth_counters
 set minute_epoch=minute_epoch-1 where slot='GLOBAL';
 update public.raxi_director_preauth_counters
 set touched_at=clock_timestamp()-interval '3 hours'
 where slot<>'GLOBAL' and slot<>'CLIENT:'||repeat('a',64);
 v:=public.raxi_director_preauth_admit(repeat('c',64));
 if v is distinct from '{"status":"ALLOWED"}'::jsonb then
  raise exception 'PREAUTH_MINUTE_RESET_NO_GO';end if;
 if (select count(*) from public.raxi_director_preauth_counters
     where slot<>'GLOBAL' and touched_at<clock_timestamp()-interval '2 hours')>44
 then raise exception 'PREAUTH_EXPIRY_DID_NOT_CLEAN_LIMITED_BATCH';end if;
 raise notice 'PASS_PREAUTH_BOUNDED_STALE_CLIENT_CLEANUP';
end; $qa$;
reset role;

begin isolation level repeatable read;
set local role service_role;
do $isolation$
begin
 begin
  perform public.raxi_director_preauth_admit(repeat('d',64));
 exception when sqlstate '25001' then
  raise notice 'PASS_PREAUTH_DENIES_UNSAFE_TX_ISOLATION';
  return;
 end;
 raise exception 'PREAUTH_UNSAFE_ISOLATION_ALLOWED';
end; $isolation$;
rollback;
select 'PASS_PREAUTH_REAL_PG17_OFFLINE_QA' as final_result;
