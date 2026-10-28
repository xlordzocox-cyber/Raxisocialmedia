# Raxi HQ PR #33 — Native PostgreSQL 17 isolation acceptance plan

**REVIEW-ONLY — NO RUNTIME EXECUTION, HOSTED SQL, MIGRATION OR MERGE AUTHORIZED.**

## Verified starting evidence

- PR #32 merged at `532b2f17678f2a83741421cae21ad744be231739`: user ran two pre-existing PGlite/Auth-double integration suites with **51 PASS / 0 FAIL / exit 0**. These are **not** native PG17, signed JWT or Supabase hosted tests.
- Existing `apps/raxi-hq/scripts/native-pg17-lab.mjs` is **explicitly pinned to an existing immutable Docker container**. Do **not** invoke its native lab runner or reuse/modify `raxi-pg17-validation`.
- Existing offline candidate/manifest integrity checks remain mandatory. `supabase/staging/raxi-hq-staging.manifest.json` has `executionReady:false`, `authorizations.applySql:false`, `authorizations.runB2:false`. Keep unchanged.
- PR #31 demonstrated a **local restore** of the 1679-byte `public`-schema-only dump (original local file unchanged), not full Auth/Storage recovery; PR #31 remains independent.

## Intended test instance — new, isolated, disposable

Use a **new uniquely named** `postgres:17` container. Before creation inspect only whether name collision exists and verify locally cached image. Options MUST include `--network none`, no `-p`/`-P`, no privileged mode, tmpfs database directory and a separate, ephemeral synthetic fixture. No bind-mount of secrets or backup data is needed. Never assume existing containers are safe to delete. Cleanup must remove **only the exact container ID created by this test**, with a guard checking ID + name; no `docker system prune`, network mutations, blanket stop/remove or volume pruning.

Run no shell-expanded hosted connection strings and no Supabase CLI apply/push/reset commands. No staging or production project credentials; no real provider API calls.

## Native PG17 acceptance matrix (pending implementation and separate local approval)

| Scenario | Evidence required |
| --- | --- |
| PostgreSQL identity | PG 17 exact major version and isolated container inspect, no network/ports |
| Source and role parity | Pin SQL fixture hashes; minimal synthetic `auth.users` and `auth.sessions`; identify PostgreSQL role assumptions and any grant differences, clearly mark native synthetic Auth |
| RLS workspace A/B | Use two distinct **non-owner, non-superuser** SQL roles with `row_security=on`; assert A can see/write A only and B can see/write B only; check direct table SELECT, functions/RPC and forbidden paths |
| Privilege boundaries | Explicit grants/denies; no default public EXECUTE for privileged functions, no bypassrls roles |
| Human approval | Missing, expired, revoked, wrong scope and foreign-workspace approvals must fail closed without provider dispatch |
| Idempotent concurrent claims | Two sessions racing same synthetic task yield exactly one logical claim/reservation and no duplicate simulated provider effect |
| Journal integrity | Append-only guarantees; attempted UPDATE, DELETE and TRUNCATE denied to runtime role; transaction failure leaves no orphan event |
| Crash/uncertainty | Simulate lost confirmation; reconcile using receipt once, never retry an unconfirmed external effect |
| Cleanup | Verify only newly created test container removed, existing PG17/OpenGym untouched |

**Critical distinction:** SQL-only validation of RLS and functions is not proof the runtime `runOne` operates over native PG17; a separate real adapter wiring test is required before making that claim.

## Development stages

1. **PR #33-A:** review and static safety guard source contracts, no Docker or SQL execution. Validate requirements against existing real migrations before choosing exact fixture. Capture ambiguities rather than inventing grants, table names or roles.
2. **PR #33-B:** implement a narrowly scoped native PG17 test harness with hostile negative cases and explicit `--run-local`, never running on import. Static and unit preflight before any Docker execution.
3. **User-authorized local run:** user validates worktree, inspects the Docker lifecycle exact ID, runs only offline test container. Collect per-case exit codes, counts and cleanup.
4. **Compare with PGlite evidence:** document functional parity and gaps; maintain hosted Auth/RLS **not validated** until separately permitted and observed.

## Stop conditions

Stop if missing immutable SQL hash, unknown role privileges, required extensions not present, Docker cannot guarantee offline isolation, unexpected pre-existing container, cleanup identity mismatch, network access, or a test proposes changing staging/production. No automatic switch to PGlite fallback and no live grants as a workaround.
