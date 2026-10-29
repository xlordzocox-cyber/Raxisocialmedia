# Raxi HQ — PR #36: Staging Readiness, Auth/RLS and workspace isolation gates

**DRAFT / OFFLINE PREPARATION ONLY. NO HOSTED SQL, B2, ACCOUNTS, PROVIDERS OR DEPLOYMENT AUTHORIZED.**

## Goal and baseline

Prepare a reproducible, fail-closed acceptance checklist **without installing the runtime**, introducing a new coordinator, creating tables, changing `AGENTS.md`, altering the immutable staging manifest or disturbing Raxi HQ Pixi/React Office.

- Canonical repo: `xlordzocox-cyber/Raxisocialmedia`; PR #35 merged into `main` at `87f4d3126fe364a400b1402b3395020f441d8935`. PR #31 backup/restore documentation merged at `a382247259f6a20588d05072726f8d4aca64fe1c` (PR36 branch base).
- **Staging ONLY:** `raxi-hq-staging` / `zvhxjindgyvtasstfjut` / `us-east-2`, organization `qpjzdqkvjzgqwvismeku`. Production `jrkefsylpfriiqefcmzq` is excluded.
- **Metadata-only read observation 2026-10-29:** project `ACTIVE_HEALTHY`, database PostgreSQL `17.11.0.003`; `list_tables(['public'])=[]`, `list_migrations=[]`, `get_advisors('security').lints=[]`. These are point-in-time read-only connector results, **not** an Auth/RLS PASS or proof of back-ups.
- PR #25's hosted Auth catalog preflight on 2026-10-27 was **11 PASS / 2 BLOCK**: five `service_role` column-SELECT checks false, namely `auth.sessions` (`id`, `user_id`, `not_after`) and `auth.users` (`id`, `is_anonymous`). **Not refreshed by this PR.** The Stage B proposal includes reviewed column grants; this is no authorization for ad hoc hosted GRANT.
- PR #31 verifies the **empty `public` schema only**: 1,679-byte custom-format dump, complete SHA-256, `pg_restore --list`, and user-executed isolated local restore returning `t|0`. It is **not** Auth/Storage recovery, database snapshot, or backup/restore readiness.
- `supabase/staging/raxi-hq-staging.expected-schema.json` was generated from historical **PG18** metadata; that file is **not** evidence of parity with current hosted PostgreSQL 17. Preserve the existing manifest and explicitly flag this gap.

## What this PR does

This PR adds only:
1. `scripts/pr36-readiness-contract.mjs` — pure validation of **staging identity**, all six hosted denials, seven immutable ordered source SQL hashes, excluded unrelated campaign migration, expected-schema checksum and catalog-query shape. Returns explicit `PREINSTALL_ONLY`/`NO-GO` fields; never claims effective privileges.
2. `scripts/preflight-staging-readiness-pr36.mjs` — offline source-integrity check with **zero** Docker/network/SQL calls.
3. `scripts/test-staging-readiness-pr36.mjs` — negative tests for changed staging ref, production ref, changed flags, source hash/order/exclusion, schema and catalog SQL mutation.
4. This evidence-based readiness plan. **No changes** to migrations, stage proposals, runtime, Pixi, stores, permissions or `AGENTS.md`.

From repository root:
```powershell
node scripts/preflight-staging-readiness-pr36.mjs
Write-Host "Preflight: $LASTEXITCODE"
node scripts/test-staging-readiness-pr36.mjs
Write-Host "Negativas: $LASTEXITCODE"
git diff --check origin/main...HEAD
Write-Host "Diff: $LASTEXITCODE"
```
No `--run-local`/hosted modes are supported; unexpected arguments must fail.

## Readiness gates — evidence and explicit stop conditions

