# Raxi HQ — Staging readiness and first supervised Director run

**Status: planning and review only. Not authorization to run.** This runbook has **three separately gated workstreams**. No hosted SQL (even test writes), users, B2, deployment, tokens or provider calls are authorized. The original staging preparation manifest remains unchanged; all its authorizations remain false.

## Fixed identity and evidence

- Staging only: `raxi-hq-staging` / `zvhxjindgyvtasstfjut` / PostgreSQL 17.11 (as last observed). **Production** `jrkefsylpfriiqefcmzq` explicitly excluded.
- PR #24: native local PostgreSQL 17 validation with synthetic Auth/Storage. PR #25: previous **read-only** staging preflight 11 PASS / 2 BLOCK; *not* evidence of installed tables, real JWT sessions or operational readiness.
- PR #28 merged: immutable **review-only** five-file package in `supabase/review-packages/b2-20261027213431/`, four base SQL plus CLI-versioned consolidated `20261027213431_supervised_runtime_b2.sql`; local mutation tests (one clean, three rejected) observed from user checkout. **No files may be copied to live `supabase/migrations/` and no general `db push` is permitted.**
- Excluded migration: `supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql`. Candidate header `DO NOT APPLY` remains in review SQL. Consult `supabase/staging/raxi-hq-staging.manifest.json`, but **do not flip** `executionReady`, `cliMigrationVersion`, `consolidatedRuntimeVersion` or authorization flags via this plan.

## Workstream 1 — Controlled application and recovery DESIGN (no SQL execution)

1. **Read-only refresh:** capture time, staging project ref, PG major/minor, baseline migration history and public Raxi catalog, Auth/Storage capabilities, roles and grants (metadata only). Compare to the prior PR #25 snapshot. Drift => STOP. Confirm production ref is not selected or configured in any application tool.
2. **Five-file review ledger:** snapshot Git commit, CLI v2.122.0, actual version `20261027213431`, file order and SHA256(LF). Run both offline verifiers + negative tests; compare the seven original source hashes and package list; explicitly exclude the campaigns migration and any unexpected SQL.
3. **Dependency and risk map:** identify extensions, schemas, required role privileges, potential long-running locks and every DDL/GRANT/security-definer side effect. Verify migration numbering collisions or independently installed history. Define **exact migration executor and atomicity semantics only after reviewing its real `--help` / SQL behavior**. Never assume five files across transactions are atomic. Decide per-migration safe failure boundaries.
4. **Backups:** inventory actual staging backup coverage and retention with read-only evidence. A provider's scheduled snapshot is *not* by itself a verified restore. Create an approved restoration strategy covering DB schema/data, Auth users/sessions and Storage metadata/files (which might require separate handling), recovery owner and acceptable data loss. Prove restore on an independently authorized disposable target **before** hosted writes. Do not run destructive rollback in staging.
5. **Pre-write go/no-go:** explicit scoped human approval must name staging ref, exact five SQL files plus SHA256, execution identity, maintenance window if needed, backup+restoration evidence, rollback/forward-fix strategy and stop conditions. Without approval STOP. A reviewed PR or CLI hash alone is not authorization.
6. **Future execution (not in this PR):** run only the approved exact-scope migrations with per-step checks and durable audit evidence; abort on mismatch or partial failure. Absolutely no generic `db push`, blanket grants, campaign migration or production operations.

## Workstream 2 — Supabase Auth, RLS, permissions and tenant isolation

**A. Before install, read-only:** recheck schemas and role membership, auth.users/auth.sessions availability and *five exact required column privileges* for service_role. Previous preflight's 2 BLOCK (permission gaps) are an **expected preinstall state**, not a reason to improvise hosted GRANT. No user creation.

**B. After separately approved install, read-only first:** verify the exact migration versions/history, target PG17, expected tables/functions/views/triggers/grants, `row_security` policies, ownership, `security_invoker` views where applicable, restricted EXECUTE on SECURITY DEFINER functions, fixed search_path, grants not given to PUBLIC accidentally, service_role column SELECT granted *only* as reviewed in Stage B, and no permissions on unrelated relations. Check migration effects and inventory against a known baseline.

**C. Real Auth and workspace tests require their own user-creation/test-run approval:** at least workspace A owner, workspace B owner, workspace A non-member; use real Supabase-issued JWTs and session IDs, compare anonymous / authenticated / service_role access and revoked/expired sessions; test positive operations within workspace A and *rejection* of cross-workspace read, create, claim, release, replay and journal access into B. Check both RLS policies and server-side authorization guards. Verify Storage scope and no public bucket exposure. Do not derive authorization from user-editable user_metadata. Verify login/session freshness and admin secret separation. Execute tests only in an approved, isolated fixture with cleanup and evidence retention.

**Acceptance:** explicit PASS for Auth, privilege, RLS, tenant isolation, replay/race conditions and failure recovery. Any privilege or cross-tenant leak is a hard STOP and needs a reviewed fix, not ad hoc hosted changes.

## Workstream 3 — First supervised Director execution, simulated provider

**Scope of future authorized B2 exercise** (not done by preparing this document): single staging workspace, single **synthetic** task/idea, single Director invocation. Real model/provider/API spending forbidden. `SIMULATED_ONLY` provider response must be deterministic, bounded and produce no external requests. The Director is an actual orchestrator path (not UI-only), but must stop at the human approval gate and must not spawn downstream agents unless explicitly separately approved.

Sequence and observability:
1. Explicit scoped approval referencing project, workspace, task ID, permitted operations, expected outputs, expiry and max invocations. Protect against reuse.
2. Verify actual authenticated identity and workspace ownership; create/intake task only if authorized, record initial journal event and idempotency key.
3. Enforce approval-before-claim; claim once; reject duplicate claims, expired approvals and cross-tenant requests; acquire lock or supported atomic DB primitive.
4. Run simulated Director decision, produce a bounded artifact (plan/summary only), attach provenance + provider=`SIMULATED_ONLY`, costs=0 **observed**, not merely assumed.
5. Persist auditable state/journal transitions; verify exactly-once commitment or documented idempotency under retry; test crash/timeout and recovery without leaking claims or duplicating actions.
6. Stop at explicit boundary before Investigator/Creative/Publisher/production, no auto-publication, image generation, external API, credentials or spend.

**PASS** only if operator can reproduce task state, authorization, journal, isolation, retries, lock handling and human-readable output. **FAIL** on unauthorized state transitions, absent journal, double-execution, cross-workspace access, unexpected network calls, or spend.

## Separate approval and review matrix

| Gate | Current status | Distinct approval needed |
| --- | --- | --- |
| Documentation/planning PR | ALLOWED | Review and human approval before merge |
| Read-only refresh of staging metadata | PREVIOUSLY PERMITTED, not rerun here | Confirm exact read scope; no queries on private row data |
| SQL migration hosted | BLOCKED | Exact five SQL + backup + target-specific authorization |
| Test user accounts / JWT / Auth end-to-end | BLOCKED | Names, lifecycle and cleanup authorization |
| B2 simulated Director runtime | BLOCKED | Single scoped B2 execution authorization |
| External provider, publishing, additional spend, deployment | BLOCKED | Separate explicit authorization, not inferred |

**Next execution sequence:** review this plan → read-only baseline and recovery capability inventory → design/fail-safe gate tests offline → inspect and approve a future SQL application plan → apply ONLY after separate user authorization → post-apply read-only audit → separately approved Auth fixture → separately approved single simulated Director run. Progress on one gate never implies approval for the next.
