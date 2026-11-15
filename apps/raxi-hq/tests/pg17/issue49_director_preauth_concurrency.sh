#!/usr/bin/env bash
# Physical concurrent PostgreSQL17 backends, never Supabase staging.
# Every assertion is scoped to ONE actual PostgreSQL clock minute.
set -euo pipefail
if [[ $# -ne 2 ]]; then echo "usage: $0 DOCKER_CONTAINER DATABASE";exit 2;fi
container="$1"
db="$2"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

sql() {
  docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$db" -Atc "$1"
}
db_minute() {
  sql "select floor(extract(epoch from clock_timestamp())/60)::bigint;" | tail -n 1
}
db_second() {
  sql "select floor(extract(epoch from clock_timestamp()))::bigint % 60;" | tail -n 1
}
await_suitable_window() {
  local i second
  # Leave >=40s for even a heavily loaded runner to complete connections.
  for ((i=0;i<75;i++)); do
    second="$(db_second)"
    if [[ "$second" =~ ^[0-9]+$ ]] && ((second<=20));then return 0;fi
    sleep 1
  done
  echo 'FAIL: unavailable stable PG clock window';return 1
}
reset_disposable_db() {
  # Only a dedicated Docker DB with --network none; NO hosted SQL.
  sql "set role service_role;delete from public.raxi_director_preauth_counters;" > /dev/null
}
admit() {
  local digest="$1"
  sql "set role service_role;select public.raxi_director_preauth_admit('$digest')->>'status';" | tail -n 1
}
run_parallel() {
  local mode="$1" count="$2" i digest pids=""
  for ((i=1;i<=count;i++)); do
    if [[ "$mode" == same ]]; then
      digest="$(printf 'e%.0s' {1..64})"
    else
      printf -v digest '%064x' "$i"
    fi
    admit "$digest" > "$tmp/$mode-$i" 2> "$tmp/$mode-$i.err" &
    pids="$pids $!"
  done
  for pid in $pids; do wait "$pid"; done
}
verify_one_minute_batch() {
  local mode="$1" count="$2" expected_allowed="$3" expected_denied="$4"
  local attempt before after i allowed denied
  for ((attempt=1;attempt<=3;attempt++)); do
    reset_disposable_db
    await_suitable_window
    before="$(db_minute)"
    run_parallel "$mode" "$count"
    after="$(db_minute)"
    if [[ "$before" != "$after" ]];then
      echo "RETRY_PREAUTH_WINDOW_ROLLOVER: $mode attempt=$attempt"
      continue
    fi
    allowed=0;denied=0
    for ((i=1;i<=count;i++)); do
      case "$(cat "$tmp/$mode-$i")" in
        ALLOWED) ((allowed+=1));;
        RATE_LIMITED) ((denied+=1));;
        *) echo "FAIL_UNEXPECTED_PREAUTH_RESPONSE: $mode/$i"
           cat "$tmp/$mode-$i" "$tmp/$mode-$i.err";return 1;;
      esac
    done
    if ((allowed!=expected_allowed || denied!=expected_denied));then
      echo "FAIL_PREAUTH_PHYSICAL_QUOTA: $mode $allowed/$denied";return 1
    fi
    if [[ "$mode" == same ]];then
      sql "select count(*)=2 and max(hit_count) filter(where slot='GLOBAL')=8 and max(hit_count) filter(where slot like 'CLIENT:%')=8 from public.raxi_director_preauth_counters" |grep -qx t
      echo 'PASS_PREAUTH_12_CONCURRENT_SAME_CLIENT_8_ALLOWED_4_DENIED'
    else
      sql "select count(*)=61 and max(hit_count) filter(where slot='GLOBAL')=60 and sum(hit_count) filter(where slot like 'CLIENT:%')=60 from public.raxi_director_preauth_counters" |grep -qx t
      echo 'PASS_PREAUTH_70_CONCURRENT_CLIENTS_GLOBAL_60_ALLOWED_10_DENIED'
    fi
    echo "PASS_PREAUTH_SINGLE_PG_MINUTE_CONFIRMED: $mode"
    return 0
  done
  echo "FAIL_PREAUTH_CANNOT_COMPLETE_SINGLE_MINUTE_BATCH: $mode"
  return 1
}
verify_one_minute_batch same 12 8 4
verify_one_minute_batch distinct 70 60 10
echo 'PASS_PREAUTH_PHYSICAL_TWO_INDEPENDENT_RACE_GROUPS'
