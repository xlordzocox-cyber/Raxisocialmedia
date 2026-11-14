#!/usr/bin/env bash
# Ephemeral native PostgreSQL 17 lab. No network, port, secret or hosted provider.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
container="raxi-issue60-pg17-${GITHUB_RUN_ID:-local}-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker pull postgres:17 >/dev/null
image_sha="$(docker image inspect --format '{{.Id}}' postgres:17)"
echo "Offline PG17 container image: $image_sha"
docker run --rm -d --name "$container" --network none \
 --tmpfs /var/lib/postgresql/data:rw,size=512m \
 --tmpfs /var/run/postgresql:rw,size=16m \
 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
[[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" == "none" ]]
[[ "$(docker inspect --format '{{.HostConfig.Privileged}}' "$container")" == "false" ]]
[[ "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$container")" == "0" ]]
[[ "$(docker inspect --format '{{len .HostConfig.Binds}}' "$container")" == "0" ]]
ready=false
for attempt in $(seq 1 90); do
  if docker exec -u postgres "$container" pg_isready -h /var/run/postgresql -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "PostgreSQL fixture did not start"
  exit 1
fi
run_sql() {
  local path="$1"
  echo "Installing fixture file: $path"
  docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres \
    -d postgres -X -v ON_ERROR_STOP=1 -f - < "$path"
}
run_sql supabase/tests/pg17-bootstrap.sql
for file in \
 supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql \
 supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql \
 supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql \
 supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql; do
 run_sql "$file"
done
run_sql supabase/proposals/agent_runtime.sql
run_sql supabase/proposals/issue60_runtime_dispatch_receipt.sql
run_sql supabase/tests/issue60-pg17-dispatch-receipt.sql
echo "PASS: ephemeral native PostgreSQL 17 Issue #60 QA; no hosted effects"
