# Raxi HQ B2 — five-file OFFLINE review package

This directory is intentionally **outside** `supabase/migrations/` and is **NOT DEPLOYABLE OR AUTHORIZED TO APPLY**. Its SQL files are review copies, **not** a recipe for a generic `supabase db push`. The consolidated file preserves the original `DO NOT APPLY` banner.

Contents: four base migrations (versions already in source) plus **one** runtime → Stage A → Stage B consolidation whose filename version `20261027213431` was created by Supabase CLI 2.122.0 in the user's isolated offline Windows workdir, then populated with the byte-for-byte validated candidate. The CLI did not independently validate the SQL contents.

## Verification
From repo root: `node supabase/review-packages/b2-20261027213431/verify-package.mjs`. This reads only local files: checks exact five names and order, SHA-256 after CRLF→LF normalization, source parity, and excluded campaign migration. It also checks the original canonical seven SQL sources with the existing verifier run from `apps/raxi-hq`: `node scripts/verify-staging-preparation.mjs` and `node scripts/consolidate-runtime-candidate.mjs --check`.

Do not interpret a pass as authorization to execute a migration. Never copy this review package into the production repository's live migrations directory or perform `supabase link`, `db push`, `migration up`, `db reset`, a deployment, or remote SQL based on this artifact. The standalone future deployable package requires a new review and human approval.

## Known staged blockers and acceptance
- PR #24 local PostgreSQL 17 SQL tests passed with synthetic Auth/Storage; hosted Auth, JWT and grants **not validated**.
- PR #25 recorded staging preflight **11 PASS / 2 BLOCK**: `service_role` lacks SELECT on required `auth.sessions` and `auth.users` columns before installation. Stage B contains column-level grants; never apply ad hoc fixes.
- Auth, Storage, PUBLIC function EXECUTE, RLS ownership/isolation, restoration plan and real hosted integration remain separately gated.
- All permissions in `supabase/staging/raxi-hq-staging.manifest.json` remain false, its consolidated version stays null and `executionReady` false.
- No test users, SQL hosted, B2 run, providers, spend, merge or deployments are authorized by this package.

Provenance: `docs/RAXI_HQ_B2_CLI_MIGRATION_PROVENANCE.md`. Production strictly excluded.
