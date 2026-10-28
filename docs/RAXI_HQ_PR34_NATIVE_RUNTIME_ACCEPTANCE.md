# Raxi HQ PR #34 — Native PG17 supervised runtime acceptance

**Status: review-only specification and static preflight. No Docker, SQL execution, hosted actions, providers or merge authorized by this PR.**

## Evidence and real code

- PR #32: 51/51 PGlite tests for the existing real Director orchestration, with synthetic Auth doubles and simulated provider; integrated.
- PR #33: native PG17 `authenticated` RLS workspace A/B read isolation and disposable-container cleanup PASS; integrated. It **did not** exercise claims, concurrency, journal or runtime adapters.
- `supabase/proposals/agent_runtime.sql` declares `raxi_runtime_claim(uuid,text)`, active-run unique indexes and a `current_user='service_role'` gate.
- `supabase/proposals/supervised_host_stage_a.sql` adds journal validation, append-only trigger, `raxi_supervised_prepare`, `raxi_supervised_approve` and `raxi_supervised_step`.
- `supabase/proposals/supervised_host_stage_b.sql` contains hosted Auth-related permissions, but a local test with synthetic sessions **cannot** validate hosted Auth or JWT.
- `supabase/tests/pg17-bootstrap.sql` creates synthetic `service_role` with BYPASSRLS. **Runtime tests under this role verify explicit server-side authorization, NOT RLS.**

## Acceptance gates

1. **Static integrity (now):** load the staging manifest offline; assert exactly four BASE_MIGRATION + three RUNTIME_PROPOSAL paths in order; compare LF-normalized SHA256 to the manifest; assert `executionReady:false` and all authorization flags false; assert real runtime function entry points are present in checked SQL. No Docker or network.
2. **Native fixture harness (implementation pending):** build on the isolation, exact-ID cleanup and `--network none` pattern from PR #33; create a **new** disposable PG17 container; load `pg17-bootstrap.sql` and the seven original SQL sources in manifest order. No contact with the immutable old `raxi-pg17-validation` or OpenGym. Fail entire run if cleanup fails. Never use hosted credentials.
3. **Role/scope authorization:** exercise `service_role` functions using distinct synthetic workspace A/B tasks; reject foreign approval, invalid scope, revoked approval, expired budget and non-server caller with **zero provider calls**. Check actual function semantics from source before coding assertions; no invented grants.
4. **Claim concurrency/idempotency:** race two real PostgreSQL sessions attempting the same approved task; require one active reservation and one logical effect. Check unique indexes, transaction boundaries and idempotent receipt replay. Mere sequential calls do **not** satisfy concurrency.
5. **Journal durability:** verify append-only journal for runtime role, changed replay rejection, version/digest integrity, rollback on failure, and recovery after lost acknowledgement. Distinguish a simulated receipt from a real provider response.
6. **Runtime adapter parity (separate):** connect the actual Director `runOne` via a native PG17 repository adapter and simulated provider; SQL-only tests do **not** prove adapter parity. Must not perform external network.
7. **Evidence/cleanup:** capture exact commit, source hashes, database PG17 version, roles, passing and failing test names, total exit status, zero network/ports, container disposal. Distinguish `PG17_RUNTIME_SQL_SYNTHETIC_AUTH` from `PG17_RUNTIME_ADAPTER`.

## Hard exclusions

No Supabase staging/production SQL, migration application, Auth account creation, B2, spending, publishing, real Magnific/Aria Studio requests, deployment, or GitHub merge. PR #31 recovery documentation remains independent.

## Static preflight

From repo root: `node scripts/preflight-native-runtime-pr34.mjs`. This performs **only local file reads and hashing**, never Docker. A PASS is not a native runtime execution result.

**Next implementation step:** inspect the precise function signatures and required input fixtures, then implement negative-first native runtime SQL tests with an explicit `--run-local` flag, separated from the future native adapter integration. Request Codex review before running the new harness.

## New executable smoke increment (not full runtime acceptance)

`node scripts/run-native-pg17-runtime-pr34.mjs` verifies seven sources and manifest in offline-only precheck mode. `node scripts/run-native-pg17-runtime-pr34.mjs --run-local` opts into a new disposable PG17 container, synthetic fixture bootstrap and seven source loads, then checks effective function EXECUTE grant boundaries between `service_role` and `authenticated`, presence of append-only journal trigger, denial of journal TRUNCATE, and a missing-task claim rejection as `service_role`. Cleanup is guarded by exact container identity and failures signal nonzero exit. **This does NOT test an authorized task claim, concurrency, real journal mutations/replay, full approval lifecycle, or native `runOne` adapter.** Nothing executed yet; outcomes must come from user local run.
