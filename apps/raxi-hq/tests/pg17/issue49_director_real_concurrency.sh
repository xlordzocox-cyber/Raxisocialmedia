#!/usr/bin/env bash
# Native PostgreSQL17 independent-connection race QA; disposable DB only.
set -euo pipefail
container="$1"
database="$2"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
run_sql() {
  local label="$1" sql="$2"
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" -At \
    -c "set role service_role; select 'RAXIPID:'||pg_backend_pid(); $sql" \
    >"$tmp/$label.log" 2>&1
}
prep() {
  local scenario="$1" key="i.request_key"
  if [[ "$#" -ge 2 ]]; then key="$2"; fi
  printf "select 'RAXITASK:'||(public.raxi_director_real_prepare(i.identity,%s,i.spec,1)->>'taskId') from public.raxi_issue49_concurrency_inputs i where scenario='%s';" "$key" "$scenario"
}
approve() {
  local scenario="$1" key="i.approval_key"
  if [[ "$#" -ge 2 ]]; then key="$2"; fi
  printf "select 'RAXIAPPROVAL:'||(public.raxi_director_real_approve(i.identity,p.task_id,%s,p.scope_sha256,true)->>'approvalId') from public.raxi_issue49_concurrency_inputs i join public.raxi_director_real_pilots p on p.workspace_id=i.workspace_id where scenario='%s';" "$key" "$scenario"
}
must_pass() {
  local name="$1" pid="$2"
  if ! wait "$pid"; then echo "FAILED: $name"; cat "$tmp/$name.log"; exit 1; fi
}
must_fail() {
  local name="$1" pid="$2" pattern="$3"
  if wait "$pid"; then echo "FAILED: $name unexpectedly succeeded";cat "$tmp/$name.log"; exit 1;fi
  if ! grep -Eq "$pattern" "$tmp/$name.log"; then
    echo "FAILED: $name failed for the wrong reason";cat "$tmp/$name.log";exit 1
  fi
}
assert_distinct_connections() {
  local a="$1" b="$2" p1 p2
  p1="$(grep -Eo 'RAXIPID:[0-9]+' "$tmp/$a.log" | head -1 || true)"
  p2="$(grep -Eo 'RAXIPID:[0-9]+' "$tmp/$b.log" | head -1 || true)"
  if [[ -z "$p1" || -z "$p2" || "$p1" == "$p2" ]]; then
    echo "FAILED: separate PG17 backends required ($a $b)"
    cat "$tmp/$a.log" "$tmp/$b.log";exit 1
  fi
  echo "PASS separate physical sessions $a/$b: $p1 vs $p2"
}
same_value() {
  local a="$1" b="$2" regex="$3" v1 v2
  v1="$(grep -Eo "$regex" "$tmp/$a.log" | head -1 || true)"
  v2="$(grep -Eo "$regex" "$tmp/$b.log" | head -1 || true)"
  if [[ -z "$v1" || "$v1" != "$v2" ]];then
    echo "FAILED idempotent result mismatch";cat "$tmp/$a.log" "$tmp/$b.log";exit 1
  fi
}
run_sql same_p_a "begin; $(prep prepare_same) select pg_sleep(1.7); commit;" &
a=$!
sleep 0.3
run_sql same_p_b "$(prep prepare_same)" &
b=$!
must_pass same_p_a "$a";must_pass same_p_b "$b"
assert_distinct_connections same_p_a same_p_b
same_value same_p_a same_p_b 'RAXITASK:[0-9a-f-]{36}'
echo "PASS same-key prepare across physical transactions"

run_sql conflict_p_a "begin; $(prep prepare_conflict) select pg_sleep(1.7); commit;" &
a=$!
sleep 0.3
run_sql conflict_p_b "$(prep prepare_conflict "'22222222-cccc-4222-8222-222222222222'::uuid")" &
b=$!
must_pass conflict_p_a "$a"
must_fail conflict_p_b "$b" 'duplicate key|violates unique constraint'
assert_distinct_connections conflict_p_a conflict_p_b
echo "PASS different-key prepare collision blocked"

for scenario in approval_same approval_conflict approval_rollback;do
  run_sql "seed_$scenario" "$(prep "$scenario")"
  grep -q 'RAXITASK:' "$tmp/seed_$scenario.log"
done

run_sql same_a_a "begin; $(approve approval_same) select pg_sleep(1.7); commit;" &
a=$!
sleep 0.3
run_sql same_a_b "$(approve approval_same)" &
b=$!
must_pass same_a_a "$a";must_pass same_a_b "$b"
assert_distinct_connections same_a_a same_a_b
same_value same_a_a same_a_b 'RAXIAPPROVAL:[0-9a-f-]{36}'
echo "PASS same-key approvals reserve once"

run_sql conflict_a_a "begin; $(approve approval_conflict) select pg_sleep(1.7); commit;" &
a=$!
sleep 0.3
run_sql conflict_a_b "$(approve approval_conflict "'44444444-cccc-4444-8444-444444444444'::uuid")" &
b=$!
must_pass conflict_a_a "$a"
must_fail conflict_a_b "$b" 'cannot reapprove'
assert_distinct_connections conflict_a_a conflict_a_b
echo "PASS different-key approvals cannot reserve twice"

run_sql rollback_a "begin; $(approve approval_rollback) select pg_sleep(1.7); rollback;" &
a=$!
sleep 0.3
run_sql rollback_b "$(approve approval_rollback)" &
b=$!
must_pass rollback_a "$a";must_pass rollback_b "$b"
assert_distinct_connections rollback_a rollback_b
echo "PASS uncommitted approval rolled back before competing approval"

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" -At <<'SQL'
do $verify$
declare rec record; task_n integer; gate_n integer; grant_n integer;reserved bigint;
begin
 for rec in select scenario,workspace_id from public.raxi_issue49_concurrency_inputs loop
  select count(*) into task_n from public.raxi_agent_tasks where workspace_id=rec.workspace_id;
  select count(*) into gate_n from public.raxi_director_real_pilots where workspace_id=rec.workspace_id;
  select count(*) into grant_n from public.raxi_approvals where workspace_id=rec.workspace_id and subject_kind='TASK' and action='APPROVED';
  select reserved_micros into reserved from public.raxi_runtime_policies where workspace_id=rec.workspace_id;
  if task_n<>1 or gate_n<>1 or
     exists(select 1 from public.raxi_agent_tasks where workspace_id=rec.workspace_id and status<>'WAITING_APPROVAL') then
   raise exception 'FAILED: scenario % duplicated or dispatchable',rec.scenario;end if;
  if rec.scenario like 'prepare_%' then
    if grant_n<>0 or reserved<>0 then raise exception 'FAILED prep accounting %',rec.scenario;end if;
  else
    if grant_n<>1 or reserved<>4000 or
       (select task_count from public.raxi_runtime_policies where workspace_id=rec.workspace_id)<>1
    then raise exception 'FAILED approval accounting %',rec.scenario;end if;
  end if;
  raise notice 'PASS: verified physical concurrency invariant for %',rec.scenario;
 end loop;
end; $verify$;
SQL
echo 'PASS ISSUE49_REAL_DIRECTOR_PHYSICAL_CONCURRENCY (NO PROVIDERS / NO EXECUTION)'
