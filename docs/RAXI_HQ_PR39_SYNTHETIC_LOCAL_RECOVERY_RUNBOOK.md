# Raxi HQ — PR #39: dual PostgreSQL 17 synthetic Raxi recovery rehearsal

**DRAFT / PREPARATION ONLY. NO CONTAINER EXECUTION AUTHORIZED BY THIS PR. NO HOSTED SQL, AUTH ROW EXPORT, REAL STORAGE OBJECTS, B2, DEPLOYMENT OR SPENDING.**

## Why PR #39 matters

PR #31 validated restoration of the **empty** staging \`public\` schema. PR #35 validated the supervised Director locally. PR #38 (merged into \`main\` at \`03e0455fca01a2a9b178a75ec846b9e05850af35\`) records 12 gaps and maintains \`NO_GO_HOSTED_MIGRATION\`.

PR #39 prepares a **stronger strictly local test**: build the already reviewed Raxi schema using the pinned 7 SQL files; insert only synthetic users/workspaces/ideas; perform a PostgreSQL custom-format \`public\` schema + data dump; restore the archive to a **different newly allocated isolated PG17 container**; compare records plus the existing canonical `inspectRaxiSchema` fingerprints (tables, functions, constraints, indexes, triggers, RLS policy definitions and effective grants); and test two synthetic users cannot read each other's workspace. This is a *new rehearsal*, **not** a backup of hosted staging, managed Auth, Storage object bytes, or all infrastructure.

## Exact components and boundaries

| Component | Real source or synthetic? | What can be demonstrated |
| --- | --- | --- |
| 7 source SQL files | Checked-in proposals/migrations, SHA256(LF) pinned by unmodified staging manifest | Local Raxi schema reconstructable from the reviewed files |
| Auth and Storage bootstrap | **Synthetic fixture** from \`supabase/tests/pg17-bootstrap.sql\` (PR35 hash pinned) | PG functions and roles needed to test Raxi schema; **not** Supabase services |
| Workspace A/B and idea A/B rows | **Synthetic, hard-coded UUIDs** | Data, FK and per-workspace RLS checks across source and restore |
| \`pg_dump -Fc --schema=public --no-owner\` | **Local fixture only** | Data and table-level ACL/policies copied to an in-memory archive; excludes managed schemas |
| \`pg_restore --exit-on-error --no-owner\` | **Second disposable PG17 container** | A different database restores Raxi public objects; source and restored fingerprints match |
| Login / real JWT / logout / sessions | **Never tested** | No claims about active/expired real Auth sessions or B2 |
| Storage bucket object bytes | **Never backed up** | No claim about assets, Storage API or object-byte recovery |
| Source/target production Supabase | **No connection** | Production and staging remain untouched |

Only the test container's \`public\` schema may be dropped inside its private ephemeral PostgreSQL database. No Docker volume mounts, no published ports, no Docker network connection, no automatic image pulls, no local host backup file, no external service credentials. Unique disposable container names and IDs must be checked before cleanup. **Never target the pre-existing \`raxi-pg17-validation\` or OpenGym containers.**

## Execution modes (separate human gates)

### Gate P39-A — Offline preflight

From repository root, user can run after Codex review:

\`\`\`powershell
node scripts/pr39-local-synthetic-recovery.mjs
Write-Host "PR39 preflight: $LASTEXITCODE"
node scripts/test-pr39-local-recovery.mjs
Write-Host "PR39 negative tests: $LASTEXITCODE"
git diff --check origin/main...HEAD
Write-Host "PR39 diff: $LASTEXITCODE"
\`\`\`

The default runner must **not** invoke Docker. It verifies the canonical pre-existing manifest, SQL source digests, bootstrap digest, PR38 NO-GO evidence and all disabled hosted authorizations. Running these is **not** restoring anything.

### Gate P39-B — Future local native rehearsal (NOT AUTHORIZED BY MERGING/CREATING PR39)

Only **after** the user's separate approval to run the local dual-container fixture, the operator could run:

\`\`\`powershell
# FUTURE ONLY. DO NOT RUN UNTIL SPECIFICALLY AUTHORIZED.
node scripts/pr39-local-synthetic-recovery.mjs --run-local
Write-Host "PR39 local restore: $LASTEXITCODE"
\`\`\`

This opt-in creates two new \`postgres:17\` Docker containers, image already cached (\`--pull=never\`), \`--network none\`, one fresh \`tmpfs\` per container, no bind mounts/ports. The archive exists solely as a Node.js buffer between source and destination. The only PostgreSQL credentials are ephemeral, container-internal fixtures. It tests the actual repository's public SQL schema; the target \`auth.users\` stub is independently populated with the SAME SYNTHETIC IDs solely to satisfy FK references. This **does not restore the Auth service**. All created containers are cleaned up by exact ID/name and failure returns nonzero; if safe cleanup cannot be proven, stop and investigate manually rather than touching unknown containers.

### Gate P39-C — Future hosted recovery decision (separate approvals)

Even a successful local dual-instance restore would only permit the statement **\`SYNTHETIC_LOCAL_PG17_PUBLIC_RESTORED\`**. PR38 \`PUBLIC_ONLY_VERIFIED\` remains the only evidence for the *hosted-origin* \`public\` dump and the project remains **\`NO_GO_HOSTED_MIGRATION\`**.

Before any actual hosted export or write, still required:

1. Confirm backup scope and exact Auth/Storage roles and object-byte recovery method, encrypted offsite storage, TLS \`verify-full\` certificate, and retention; decide RPO/RTO and owner with the user.
2. Review an independently scoped export/restore procedure and suitable target. Bare PG17 cannot stand in for hosted Supabase Auth/Storage.
3. Obtain separate explicit approval for **each**: reading/exporting hosted private data, any full-stack recovery environment and related cost, uploading or restoring data, applying a five-file migration, creating test accounts, enabling a simulated Director.
4. Auth \`service_role\` five-column grants remain 0/5 from PR37; Stage B's reviewed proposed grants must not be applied ad hoc. No \`supabase db push\` or unrelated campaign migration.

## Acceptance criteria for this PR

- [ ] Git diff contains **only** new runbook, local opt-in runner, and offline tests.
- [ ] Exact HEAD reviewed by Codex; fix P1/P2 and verify rerun.
- [ ] Local **preflight** passes without Docker/network/SQL; invalid flags and tampered manifest/NO-GO rejected.
- [ ] Local negative tests pass; \`git diff --check\` passes; report only observed exit codes.
- [ ] **No** \`--run-local\` execution before new explicit approval.
- [ ] User separately authorizes merge after review; merge does not authorize hosted SQL or RLS/B2 activation.

**Security classification: PREPARATION_ONLY. Overall hosted readiness: NO_GO_HOSTED_MIGRATION.**

Official technical context is in \`docs/RAXI_HQ_PR38_STAGING_RECOVERY_STRATEGY.md\` and \`docs/RAXI_HQ_STAGING_BACKUP_RECOVERY_PLAN.md\`.
