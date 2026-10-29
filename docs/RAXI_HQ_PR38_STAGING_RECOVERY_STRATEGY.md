# Raxi HQ — PR #38: staging recovery coverage and fail-closed rehearsal strategy

**DESIGN AND OFFLINE EVIDENCE ONLY. DO NOT RUN BACKUPS, READ PRIVATE AUTH DATA, RESTORE, APPLY SQL, CREATE USERS, ACTIVATE B2, DEPLOY, SPEND OR MERGE WITHOUT SEPARATE USER AUTHORIZATION.**

## 1. Why this gate exists

PR #35 proved supervised Director behavior locally with PostgreSQL 17, synthetic task and simulated provider. PR #36 merged offline staging readiness gates. PR #37 documented read-only hosted staging Auth catalogue evidence. **None of these constitute a full backup or permission to install hosted migrations.**

Canonical repository `xlordzocox-cyber/Raxisocialmedia`, PR #38 base: `857c94dd7a8805df899117556688c04599b3169a` (PR #37 merge). Only staging `raxi-hq-staging` ref `zvhxjindgyvtasstfjut`, organization `qpjzdqkvjzgqwvismeku`, region `us-east-2`, PostgreSQL 17.11, Supabase Free. Production `jrkefsylpfriiqefcmzq` is expressly excluded.

2026-10-29 metadata inventory: staging `ACTIVE_HEALTHY`, zero public Raxi tables, zero recorded migrations. Catalog-only Auth preflight: **11 PASS / 2 BLOCK**; `service_role` had Auth schema `USAGE` but lacked five required column `SELECT` grants on `auth.sessions` and `auth.users`. **These permissions stay blocked before installation; do not apply ad hoc GRANT**. See PR #37.

## 2. Actual backup and restore evidence — scope limited to empty public schema

PR #31 documents the user's file `raxi-staging-public-20261027-180405.dump` (1,679 bytes) with full SHA-256 `214d57ca84bbc3341f53663eb6a88daa52838c451a0858c0a913337c094cd7fd`. It was a `pg_dump --schema=public --format=custom --no-owner --no-acl`, created with `PGSSLMODE=require`. The user verified `Get-FileHash`, `pg_restore --list`, then restored **only this empty schema** into a fresh `--network none` disposable `postgres:17` container. The SQL check returned `t|0` (schema `public` exists, no tables); temporary container cleanup completed.

**Classification: `PUBLIC_ONLY_VERIFIED` — never `BACKUP_COMPLETE`.** No evidence that the file contains schema/data of `auth`, `storage`, object bytes, users/sessions, custom roles, passwords, GRANTs, Supabase configurations or Edge Functions. No offsite encrypted copy or server-identity verification was demonstrated. The `PGSSLMODE=require` transfer encrypted traffic but did not establish `verify-full` hostname/CA validation. A clean empty-schema restore **cannot** certify a future restoration of Raxi tables or managed Supabase services.

## 3. Capability matrix: independent assets and proof required

| Asset or boundary | Evidence now | Required proof BEFORE any hosted write |
| --- | --- | --- |
| Empty `public` schema | **PUBLIC_ONLY_VERIFIED** | Retain exact archive SHA; confirm known current staging catalog before write |
| Future Raxi tables, data, views, functions, RLS, triggers and migrations | **NOT YET PRESENT / NOT BACKED UP** | Verify exact reviewed migrations, ability to reconstruct schema and restore representative *synthetic* records (separate approval) |
| PostgreSQL roles/ownership/ACL/default privileges | **NOT EXPORTED OR RECOVERED** | Determine least-privilege supported roles export and targeted restore behavior, with managed-role exclusions |
| `auth` schema and managed Auth user/session records | **NOT BACKED UP** | Define whether project/provider-supported export is possible; privacy and retention scope, permissions and restoration semantics reviewed; do not dump private records under this PR |
| Actual authentication and revoked/expired JWT/session behavior | **NOT TESTED ON HOSTED STAGING** | Later approved Auth service integration, identity checks and A/B workspace isolation tests; database row restore alone is insufficient |
| Storage DB metadata and bucket policies | **NOT BACKED UP** | Source-of-truth for bucket definitions/RLS and separately approved metadata recovery test |
| Storage object **bytes** | **NOT BACKED UP** | Separate authorized object inventory/transfer with count + sizes + SHA-256 per object and reconciliation, not merely `storage.objects` SQL rows |
| Project configuration, Auth providers, secrets and Edge Functions | **NOT RECOVERED** | Document reproducible configuration without exporting credentials; independently reconfigure and validate in authorized isolated target |
| Offsite encrypted copy + version/retention | **NOT OBSERVED** | Evidence of secure, access-controlled, encrypted external copy, successful integrity readback and approved retention |
| Server certificate / host identity via TLS | **NOT VERIFIED** | Project-dashboard CA/root, correct session pooler host, `sslmode=verify-full`, readonly connection test before any approved export |
| Cross-service recoverability and acceptable data loss/downtime | **NOT TESTED** | Owner-approved RPO/RTO, a supported recovery path, and compatible isolated rehearsal with explicit stop points |

**No retention, RPO/RTO or recovery objectives are invented here.** Decide those values with the user before selecting a backup method. As long as any required component is unverified, label the overall state `NO_GO_HOSTED_MIGRATION`.

## 4. Supabase product constraints (official source, 2026-10-29 research)

