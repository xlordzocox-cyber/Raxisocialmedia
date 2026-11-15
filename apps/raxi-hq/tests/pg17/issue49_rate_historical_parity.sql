-- Raxi HQ Issue49: native PG17 historical provenance attestation.
-- Executed only AFTER the original PR59 SQL, in disposable isolated PG17.
\set ON_ERROR_STOP on
do $check$
declare v text;
begin
 if to_regprocedure('public.raxi_supervised_request_rate_admit(jsonb,text)') is null or
    to_regclass('public.raxi_supervised_request_rate_counters') is null
 then raise exception 'RATE_PR59_HISTORICAL_FUNCTION_MISSING'; end if;
 v:=encode(sha256(convert_to(
   pg_get_functiondef('public.raxi_supervised_request_rate_admit(jsonb,text)'::regprocedure),
   'UTF8')),'hex');
 if v is distinct from
  '57b94e50e622acb3c6dee7e41707993b1f0d0a2087d358627e2a455d817e67b7'
 then raise exception 'RATE_PR59_STAGING_CATALOG_SHA_MISMATCH: %',v;end if;
 if not (select relrowsecurity from pg_class
   where oid='public.raxi_supervised_request_rate_counters'::regclass) or
  has_table_privilege('anon','public.raxi_supervised_request_rate_counters','SELECT') or
  has_table_privilege('authenticated','public.raxi_supervised_request_rate_counters','SELECT') or
  has_function_privilege('anon','public.raxi_supervised_request_rate_admit(jsonb,text)','EXECUTE') or
  has_function_privilege('authenticated','public.raxi_supervised_request_rate_admit(jsonb,text)','EXECUTE') or
  not has_function_privilege('service_role','public.raxi_supervised_request_rate_admit(jsonb,text)','EXECUTE') or
  has_table_privilege('service_role','public.raxi_supervised_request_rate_counters','DELETE') or
  has_table_privilege('service_role','public.raxi_supervised_request_rate_counters','TRUNCATE')
 then raise exception 'RATE_PR59_STAGING_ACL_MISMATCH';end if;
 raise notice 'PASS_RATE_PR59_HISTORICAL_SQL_CATALOG_SHA_AND_ACL';
end; $check$;
