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

## Increment: committed confirmation recovery, distinct native PG17 clients

The opt-in `scripts/run-native-recovery-pr35.mjs` is a separate **local-only** acceptance script, not an application/hosted integration. Its default invocation is offline source/bootstrap/authorization preflight. With `--run-local`, it uses the pinned seven SQL files in an isolated, disposable, networkless `postgres:17` instance and:

1. Prepares, approves and claims a synthetic DIRECTOR task using canonical SQL and commits the setup.
2. Executes `dispatch`, `ack`, `finish` in independent `psql` client connections and commits every journal step.
3. For `finish`, intentionally suppresses the response body while still committing the transaction: the *client does not obtain the confirmation JSON*.
4. Exits that connection, reconnects using a distinct `psql` process, reads the durable confirmation from the append-only journal, and replays the exact finished operation.
5. Asserts that the recovery returns the exact persisted confirmation, rejects a changed replay, leaves **three journal entries**, **one run**, **one budget reservation**, **one ACK**, **one completion event**, and no automatically created RESEARCHER stage.
6. Verifies exact disposable-container identity before cleanup and fails if cleanup cannot be confirmed.

**Not yet executed:** This is a controlled *post-COMMIT dropped client confirmation*, not a real network failure, machine crash, PostgreSQL service restart, actual simulated-provider dispatch, lost unknown receipt reconciliation or app `runOne` native adapter restart. No externally billed calls, hosted SQL/B2 or deployments are authorized. Codex review and explicit user-local test evidence are required before recording any PASS.

**Office UX traceability:** These durable journal identities and provenance fields are future evidence sources for Raxi HQ agent details and the human-decision inbox; do not emit live avatar motion from this synthetic test or create a parallel store/runtime.

## Increment: native JavaScript Director adapter on disposable local PG17

The opt-in `scripts/run-native-js-adapter-pr35.mjs` uses the **existing** `runOne`, `localSupervisedRepository`, and `simulatedProvider` modules bundled from the checked-in TypeScript sources with the project's **already installed** `esbuild`. It does not create or change a second runtime. No dependency installation is attempted. If `esbuild` is absent from `apps/raxi-hq/node_modules`, the native opt-in run fails closed.

The CLI defaults to strictly offline preflight with seven ordered, pinned SQL source hashes, bootstrap integrity and all hosted authorizations denied. `--run-local` is the sole opt-in for a new isolated, networkless, disposable `postgres:17` container. In local mode it supplies a `LOCAL_POSTGRES_FIXTURE` port that calls the existing local repository through type-inferred `PREPARE/EXECUTE` in a fresh `psql` session, with server-side role scoped to `service_role`, and uses exactly one injected `simulatedProvider`. The fixture manually prepares and approves one DIRECTOR task, then calls the real `runOne` coordinator, confirms three journal transitions, exactly one run/ACK/finish/budget reservation, a single simulated provider invocation, no automatic RESEARCHER and exact finish confirmation readback. A second `runOne` must not invoke a second provider call. Database verification is independently read from committed PostgreSQL rows, not just from the JavaScript result.

**NOT YET EXECUTED OR REVIEWED:** The script's intended assertions need independent Codex review and actual user-local execution. A source-integrity preflight does not validate the JS port nor integration behavior. This does **not** prove a hosted Auth integration, genuine external provider behavior, network fault/crash recovery or actual publishing. Simulated execution remains `MOCK/UNVERIFIED` and must not render as REAL office work. No remote SQL, B2, deployment, publication or costs are authorized.
