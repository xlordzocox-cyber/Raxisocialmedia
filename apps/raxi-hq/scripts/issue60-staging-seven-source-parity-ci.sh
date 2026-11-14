#!/usr/bin/env bash
# Ephemeral native PostgreSQL 17 lab. No network, port, secret or hosted provider.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
container="raxi-issue60-seven-schema-parity-${GITHUB_RUN_ID:-local}-$$"
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
# Exact PR59 GitHub checkout alongside the branch (no hosted DB).
PR59_DIR=".pr59-replay"
PR59_SHA="e4d617e85875d99d5c06908dad2ef1a46b02cd5d"
[[ "$(git -C "$PR59_DIR" rev-parse HEAD)" == "$PR59_SHA" ]] ||
  { echo "PR59 source commit mismatch"; exit 1; }
check_blob() {
 local path="$1" expected="$2" actual
 actual="$(git hash-object "$path")"
 [[ "$actual" == "$expected" ]] ||
   { echo "Pinned source mismatch: $path expected $expected actual $actual"; exit 1; }
}
check_blob "$PR59_DIR/supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql" "7590d35ebd4a62566889e6a5adb970d8c1698a54"
check_blob "$PR59_DIR/supabase/proposals/supervised_campaign_staging_identity.sql" "3bb80ffcee70376fbfa16be993d35de9a0805e57"
check_blob "$PR59_DIR/supabase/proposals/supervised_campaign_requests.sql" "ce3e15caca3614d0881e6371585d65ada4e46044"
check_blob "supabase/proposals/agent_runtime.sql" "6893f5c9eda6ff61b024173605a1da9a880e0b3e"
check_blob "supabase/proposals/supervised_host_stage_a.sql" "f6c0372d1cfc94ca45c267c641f835971d442b7c"
check_blob "supabase/proposals/issue60_runtime_dispatch_receipt.sql" "b0c4d13bdc5da73f867432c62de614c7f84dfa55"
run_sql supabase/tests/pg17-bootstrap.sql
for file in \
 supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql \
 supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql \
 supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql \
 supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql \
 "$PR59_DIR/supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql" \
 "$PR59_DIR/supabase/proposals/supervised_campaign_staging_identity.sql" \
 "$PR59_DIR/supabase/proposals/supervised_campaign_requests.sql"; do
 run_sql "$file"
done
# The actual PR59 function is now installed; assert it has the same normalized
# SHA256 observed in the hosted staging database (read-only catalog preflight).
fingerprint="a99f644a5b4506d9db3fe426435bf4fefba30839592eea6ebdad4fee059a0fbf"
printf 'create table public.raxi_qa_identity_fingerprint(expected_definition text not null);\ninsert into public.raxi_qa_identity_fingerprint values (%s);\n' "'$fingerprint'" |
 docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres \
 -d postgres -X -v ON_ERROR_STOP=1 -f -
# Fail closed if the fixture does not exactly reproduce live PR59 semantics.
docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres \
 -d postgres -X -v ON_ERROR_STOP=1 -Atc \
 "do \$\$ begin if encode(sha256(convert_to(pg_get_functiondef('public.raxi_supervised_host_identity(jsonb)'::regprocedure),'UTF8')),'hex') is distinct from '$fingerprint' then raise exception 'PR59 identity live SHA256 mismatch'; end if; end \$\$;" 
# Rehearse the migration runner's own wrapping transaction; the body itself
# must never contain BEGIN/COMMIT or it can commit before metadata is recorded.
check_blob "supabase/proposals/issue60_staging_runtime_apply_migration_review_only.sql" "27c3527342b312bf21b7a35b27d5f0f9aa14cfda"
if grep -Eq '^(BEGIN|COMMIT|ROLLBACK);[[:space:]]*$' supabase/proposals/issue60_staging_runtime_apply_migration_review_only.sql; then
  echo "FAIL: embedded migration transaction control"; exit 1
fi
# Deliberately abort midway through source 1 and verify no partial objects
# survive a runner-managed transaction.
output="$(
 {
  printf 'BEGIN;\n'
  cat supabase/proposals/agent_runtime.sql
  cat <<'EXPECTED_ABORT'
DO $rollback_probe$
BEGIN
  RAISE EXCEPTION 'EXPECTED_NATIVE_RUNNER_ABORT';
END;
$rollback_probe$;
EXPECTED_ABORT
 } | docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f - 2>&1
)" && { echo "FAIL: expected injected failure did not abort"; exit 1; }
grep -q 'EXPECTED_NATIVE_RUNNER_ABORT' <<< "$output" ||
 { echo "FAIL: injected failure was not the cause"; exit 1; }
no_partial="$(docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.raxi_agent_runs') IS NULL AND to_regclass('public.raxi_runtime_policies') IS NULL AND to_regprocedure('public.raxi_runtime_office(uuid)') IS NULL;")"
[[ "$no_partial" == "t" ]] || { echo "FAIL: runner abort left partial SQL"; exit 1; }
echo "PASS: forced migration failure rolled back all partial SQL"
# Execute the runner-safe package as the runner does: outer BEGIN/COMMIT.
{
 printf 'BEGIN;\n'
 cat supabase/proposals/issue60_staging_runtime_apply_migration_review_only.sql
 printf '\nCOMMIT;\n'
} | docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres \
 -d postgres -X -v ON_ERROR_STOP=1 -f -
run_sql supabase/tests/issue60_pr59_identity_compatibility_checks.sql
run_sql supabase/tests/issue60-pg17-dispatch-receipt.sql
run_sql supabase/tests/issue60_host_identity_boundary_pg17.sql
# A fully-installed package MUST reject a second full installation, not just
# repeat a helper operation. A failed repeat must not write a new receipt.
repeat_result="$(
 {
   printf 'BEGIN;\n'
   cat supabase/proposals/issue60_staging_runtime_apply_migration_review_only.sql
   printf '\nCOMMIT;\n'
 } | docker exec -i -u postgres "$container" psql -h /var/run/postgresql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f - 2>&1
)" && { echo "FAIL: repeating full runtime package succeeded"; exit 1; }
grep -Fq 'Issue60 runtime exists or partially installed' <<< "$repeat_result" ||
 { echo "FAIL: repeated package error did not match expected preflight"; exit 1; }
run_sql supabase/tests/issue60_pr59_identity_compatibility_checks.sql
echo "PASS: repeating full runtime package is denied without identity drift"

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

echo "PASS: seven-staged-source PR59+runtime atomic PG17 parity; no hosted changes"
