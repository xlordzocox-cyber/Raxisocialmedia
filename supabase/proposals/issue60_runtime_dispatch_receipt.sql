-- Issue #60 | PROPOSAL ONLY. Do not apply to hosted staging or production.
-- Add this AFTER a reviewed installation of proposals/agent_runtime.sql.
-- The legacy runtime SQL source and staging manifest hashes remain unchanged.
--
-- Truthful semantics: the server has admitted a DISPATCH request after policy
-- validation, not that the remote model accepted a request or completed work.
-- A transaction rollback removes both these event/audit rows.
create function public.raxi_runtime_dispatch_receipt() returns trigger
language plpgsql security invoker set search_path='' as $raxi_dispatch$
declare v_task public.raxi_agent_tasks;
begin
  if old.dispatch_authorized_at is null
     and new.dispatch_authorized_at is not null
     and old.status='CLAIMED'
     and new.status='CLAIMED' then
    -- Defense in depth: a direct table UPDATE must never bypass revoked policy
    -- or a stale lease. This does NOT replace service_role least privilege.
    if current_user<>'service_role' or new.lease_until<=clock_timestamp() or
       new.provider_receipt is not null then
      raise exception 'invalid dispatch authority or lease' using errcode='42501';
    end if;
    select * into v_task from public.raxi_agent_tasks
     where id=new.task_id and workspace_id=new.workspace_id for share;
    if not found then raise exception 'runtime task absent' using errcode='42501'; end if;
    perform public.raxi_runtime_assert_authorization(v_task);
    insert into public.raxi_agent_events (
      workspace_id,agent_id,task_id,event_type,source_kind,
      evidence_status,occurred_at,payload
    ) values (
      new.workspace_id,new.agent_id,new.task_id,
      'RUNTIME_DISPATCH_AUTHORIZED',
      case when new.simulated then 'MOCK' else 'AGENT_EXECUTOR' end,
      case when new.simulated then 'UNVERIFIED' else 'VERIFIED' end,
      new.dispatch_authorized_at,
      jsonb_build_object(
        'runId',new.id,'simulated',new.simulated,'stage',new.stage,
        'leaseUntil',new.lease_until,'operationalReceiptOnly',true,
        'providerAcknowledged',false,'phase','DISPATCH_AUTHORIZED'
      )
    );
    insert into public.raxi_audit_events(
      workspace_id,action,actor_kind,resource_kind,resource_id,details
    ) values (
      new.workspace_id,'RUNTIME_DISPATCH_AUTHORIZED','SYSTEM','RUN',new.id::text,
      jsonb_build_object('stage',new.stage,'simulated',new.simulated,
        'providerAcknowledged',false,'operationalReceiptOnly',true)
    );
  end if;
  return new;
end;
$raxi_dispatch$;
revoke all on function public.raxi_runtime_dispatch_receipt() from public,anon,authenticated;
create trigger raxi_runtime_dispatch_receipt
after update of dispatch_authorized_at on public.raxi_agent_runs
for each row
when (old.dispatch_authorized_at is null and new.dispatch_authorized_at is not null)
execute function public.raxi_runtime_dispatch_receipt();

-- Add-on security delta ONLY. Do not alter the 7-source pinned staging
-- manifest or the legacy agent_runtime.sql SHA. Apply transactionally after
-- agent_runtime.sql; never activate runtime from the baseline grants alone.
-- service_role remains a privileged server-only trust boundary, not a browser role.
revoke all on public.raxi_runtime_policies,public.raxi_agent_runs from service_role;
grant select on public.raxi_runtime_policies,public.raxi_agent_runs to service_role;
grant update (enabled,reserved_micros,task_count)
 on public.raxi_runtime_policies to service_role;
grant insert (workspace_id,task_id,agent_id,stage,status,simulated,
 provider,model,lease_until,worker_id,reserved_micros)
 on public.raxi_agent_runs to service_role;
grant update (status,finished_at,dispatch_authorized_at,
 provider_receipt,result,cost_micros)
 on public.raxi_agent_runs to service_role;
-- Stage A augments raxi_agent_runs with an append-only journal counter.
-- Grant that single column only when Stage A has been installed.
do $issue60_acl$
begin
 if exists (select 1 from pg_attribute a
            join pg_class c on c.oid=a.attrelid
            join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relname='raxi_agent_runs'
              and a.attname='journal_version' and a.attnum>0 and not a.attisdropped) then
  execute 'grant update (journal_version) on public.raxi_agent_runs to service_role';
 end if;
end;
$issue60_acl$;
