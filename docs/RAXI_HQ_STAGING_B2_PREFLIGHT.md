# Raxi HQ — Staging B2 preflight (preparation only)

Status: **NOT AUTHORIZED TO APPLY**. This increment does not execute B2, deploy applications, create hosted users, turn on providers, or modify hosted schema.

## Hard boundary

- Sole permitted read-only discovery target: **raxi-hq-staging** `zvhxjindgyvtasstfjut` (region `us-east-2`).
- **Never** run this against production `jrkefsylpfriiqefcmzq`.
- Preflight SQL: `supabase/tests/staging-b2-preflight.readonly.sql`. It queries PostgreSQL *catalog metadata*, not Auth/user/session rows.
- Nothing in this directory is a migration, executor, `db push` plan, approval to alter hosted SQL, or approval to use real providers.
- Preflight must be run with an explicitly selected staging project connection. Fail closed if the selected project ref cannot be independently verified outside SQL.
- Do not run a generic `supabase db push`; the unrelated campaign migration is excluded.

## Observed read-only baseline, 2026-10-27

Via Supabase project and catalog read-only tools: staging reported **ACTIVE_HEALTHY**, PostgreSQL **17.11.0.003**, **zero applied migrations** and **zero public tables**. The catalog reported schemas `auth`, `storage`; functions `auth.uid() returns uuid`, `auth.jwt() returns jsonb`; `auth.sessions` columns `id uuid`, `user_id uuid`, `not_after timestamptz`; `auth.users` columns `id uuid`, `is_anonymous boolean`; roles `anon`, `authenticated` without BYPASSRLS, `service_role` with BYPASSRLS. No user/session records were queried.

This is **catalog presence evidence only**. It does not prove actual SELECT/EXECUTE effective privileges for service_role, authentic JWT/session behavior, storage policy compatibility, or a completed B2 run. The new SQL additionally checks catalog privileges but must be reviewed and run read-only before recording its results.

## Proposed gates, in order

1. Confirm selected staging project ref, healthy state, major version 17, migration list and public baseline; independently verify project identity before any SQL.
2. Review the read-only SQL for catalog-only access. Run it only against staging; record complete PASS/BLOCK results, timestamp and project ref without secrets.
3. Audit effective service_role access to `auth.sessions` and `auth.users`, relevant schema USAGE and field-level GRANTs. Table-wide SELECT absence does not automatically imply missing required column-specific SELECT; investigate any BLOCK conservatively and review separate column checks before concluding compatibility.
4. Compare actual hosted Auth/Storage objects and grants with the assumptions of four base migrations plus candidate runtime/A/B and the PostgreSQL 17 local schema snapshot. Do not claim parity from the local synthetic fixture.
5. If every prerequisite is satisfied, propose an independent Supabase CLI **offline** migration generation with real CLI-generated version, reproducible SHA-256 and exclusion of the campaign migration. This is a *future separately reviewed step*.
6. Separate authorization for any hosted migration, test user creation, Auth session flow, B2 execution, provider enablement and deployment. Never infer approval from passing preflight.

## Evidence & remaining acceptance

Local PG17 SQL validation was merged via PR #24 at `4664b7356317d2e5cabd2dbbacd5d887f043b6f9` (reported 639 PASS, reviewed code 0 findings). Local bootstrap Auth/Storage was synthetic and cannot substantiate hosted JWT/Auth. Hosted migrations, B2, test accounts, third-party providers and runtime dispatch remain **NOT DONE**.

Security review targets: no `SECURITY DEFINER` shortcuts; PUBLIC default EXECUTE exposure; `service_role` server-only; RLS ownership and cross-workspace negatives; `auth.sessions.not_after`, `auth.users.is_anonymous` behavior; grants on columns; journal P2 and reservation boundaries. Respect the immutable staging manifest authorizations (`false`) and pending `cliMigrationVersion:null` until independently authorized and reviewed.

### Fail-closed rule

Any unknown/failed check, changed source hash, catalog difference, missing privilege, uncertain destination, or unstated authorization **blocks** hosted changes. Document the observed discrepancy; do not patch Auth, modify grants, introduce real accounts, reset tables, or force PASS.


## Executed read-only preflight findings, 2026-10-27

Executed the SQL from this PR through the Supabase connector with **project_id=`zvhxjindgyvtasstfjut`**. First attempt exposed a literal ESCAPE error and was corrected to `starts_with`; it caused no write. The corrected query returned **11 PASS / 2 BLOCK**:

- `service_role_select_auth_sessions = BLOCK`: `service_role` lacks table-level SELECT on `auth.sessions`.
- `service_role_select_auth_users = BLOCK`: `service_role` lacks table-level SELECT on `auth.users`.
- Follow-up catalog-only `has_column_privilege` checks: **false** for sessions `id,user_id,not_after` and users `id,is_anonymous`.

The stage B proposal itself contains `GRANT SELECT (id,user_id,not_after) ON auth.sessions TO service_role` and `GRANT SELECT (id,is_anonymous) ON auth.users TO service_role`. These missing rights are therefore a **pre-application delta**, not evidence that hosted PG17 cannot support the proposal. The current standalone preflight intentionally returns BLOCK until the intended grants are reviewed and separately authorized/applied as part of the approved migration transaction. Do **not** grant them as an ad-hoc fix. After any future authorized application, rerun checks for the exact required **column-level** privileges as well as table-level metadata; column GRANTs need not imply table-wide SELECT. No hosted grants or schema objects were changed during this run.

Remaining: verify schema USAGE privileges, full Auth/Storage native contract, migration package and CLI version before proposing a hosted write. **B2 NOT AUTHORIZED.**
