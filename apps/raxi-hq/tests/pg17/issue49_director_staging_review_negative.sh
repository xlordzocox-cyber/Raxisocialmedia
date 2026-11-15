#!/usr/bin/env bash
# Issue #49 red-team checks: run ONLY inside a disposable PG17 Docker cluster.
set -euo pipefail
if [[ $# -ne 2 ]]; then echo 'usage: review_negative.sh CONTAINER history|attest';exit 2;fi
container="$1"
mode="$2"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
must_reject() {
 local label="$1" marker="$2"
 if docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >"$tmp/$label.log" 2>&1; then
  echo "FAIL: $label unexpectedly succeeded";cat "$tmp/$label.log";exit 1
 fi
 if ! grep -Fq "$marker" "$tmp/$label.log"; then
  echo "FAIL: $label failed for the wrong reason";cat "$tmp/$label.log";exit 1
 fi
 echo "PASS_EXPECTED_DENIAL: $label"
}
if [[ "$mode" == history ]];then
 # IMPORTANT: The target pilot table starts EMPTY for all three checks.
 # All injected history stays within a transaction that is aborted on denial.
 must_reject unrelated_task 'ISSUE49_ROLLBACK_NO_GO' <<'SQL'
begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.raxi_workspaces(id,owner_user_id,slug,name) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','qa-only','QA only');
insert into public.raxi_agent_tasks(workspace_id,external_id,title,status,input_snapshot) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','UNRELATED-TASK','Unrelated task','WAITING_APPROVAL','{}'::jsonb);
\i /tmp/empty-undo.sql
SQL
 must_reject unrelated_approval 'ISSUE49_ROLLBACK_NO_GO' <<'SQL'
begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.raxi_workspaces(id,owner_user_id,slug,name) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','qa-only','QA only');
insert into public.raxi_approvals(workspace_id,subject_kind,subject_id,action,actor_user_id,idempotency_key,context)
 values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','TASK',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','APPROVED',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','UNRELATED-APPROVAL','{}'::jsonb);
\i /tmp/empty-undo.sql
SQL
 must_reject unrelated_policy 'ISSUE49_ROLLBACK_NO_GO' <<'SQL'
begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.raxi_workspaces(id,owner_user_id,slug,name) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','qa-only','QA only');
insert into public.raxi_runtime_policies(workspace_id,enabled,simulated,provider,model,
 total_budget_micros,reserved_micros,per_call_micros,max_tasks,task_count,max_output_tokens,expires_at)
 values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false,true,'simulated','fixture',
 5000,4000,4000,1,1,128,clock_timestamp()+interval '30 minutes');
\i /tmp/empty-undo.sql
SQL
 docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc "
 select (select count(*) from public.raxi_agent_tasks)=0 and
 (select count(*) from public.raxi_approvals where subject_kind='TASK')=0 and
 (select count(*) from public.raxi_runtime_policies)=0 and
 to_regclass('public.raxi_director_real_pilots') is not null" | grep -qx t
 echo 'PASS_ISSUE49_UNDO_DENIES_UNRELATED_TASK_APPROVAL_AND_POLICY'
elif [[ "$mode" == attest ]];then
 must_reject wrong_index_key 'ISSUE49_POSTFLIGHT_NO_GO: one-lifetime unique constraint missing' <<'SQL'
begin;
drop index public.raxi_director_real_one_lifetime;
create unique index raxi_director_real_one_lifetime on public.raxi_director_real_pilots(task_id);
\i /tmp/postflight.sql
SQL
 must_reject disabled_trigger 'ISSUE49_POSTFLIGHT_NO_GO: enabled per-row INSERT/UPDATE protection missing or wrong' <<'SQL'
begin;
alter table public.raxi_director_real_pilots disable trigger raxi_director_real_protect;
\i /tmp/postflight.sql
SQL
 must_reject wrong_trigger_fn 'ISSUE49_POSTFLIGHT_NO_GO: enabled per-row INSERT/UPDATE protection missing or wrong' <<'SQL'
begin;
create function public.raxi_issue49_noop_trigger() returns trigger
 language plpgsql as $fn$ begin return new; end $fn$;
drop trigger raxi_director_real_protect on public.raxi_director_real_pilots;
create trigger raxi_director_real_protect before insert or update on public.raxi_director_real_pilots
 for each row execute function public.raxi_issue49_noop_trigger();
\i /tmp/postflight.sql
SQL
 must_reject statement_trigger 'ISSUE49_POSTFLIGHT_NO_GO: enabled per-row INSERT/UPDATE protection missing or wrong' <<'SQL'
begin;
drop trigger raxi_director_real_protect on public.raxi_director_real_pilots;
create trigger raxi_director_real_protect before insert or update on public.raxi_director_real_pilots
 for each statement execute function public.raxi_director_real_protect();
\i /tmp/postflight.sql
SQL
 must_reject conditional_trigger 'ISSUE49_POSTFLIGHT_NO_GO: enabled per-row INSERT/UPDATE protection missing or wrong' <<'SQL'
begin;
drop trigger raxi_director_real_protect on public.raxi_director_real_pilots;
create trigger raxi_director_real_protect
 before insert or update on public.raxi_director_real_pilots
 for each row when (false) execute function public.raxi_director_real_protect();
\i /tmp/postflight.sql
SQL
 must_reject update_of_trigger 'ISSUE49_POSTFLIGHT_NO_GO: enabled per-row INSERT/UPDATE protection missing or wrong' <<'SQL'
begin;
drop trigger raxi_director_real_protect on public.raxi_director_real_pilots;
create trigger raxi_director_real_protect
 before insert or update of status on public.raxi_director_real_pilots
 for each row execute function public.raxi_director_real_protect();
\i /tmp/postflight.sql
SQL
 must_reject browser_truncate 'ISSUE49_POSTFLIGHT_NO_GO: incorrect table ACL' <<'SQL'
begin;
grant truncate on public.raxi_director_real_pilots to authenticated;
\i /tmp/postflight.sql
SQL
 must_reject browser_delete 'ISSUE49_POSTFLIGHT_NO_GO: incorrect table ACL' <<'SQL'
begin;
grant delete on public.raxi_director_real_pilots to anon;
\i /tmp/postflight.sql
SQL
 # Every tampered transaction was rolled back after denial; original still PASS.
 docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/postflight.sql
 echo 'PASS_ISSUE49_POSTFLIGHT_REJECTS_WRONG_INDEX_TRIGGER_AND_BROWSER_ACL'
else
 echo "INVALID MODE: $mode";exit 2
fi
