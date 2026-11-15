-- RAXI HQ / ISSUE #49 / READ-ONLY STAGING PREFLIGHT (REVIEW ONLY).
-- Checked against staging ref zvhxjindgyvtasstfjut, PostgreSQL 17.
-- This file NEVER installs or runs the Director. Execute independently
-- and inspect its result before considering any staged migration.
-- No credentials, users, tokens or other row values are returned.
do $issue49_preflight$
declare
 v_bad text[]:=array[]::text[];
 v_pg int:=current_setting('server_version_num')::int;
begin
 if v_pg<170000 or v_pg>=180000 then
  v_bad:=array_append(v_bad,'postgresql_17_required');
 end if;
 if to_regclass('public.raxi_director_real_pilots') is not null then
  v_bad:=array_append(v_bad,'candidate_table_already_exists');
 end if;
 if to_regprocedure('public.raxi_supervised_host_identity(jsonb)') is null then
  v_bad:=array_append(v_bad,'trusted_host_identity_missing');
 end if;
 if to_regprocedure('public.raxi_supervised_prepare(uuid,uuid,uuid,text,jsonb,text,uuid)') is null then
  v_bad:=array_append(v_bad,'existing_simulated_preparation_missing');
 end if;
 if to_regprocedure('public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint)') is not null or
    to_regprocedure('public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean)') is not null or
    to_regprocedure('public.raxi_director_real_read(jsonb,uuid)') is not null or
    to_regprocedure('public.raxi_director_real_revoke(jsonb,uuid,uuid)') is not null then
  v_bad:=array_append(v_bad,'candidate_function_already_exists');
 end if;
 if to_regclass('public.raxi_workspaces') is null or
    to_regclass('public.raxi_agent_tasks') is null or
    to_regclass('public.raxi_runtime_policies') is null or
    to_regclass('public.raxi_approvals') is null or
    to_regclass('auth.sessions') is null then
  v_bad:=array_append(v_bad,'staging_dependency_missing');
 else
  -- This is deliberately a first-Director-only blank pilot.
  -- Fail closed if runtime work already exists; do not touch existing rows.
  if (select count(*) from public.raxi_agent_tasks)<>0 then
   v_bad:=array_append(v_bad,'existing_tasks_require_manual_reconciliation');
  end if;
  if (select count(*) from public.raxi_runtime_policies)<>0 then
   v_bad:=array_append(v_bad,'existing_policies_require_manual_reconciliation');
  end if;
  if (select count(*) from public.raxi_approvals where subject_kind='TASK')<>0 then
   v_bad:=array_append(v_bad,'existing_task_approvals_require_manual_reconciliation');
  end if;
 end if;
 if to_regrole('service_role') is null or to_regrole('anon') is null or
    to_regrole('authenticated') is null then
  v_bad:=array_append(v_bad,'expected_postgres_roles_missing');
 end if;
 if cardinality(v_bad)>0 then
  raise exception 'ISSUE49_STAGING_PREFLIGHT_NO_GO: %',array_to_string(v_bad,',')
    using errcode='42501';
 end if;
 raise notice 'ISSUE49_STAGING_PREFLIGHT_PASS: PostgreSQL17, host identity, simulated path, blank pilot, role/dependency presence. NO MIGRATION WAS APPLIED';
end $issue49_preflight$;
