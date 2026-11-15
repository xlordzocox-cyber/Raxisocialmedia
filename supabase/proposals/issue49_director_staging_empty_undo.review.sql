-- ISSUE #49 / SCHEMA-ONLY EMERGENCY UNDO (REVIEW ONLY; NEVER AUTOMATIC).
-- NEVER run on production. Requires a separate, exact-SHA operator authorization.
-- Allowed ONLY if no pilot was ever prepared and no task/audit evidence exists.
-- If any real pilot activity has occurred, REFUSE rollback and reconcile instead.
-- This does not and cannot erase Supabase's migration-history ledger entry.
begin;
lock table public.raxi_director_real_pilots in access exclusive mode;
lock table public.raxi_agent_tasks, public.raxi_approvals,
 public.raxi_runtime_policies in share mode;

do $issue49_undo_guard$
begin
 -- Conserve ALL history, even if its provenance or approval context
 -- does not match this pilot. A schema-only undo must begin from the same
 -- completely blank runtime baseline required by the read-only preflight.
 if exists(select 1 from public.raxi_director_real_pilots) or
    exists(select 1 from public.raxi_agent_tasks) or
    exists(select 1 from public.raxi_approvals where subject_kind='TASK') or
    exists(select 1 from public.raxi_runtime_policies) then
  raise exception 'ISSUE49_ROLLBACK_NO_GO: historical task/grant/policy/pilot evidence exists; DO NOT ERASE'
   using errcode='42501';
 end if;
 raise notice 'ISSUE49_ROLLBACK_EMPTY_SCHEMA_ONLY: no pilot/grant/task evidence; undo allowed';
end $issue49_undo_guard$;

drop trigger raxi_director_real_protect on public.raxi_director_real_pilots;
drop function public.raxi_director_real_read(jsonb,uuid) restrict;
drop function public.raxi_director_real_revoke(jsonb,uuid,uuid) restrict;
drop function public.raxi_director_real_approve(jsonb,uuid,uuid,text,boolean) restrict;
drop function public.raxi_director_real_prepare(jsonb,uuid,jsonb,bigint) restrict;
drop function public.raxi_director_real_scope(uuid,uuid,uuid,jsonb,bigint) restrict;
drop function public.raxi_director_real_protect() restrict;
drop table public.raxi_director_real_pilots restrict;
commit;
-- After manual undo separately re-run preflight to confirm baseline.
-- Migration history/redeployment decisions require a new reviewed plan.