| Gate | Baseline evidence | Required next proof | Current disposition |
| --- | --- | --- | --- |
| Target / manifest integrity | Fixed staging ref, 7 source SHA256(LF), 6 deny flags | Offline check against checkout at exact PR head | **Pending local run** |
| Hosted PG17 / empty baseline | Connector metadata, zero public tables and migrations (2026-10-29) | Repeat metadata immediately before any authorized write | **Observed, time-bounded** |
| Auth roles and `auth.sessions`/`auth.users` required columns | PR25 11 PASS / 2 BLOCK (2026-10-27) | Separately reviewed **catalog-only** query and five distinct `has_column_privilege` checks; never read private rows | **BLOCK until proven** |
| Current RLS / function EXECUTE / views | Runtime not installed in public schema | After separately approved install, audit catalog RLS, policy ownership, SECURITY DEFINER/PUBLIC EXECUTE, search_path, `security_invoker`, role grants | **NOT INSTALLED / NO TEST** |
| Hosted workspace isolation | PR33 local synthetic A/B isolation, not hosted Auth | New distinct consent for hosted test identities + authenticated A/B owner and nonowner, expired/revoked session, cross-tenant read/claim/write/journal negative checks | **NOT TESTED HOSTED** |
| Hosted B2 Director | PR35 local PG17 and JS adapter with simulated provider | Separately approved migration, Auth binding and one scoped simulated run; audit receipt, cost and journal | **BLOCK** |
| Backups / rollback | Empty-`public` local restore only | Document full logical scope/coverage (Auth, Storage metadata+object bytes, roles/ACL), RPO/RTO, safe recovery test and stop strategy | **NO-GO** |
| Production or external provider | Explicitly excluded | Separate, future scoped user consent and security checks | **NOT AUTHORIZED** |

## Authentication, RLS and approval design constraints

Supabase user sessions include a `session_id` claim associated with `auth.sessions`. A JWT's mere presence or `authenticated` Postgres role does **not** prove a current authorized session or workspace ownership. `server/agent-runtime/supabaseSupervisedAuth.ts` already defines a server-only validated-claims + `getUser` + privileged session/owner RPC path; **reuse, do not introduce parallel Auth**. No secret/service role in browser, no user-editable `user_metadata` for authority, no anonymous sessions as humans.

A future post-install read-only audit must check actual role privileges and exact RLS `USING` and `WITH CHECK` constraints, callable functions, grants, views and ownership. Do not infer authorization from a clean security advisor or expected schema JSON. Test workspace A/B isolation only against a separately approved synthetic fixture. Never classify a mock execution as LIVE, and do not animate Pixi avatars or populate `Te toca` from these preinstall checks.

Reference contracts already present:
- `supabase/tests/staging-b2-preflight.readonly.sql` (catalog-only SQL; **not executed by PR36**).
- `server/agent-runtime/supabaseSupervisedAuth.ts`, `supabaseSupervisedRepository.ts`, `supabase/proposals/supervised_host_stage_b.sql`.
- `supabase/review-packages/b2-20261027213431` five-file review-only package; exact package checks remain independent.
- `docs/RAXI_HQ_STAGING_BACKUP_RECOVERY_PLAN.md`; `docs/RAXI_HQ_STAGING_READINESS_AND_FIRST_DIRECTOR_RUN.md`.
- Supabase official docs: https://supabase.com/docs/guides/auth/sessions and https://supabase.com/docs/guides/database/postgres/row-level-security .

## Explicitly out of scope

No `execute_sql`, SQL migration/push, `GRANT`, user creation, JWT/session tests, external network calls in scripts, backup extraction, site restore, B2, background/night workers, API services, deployments, publishing, spending, production access, or changes to the staging manifest's six false authorization flags. **A successful PR36 preflight never changes any of these restrictions.**

## Proposed merge acceptance and next stage

- Codex independent review on exact head; no unresolved new P1/P2.
- User-local offline preflight + all negative tests exit 0; optional build/tests if any app/runtime source is later changed.
- Review diff scope (only new scripts + docs), confirm no manifest/SQL or `AGENTS.md` modifications, `git diff --check` success.
- User explicitly approves PR36 merge separately.
- **Next PR after this:** propose exact **catalog-only** hosted inspection, backup gap closure and identity-bound acceptance tests. Auth row data, migrations, test identities and B2 must each receive a separate scoped authorization before execution.
