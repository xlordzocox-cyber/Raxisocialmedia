-- RAXI HQ / ISSUE #49 / READ-ONLY POST-INSTALL ATTESTATION.
-- Only run after a SEPARATELY AUTHORIZED candidate schema installation.
-- This never inserts pilot work, runs AI, changes policies, or enables jobs.
do $issue49_postflight$
declare
 v_oid oid:=to_regclass('public.raxi_director_real_pilots');
 v_def text;
begin
 if v_oid is null then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: candidate table missing';
 end if;
 if (select not c.relrowsecurity from pg_class c where c.oid=v_oid) then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: pilot row level security disabled';
 end if;
 if has_table_privilege('anon',v_oid,'SELECT') or
    has_table_privilege('authenticated',v_oid,'SELECT') or
    has_table_privilege('authenticated',v_oid,'INSERT') or
    has_table_privilege('service_role',v_oid,'DELETE') or
    has_table_privilege('service_role',v_oid,'TRUNCATE') or
    not has_table_privilege('service_role',v_oid,'SELECT') or
    not has_table_privilege('service_role',v_oid,'INSERT') or
    not has_table_privilege('service_role',v_oid,'UPDATE') then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: incorrect table ACL';
 end if;
 if not exists(
  select 1 from pg_index idx join pg_class ix on ix.oid=idx.indexrelid
   where idx.indrelid=v_oid and ix.relname='raxi_director_real_one_lifetime'
   and idx.indisunique and idx.indpred is null
 ) then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: one-lifetime unique constraint missing';
 end if;
 select pg_get_triggerdef(t.oid) into v_def
 from pg_trigger t where t.tgrelid=v_oid and not t.tgisinternal
   and t.tgname='raxi_director_real_protect';
 if v_def is null or position('BEFORE INSERT OR UPDATE' in v_def)=0 then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: INSERT/UPDATE protection not installed';
 end if;
 if to_regprocedure('public.raxi_director_real_scope(uuid,uuid,uuid,jsonb,bigint)') is null or
    to_regprocedure('public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint)') is null or
    to_regprocedure('public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean)') is null or
    to_regprocedure('public.raxi_director_real_read(jsonb,uuid)') is null or
    to_regprocedure('public.raxi_director_real_revoke(jsonb,uuid,uuid)') is null then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: server-only RPC missing';
 end if;
 if has_function_privilege('anon','public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint)','EXECUTE') or
    has_function_privilege('authenticated','public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint)','EXECUTE') or
    has_function_privilege('anon','public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean)','EXECUTE') or
    has_function_privilege('authenticated','public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean)','EXECUTE') or
    has_function_privilege('anon','public.raxi_director_real_read(jsonb,uuid)','EXECUTE') or
    has_function_privilege('authenticated','public.raxi_director_real_read(jsonb,uuid)','EXECUTE') then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: browser role can execute real pilot RPC';
 end if;
 if exists(select 1 from public.raxi_director_real_pilots) then
  raise exception 'ISSUE49_POSTFLIGHT_NO_GO: unexpected pilot data immediately after schema-only install';
 end if;
 raise notice 'ISSUE49_POSTFLIGHT_PASS: schema only, RLS, least-privilege, single lifetime, secure trigger and RPC ACL. NO PROVIDER OR JOB WAS ACTIVATED';
end $issue49_postflight$;
