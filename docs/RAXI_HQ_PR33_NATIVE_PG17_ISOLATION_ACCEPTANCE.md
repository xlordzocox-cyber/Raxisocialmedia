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
| RLS workspace A/B | Use the actual SQL role `authenticated` with **two synthetic JWT identities** A/B supplied through the same `auth.uid()` mechanism expected by the SQL policies; make each query transaction-scoped, change subject identity and verify each can SELECT its own rows but not the other workspace. Do NOT fabricate write grants: base tables grant authenticated SELECT only where declared. Check actual functions/RPC separately, respecting their explicit grants |
| Privilege boundaries | Explicit grants/denies; no default public EXECUTE for privileged functions, no bypassrls roles |
| Human approval | Missing, expired, revoked, wrong scope and foreign-workspace approvals must fail closed without provider dispatch |
| Idempotent concurrent claims | Two sessions using the actual runtime `service_role` path racing the same synthetic task yield one logical claim/reservation. `service_role` has BYPASSRLS in the existing local bootstrap, so test explicit workspace authorization in functions separately from RLS; do not claim RLS enforcement under service_role |
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

## SQL-grounded preflight findings (source inspection only)

Checked `supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql`: base Raxi tables including `public.raxi_workspaces`, `raxi_agent_tasks`, `raxi_agent_events` and `raxi_approvals` explicitly enable RLS; `authenticated` receives table-specific SELECT grants. **RLS enablement and grants alone do not prove owner/workspace isolation**; the exact policy expressions, ownership and effective role/JWT settings must be verified in the native fixture.

Checked `supabase/proposals/supervised_host_stage_a.sql`: real `raxi_supervised_prepare`, `raxi_supervised_approve`, `raxi_supervised_step` and execution-key functions exist in a proposal; verify SECURITY DEFINER privileges, search_path and default PUBLIC EXECUTE as actually declared before selecting roles.

Checked `supabase/proposals/supervised_host_stage_b.sql`: Stage B proposes `service_role` usage on `auth` and narrow column grants (`auth.sessions(id,user_id,not_after)`, `auth.users(id,is_anonymous)`), plus `raxi_supervised_host_command`/identity functions. These remain **proposals**, not applied grants on staging. A synthetic local role named `service_role` cannot replace genuine hosted JWT/session verification.

### Gate sequence toward production

`PG17_LOCAL_SQL_SECURITY_PASS` → `PG17_LOCAL_RUNTIME_ADAPTER_PASS` → `STAGING_MIGRATION_APPROVED_AND_RESTORABLE` → `STAGING_REAL_AUTH_AND_RLS_PASS` → `STAGING_SIMULATED_PROVIDER_SUPERVISED_PASS` → separately reviewed production deployment decision.

No gate implies authorization for the next. Production remains outside test scope until fresh backup/recovery evidence, rollback plan, permissions audit, deployment dry run and explicit human approval exist.

## Codex P2 correction — two distinct identities and explicit SQL source order

**A. RLS phase:** base migrations define `authenticated` grants and owner policies through `auth.uid()`. Test as the **same non-BYPASSRLS** database role `authenticated` while switching only synthetic JWT `sub` A/B with transaction-local claims. Verify cross-workspace reads are denied and unauthorized DML is rejected if no grants; never create two artificial owner-specific SQL roles or invent table write privileges.

**B. Runtime phase:** `supabase/proposals/agent_runtime.sql` checks `current_user='service_role'` for claim/execute. Existing `supabase/tests/pg17-bootstrap.sql` uses `service_role` with BYPASSRLS. Test role-dependent authorization, journal integrity, approvals and idempotency under this actual semantic; bypassing RLS here means these results cannot be labeled RLS tests.

**C. Required fixture source order:** first the already pinned four base migrations in the order listed by `supabase/staging/raxi-hq-staging.manifest.json`, then `supabase/proposals/agent_runtime.sql`, then `supabase/proposals/supervised_host_stage_a.sql`, then `supabase/proposals/supervised_host_stage_b.sql` where stage B is specifically under test. Compare every source and LF-normalized SHA-256 against the manifest's seven canonical inputs, plus use reviewed local `supabase/tests/pg17-bootstrap.sql`. Source mismatches STOP. Do not load the runtime proposal alone or assert claims/journal exist from base migrations. Local fixture application does **not** authorize installing SQL in hosted staging.

**Status:** Codex P2 findings identified; this plan correction is pending fresh review and has NOT been executed in native PostgreSQL yet.

## First executable increment — RLS read isolation only

`node scripts/run-native-pg17-rls-pr33.mjs` **without** `--run-local` performs an offline manifest/hash precheck; no Docker. `node scripts/run-native-pg17-rls-pr33.mjs --run-local` explicitly opts into a new isolated PostgreSQL 17 container (locally cached image only, no network/ports, tmpfs). It loads the native synthetic Auth/Storage bootstrap plus the seven immutable manifest sources in order, inserts two synthetic users/workspaces, then runs non-BYPASSRLS `authenticated` identity A/B RLS read assertions. It cleans up only its own container ID if identity matches. **Not executed yet; no PASS claimed.** Runtime role claims, concurrency, journal, Auth JWT signing and hosted staging require separate later tests.
