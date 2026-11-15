#!/usr/bin/env bash
# Physical concurrent PostgreSQL17 backends, never Supabase staging.
set -euo pipefail
if [[ $# -ne 2 ]]; then echo "usage: $0 DOCKER_CONTAINER DATABASE";exit 2;fi
container="$1"
db="$2"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
admit() {
  local digest="$1"
  docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$db" -At \
    -c "set role service_role;select public.raxi_director_preauth_admit('$digest')->>'status';" |
    tail -n 1
}
many() {
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
  local allowed=0 denied=0
  for ((i=1;i<=count;i++)); do
    case "$(cat "$tmp/$mode-$i")" in
      ALLOWED) ((allowed+=1));;
      RATE_LIMITED) ((denied+=1));;
      *) echo "UNEXPECTED preauth response $mode/$i:"; cat "$tmp/$mode-$i" "$tmp/$mode-$i.err";exit 1;;
    esac
  done
  if [[ "$mode" == same ]];then
    test "$allowed" -eq 8 && test "$denied" -eq 4 || {
      echo "FAIL_PREAUTH_PHYSICAL_SAME_CLIENT: $allowed/$denied";exit 1;
    }
    echo 'PASS_PREAUTH_12_CONCURRENT_SAME_CLIENT_8_ALLOWED_4_DENIED'
  else
    test "$allowed" -eq 60 && test "$denied" -eq 10 || {
      echo "FAIL_PREAUTH_PHYSICAL_GLOBAL: $allowed/$denied";exit 1;
    }
    echo 'PASS_PREAUTH_70_CONCURRENT_CLIENTS_GLOBAL_60_ALLOWED_10_DENIED'
  fi
}
many same 12
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" -Atc \
  "select count(*)=2 and max(hit_count) filter(where slot='GLOBAL')=8 and max(hit_count) filter(where slot like 'CLIENT:%')=8 from public.raxi_director_preauth_counters" |grep -qx t
# Empty ONLY disposable test counters to make global concurrency independent.
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" \
  -c "set role service_role;delete from public.raxi_director_preauth_counters;"
many distinct 70
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" -Atc \
  "select count(*)=61 and max(hit_count) filter(where slot='GLOBAL')=60 and sum(hit_count) filter(where slot like 'CLIENT:%')=60 from public.raxi_director_preauth_counters" |grep -qx t
echo 'PASS_PREAUTH_PHYSICAL_TWO_INDEPENDENT_RACE_GROUPS'