1. Free-tier projects should perform manual exports and store backups offsite; Supabase's managed daily backups are offered on Pro/Team/Enterprise. https://supabase.com/docs/guides/platform/backups
2. `supabase db dump` uses `pg_dump` with additional exclusions for managed schemas including **auth and storage**. Default dump excludes **data** and **custom roles**; `--data-only` and `--role-only` are separate modes. A three-file CLI export is therefore not a full Supabase service recovery. https://supabase.com/docs/reference/cli/supabase-db-dump
3. Even Supabase-managed database backups contain Storage **metadata, not object bytes**. Storage files need independent extraction/validation and restoration design. https://supabase.com/docs/guides/platform/backups and https://supabase.com/docs/guides/storage/management/download-objects
4. Supabase documents a database TLS connection using the project dashboard root certificate, matching Session Pooler host and `sslmode=verify-full`. This has **not yet been tested by the user** and must not be silently downgraded. https://supabase.com/docs/guides/database/psql
5. The platform-to-self-hosted restoration guide explicitly does not cover transferring Storage objects or redeploying Edge Functions. https://supabase.com/docs/guides/self-hosting/restore-from-platform

**No exported connection string, token, password, host-specific private path or Auth row content is allowed in GitHub.** Supabase services and their managed schemas must not be rewritten to force a convenient backup. Validate installed CLI version/help when any separately authorized operational export is actually planned.

## 5. Brownfield recovery roadmap, in independent scopes

### Gate R0 — PR #38, offline planning ONLY (AUTHORIZED TO PREPARE, NOT EXECUTE)
- Maintain `docs/RAXI_HQ_PR38_RECOVERY_EVIDENCE.json` as a fail-closed coverage inventory: only empty-`public` restore is verified.
- Run `node scripts/verify-pr38-recovery-readiness.mjs` and `node scripts/test-pr38-recovery-readiness.mjs` locally after independent review; no Docker/network/SQL.
- Preserve unchanged `supabase/staging/raxi-hq-staging.manifest.json` (`executionReady:false` and six explicit `false` authorizations); do not change five-file review-only SQL package or `AGENTS.md`.

### Gate R1 — recovery-scope decision (requires new approval BEFORE exports)
- Select exactly which schema/data/bucket objects are in scope, ownership, data minimization and which existing or additional secrets must **never** be copied.
- Choose whether a *future* sandbox target is plain PostgreSQL for logical Raxi data or full compatible Supabase stack for Auth/Storage behavior: do not equate the two.
- Establish RPO, RTO, retention, file encryption/access permissions and a secure destination. Verify pricing and absence of unintended spend.
- Prepare reviewed read-only `verify-full` connectivity test (project CA supplied by user, no credential disclosure) separately; current `sslmode=require` is insufficient as identity attestation.

### Gate R2 — proposed protected exports (separate explicit approval; not in this PR)
- Verify CLI `2.122.0` or actual installed version and `supabase db dump --help`; avoid generic `supabase db push`, `db reset`, project link or other changes to staging.
- Plan independently scoped role export, Raxi schema and data export, optional managed Auth/Storage data handled only through supported official methods and separately approved access, plus actual Storage object-byte export.
- Pin per-file names, sizes, SHA-256, version, source project and timestamp **without** secrets or private row data in the GitHub ledger. Verify checksum after copy. Do not assume permissions allow extracting managed rows.
- No unattended/night jobs, network uploads, additional projects or paid services without separate authorization.

### Gate R3 — disposable isolated restore rehearsal (separate approval)
- Use **new** isolated `postgres:17` container/volume for plain SQL validation, `--network none`, no published ports, read-only archive mount and protected temporary data; do **not** touch `raxi-pg17-validation`, OpenGym, hosted staging or production.
- Verify schema/tables, sample synthetic data, migration provenance, policies and role/ACL expectations, matching object manifest and cryptographic hashes. Supabase Auth/Storage service behavior requires a different compatible environment; bare PostgreSQL cannot prove it.
- Record measured durations and loss assumptions to evaluate the **user-approved** RPO/RTO, not invented thresholds. Log cleanup of only the uniquely created fixture.
- If recovery prerequisites cannot be satisfied on the current Free tier, keep `NO_GO`; propose alternatives with exact cost and distinct approval instead of pretending a backup exists.

### Gate R4 — future migration authorization (not part of PR #38)
- Review exact **five-file** package `supabase/review-packages/b2-20261027213431/` with exact SHA/order and excluded `20261020234358_raxi_hq_campaign_strategy_pending_review.sql` migration.
- Explicit approval must name staging ref, file hashes, executor/version, transaction and lock behavior, verification/stop conditions, recovery owner and verified recovery coverage.
- Do **not** flip flags merely because this document or PR merges. No ad hoc Auth `GRANT`, no generic `supabase db push`.
- After approved application: catalog/RLS inspection, separately approved user accounts and two-workspace Auth tests, separately approved single simulated Director; never automatic Investigator/Creative/Publisher or external provider operations.

## 6. Invariants, acceptance and future Raxi HQ UI

- **Overall state must remain `NO_GO_HOSTED_MIGRATION`.** `PUBLIC_ONLY_VERIFIED` is a narrowly scoped *asset* observation, not project recoverability.
- Static tests must reject staging/project identity changes, flags enabled, fake backup-complete claims, altered archive fingerprint, forged offsite evidence or invented RPO/RTO.
- Codex independent review on exact commit; user-local offline PASS and `git diff --check`; user approval required to merge. Passing tests never authorizes backup/export/restore or hosted operations.
- Existing canonical runtime, Supabase Auth contracts, Pixi `OfficeScene`, `HQStore`, office agent states and `AGENTS.md` remain unchanged. The eventual agent inspector and `Te toca` must reflect `REAL/MOCK/DISCONNECTED` from trusted sources, not an offline backup matrix.

**Current decision: STOP for hosted write/B2/production; proceed only with planning and explicitly approved next checks.**
