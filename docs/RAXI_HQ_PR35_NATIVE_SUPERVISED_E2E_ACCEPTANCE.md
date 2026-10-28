# Raxi HQ PR #35 — Native PG17 supervised Director execution acceptance

**DRAFT / REVIEW ONLY. Not an authorization to execute native tests, hosted SQL, B2, real providers, deployments or merge.**

## Verified prerequisites

- PR #32 was merged: **51/51** user-executed PGlite/Auth-double tests, including duplicate claims, journal integrity, uncertainty/restart and approvals. Does not prove native PG17.
- PR #33 was merged: native PG17 authenticated A/B RLS workspace-read isolation with synthetic data and successful disposable-container cleanup.
- PR #34 was merged: native PG17 SQL role EXECUTE boundaries, journal trigger presence, TRUNCATE denial and missing-task claim rejection with cleanup.
- Current source `supabase/proposals/agent_runtime.sql` exposes `raxi_runtime_claim(p_task uuid,p_worker text)`. Source `supabase/proposals/supervised_host_stage_a.sql` exposes `raxi_supervised_prepare(p_actor uuid,p_workspace uuid,p_key uuid,p_stage text,p_spec jsonb,p_request text,p_parent uuid default null)`, `raxi_supervised_approve(p_actor uuid,p_task uuid,p_key uuid,p_digest text,p_revoke boolean default false)` and `raxi_supervised_step(p_actor uuid,p_run uuid,p_token uuid,p_operation text,p_version integer,p_kind text,p_result jsonb,p_receipt text,p_cost bigint)`.
- These real runtime functions require `service_role` semantics. Synthetic native `service_role` with BYPASSRLS is **not an RLS or hosted Supabase Auth test**. Review SQL signatures and fixtures before any new native test execution.

## Exact intended first valid supervised run

1. Create two synthetic workspace owners and workspace A/B in **a new disposable offline PostgreSQL 17 container**. Reuse the pinned bootstrap plus seven source SQL files in manifest order; verify exact names/order and SHA256(LF) beforehand, with all six hosted flags explicitly false.
2. Under `service_role`, insert a **simulated-only**, bounded budget and expiry policy on workspace A. Prepare a DIRECTOR task using the real `raxi_supervised_prepare` SQL function and the existing input contract; record task ID, scope digest and approval conditions.
3. Obtain an independent **synthetic owner authorization** via `raxi_supervised_approve`; prove nonowner, expired, revoked, wrong-workspace and wrong-scope approvals fail before claim with zero effects.
4. Use **two independent native PostgreSQL connections** with controlled overlap and attempt claim for the *same approved task*. Assert precisely one active run, one reservation and one successful claim; test different idempotency keys and retries. Sequential calls alone are insufficient evidence of a race.
5. Progress through the real `raxi_supervised_step` journal flow with synthetic (not external) provider receipt; assert monotonic journal version, replay identical returns prior result, conflicting replay fails and mutation/deletion/truncate are denied.
6. Inject a controlled failure/uncertain confirmation and inspect run + journal to ensure no second effect is dispatched. Confirm a DIRECTOR finish does not enqueue RESEARCHER automatically.
7. Capture per-check PASS/FAIL, transaction and rollback evidence, exact source HEAD, full cleanup confirmation and nonzero exit if cleanup fails.

## Safety and isolation

Use isolated `postgres:17` local cached image only, `--network none`, no published ports, no privileged mode, unique container name and tmpfs storage. Never operate on pre-existing `raxi-pg17-validation`, OpenGym or other containers. Docker cleanup must inspect exact ID and name and remove **only** the new container. Never use hosted credentials, migrate/push/apply SQL to staging, call external providers, change manifests or perform deployments. Production is out of scope.

**Critical gate:** SQL-native successful claims/journal do not prove the app's native repository adapter. A separate actual `runOne` → PG17 adapter → simulated provider integration test is mandatory before claiming full Director E2E.

## PR #35 phases

- **Phase 1 (this commit):** offline-only source contract preflight and negative tamper tests. No Docker.
- **Phase 2:** develop minimal native fixtures and individual negative cases using reviewed real SQL signatures; no synthetic replacement of runtime functions.
- **Phase 3:** develop true two-connection claim race and journal/recovery checks; Codex review and explicit local run.
- **Phase 4:** record result and remaining adapter/hosted Auth gaps. PR merge requires independent explicit approval.

Run `node scripts/preflight-native-supervised-pr35.mjs` from the repo root. PASS only proves source integrity and guards, not runtime execution.

## Increment: two native sessions competing for one approved task

`node scripts/run-native-concurrent-pr35.mjs` performs offline source hash/authorization checks without Docker. `--run-local` opts into a fresh disposable offline PostgreSQL 17 instance and executes a real synthetic prepare+approval transaction, followed by **two independent psql processes** attempting the same `raxi_runtime_claim` and then a committed-state invariant of exactly one claimed run and one reserved budget amount. This is a new test **not yet executed**. Unlike prior PR35 sequential claim smoke it is a genuine two-connection attempt, although exact start-time overlap is scheduler-dependent; evidence must include both outcomes. Does not perform simulated-provider dispatch, journal-step replay, crash recovery or native `runOne` adapter integration. Codex review and local execution required before claiming PASS.
