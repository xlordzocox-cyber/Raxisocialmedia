#!/usr/bin/env bash
# Ephemeral native PostgreSQL 17 lab. No network, port, secret or hosted provider.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
container="raxi-issue60-pr59-identity-${GITHUB_RUN_ID:-local}-$$"
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
# Load the full 7-source reviewed baseline (in the isolated fixture only).
run_sql supabase/proposals/supervised_host_stage_a.sql
# Staging already has a PR59 identity function. Only an EPHEMERAL fixture is created here.
run_sql supabase/tests/issue60_preexisting_pr59_identity_fixture.sql
run_sql supabase/proposals/issue60_stage_b_staging_identity_compatible.candidate.sql
run_sql supabase/tests/issue60_pr59_identity_compatibility_checks.sql
# The Issue60 ACL/receipt add-on must be after baseline runtime + host.
run_sql supabase/proposals/issue60_runtime_dispatch_receipt.sql
run_sql supabase/tests/issue60-pg17-dispatch-receipt.sql
# Negative SQL tests execute *the candidate itself* against malicious replacements.
# Each run uses BEGIN and an isolated psql connection: an expected error causes
# the function mutation to roll back automatically on connection close.
for variant in comment_only inverted_project_no_session no_session; do
  echo "Testing rejected PR59 identity drift: $variant"
  script="$(
    case "$variant" in
      comment_only)
        cat <<'SQL'
CREATE OR REPLACE FUNCTION public.raxi_supervised_host_identity(p_identity jsonb) returns boolean
language plpgsql security invoker set search_path='' as $weak$
BEGIN
 -- Project comment zvhxjindgyvtasstfjut is NOT evidence of validation.
 RETURN true;
END;
$weak$;
SQL
        ;;
      inverted_project_no_session)
        cat <<'SQL'
CREATE OR REPLACE FUNCTION public.raxi_supervised_host_identity(p_identity jsonb) returns boolean
language plpgsql security invoker set search_path='' as $weak$
BEGIN
 IF p_identity->>'projectRef'='zvhxjindgyvtasstfjut' THEN
  RAISE EXCEPTION 'inverted project validation';
 END IF;
 RETURN true;
END;
$weak$;
SQL
        ;;
      no_session)
        cat <<'SQL'
CREATE OR REPLACE FUNCTION public.raxi_supervised_host_identity(p_identity jsonb) returns boolean
language plpgsql security invoker set search_path='' as $weak$
BEGIN
 IF p_identity->>'projectRef' is distinct from 'zvhxjindgyvtasstfjut' THEN
  RAISE EXCEPTION 'project denied';
 END IF;
 -- Missing session, owner and expiry checks: unacceptable.
 RETURN true;
END;
$weak$;
SQL
        ;;
    esac
  )"
  result="$(
    {
      printf 'BEGIN;\n'
      printf '%s\n' "$script"
      cat supabase/proposals/issue60_stage_b_staging_identity_compatible.candidate.sql
    } | docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f - 2>&1
  )" && { echo "FAIL: weakened identity was admitted: $variant"; exit 1; }
  if ! grep -q 'staging PR59 identity sha256 or ACL mismatch' <<< "$result"; then
    echo "FAIL: expected SHA256 preflight rejection, got unexpected failure in $variant"
    echo "$result" | tail -n 10
    exit 1
  fi
  echo "PASS: $variant denied by approved-identity SHA256 guard"
done
# Confirm negative transactions did not leave behind weakened functions.
run_sql supabase/tests/issue60_pr59_identity_compatibility_checks.sql

echo "PASS: ephemeral native PG17 PR59/StageB compatibility and runtime QA; no hosted effects"
