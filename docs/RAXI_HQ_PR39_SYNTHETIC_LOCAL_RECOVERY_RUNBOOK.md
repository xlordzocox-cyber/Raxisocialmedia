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

## 2026-10-29 first authorized native run: FAIL, safe cleanup PASS

The user executed `node scripts/pr39-local-synthetic-recovery.mjs --run-local` on Windows, initially at reviewed commit `d7ea9f3e8bede148912fd1d17c6cc54477b53661`:

- Git clean, Docker server 29.7.2, cached `postgres:17` image. All offline gates had passed before the native run.
- `PASS: PR39_PINNED_OFFLINE_PREFLIGHT` printed. Source fixture and archive creation advanced to the destination; the synthetic 2-workspace/2-idea data comparison did **not** raise an error.
- **`Error: PR39 STOP: source and restored canonical Raxi catalog differ (RLS, ACL, functions or objects)`**; `RESULTADO PR39: 1`. This is **not PASS**, even if row data compares successfully.
- The restored-database owner isolation assertions had **not yet run** when the catalog mismatch stopped the test.
- `CLEANUP PASS` for both disposable test containers, exact names `raxi-pr39-restore-b83fa6f7902c` and `raxi-pr39-src-0b41313870ee`. The user did not run hosted SQL or touch other containers.

**Disposition: NEEDS_REPRO_DIAGNOSTIC; HOSTED NO-GO UNCHANGED.** The initial error does not identify which object's policies, ACL, function definition, constraint or index differs. Do not silently normalize, ignore, waive or count that check as passed.

The follow-up adds `scripts/pr39-catalog-diagnostic.mjs` and collects the already local-only raw catalogue metadata returned by `inspectRaxiSchema`. If a canonical mismatch persists, it must print **only object names, changed field names and short SHA fingerprints**, then return nonzero and clean up both disposable containers. A separate offline unit test injects synthetic RLS policy, ACL, function and missing-table changes to confirm diagnostics detect them. No raw Auth rows, real credentials, SQL definition bodies or file exports are printed. **This diagnostic is not a fix for the underlying mismatch**; inspect its results and determine whether the restore requires correction. New Codex review and local revalidation are required before the next native run or merge.

## 2026-10-29 second authorized native run — exact table-field discrepancy

User local PowerShell revalidated commit `c6967f3a72bd0a7d72a1d1ee62f8a378882ec0f4`: Node syntax passed, **19 offline negative cases PASS**, no-flag preflight PASS. Then the separately authorized `--run-local` rehearsal printed:

```text
PR39 DIAGNOSTIC: 1 catalog field differences
PR39 DIAGNOSTIC: tables/raxi_workspaces: constraints [before 67ea0699577d, restored a787867114ba]
Error: PR39 STOP: source and restored canonical Raxi catalog differ (RLS, ACL, functions or objects)
RESULTADO PR39: 1
```

Two new disposable containers were cleaned up with `CLEANUP PASS`: `raxi-pr39-restore-39509c35d5a0` and `raxi-pr39-src-93c5b2585c4d`. **No merge and no hosted changes.** This observed result narrows the discrepancy to **the `constraints` field on `public.raxi_workspaces`**. It does **not** yet identify which named constraint or expression differs; do not attribute a cause or weaken the comparison without evidence.

The next revision adds exact **named constraint comparison** (missing, unexpected, changed definition, and order-only mismatch), printing short digests and names but **no raw constraint SQL definitions**. It must keep the original fail-closed native catalog comparison and cleanup; it cannot turn the mismatch into PASS. Four additional offline negative cases cover per-constraint differences (**23 negative tests expected on the new head, not yet user-verified**). Independent Codex review and new local tests are required before using the updated `--run-local` version.

## Acceptance criteria for this PR

### Investigación del tercer ensayo (2026-10-29)

En el commit `12cc2becbc8a2e9b7c3e220e46e9e650c91add9e`, la evidencia del usuario
localizó la discrepancia en `raxi_workspaces_slug_check`, origen `484099262f84` /
restaurado `1efa6e7fdbc4`; el ensayo terminó FAIL (1) y ambos contenedores se
limpiaron. La investigación offline reproduce esos fingerprints como expansión
BETWEEN con AND anidado frente a AND plano. El gate sigue rechazándolos.

Ver [investigación, límites y corrección propuesta](RAXI_HQ_PR39_CONSTRAINT_DIVERGENCE.md).
El nuevo diagnóstico añade contexto resuelto únicamente en un futuro ensayo
autorizado; no valida semántica ni habilita PASS. **No ejecutar `--run-local`
sin nueva autorización específica.** La suite offline en `59805f6` contiene 79 negativas;
no debe confundirse con un nuevo ensayo PostgreSQL.

### Correctivo P1 del diagnóstico tras el cuarto ensayo

El cuarto ensayo del usuario en `59805f6` conservó FAIL y limpió ambos contenedores;
el SELECT diagnóstico falló al tratar lc_collate como GUC. El correctivo lee
datcollate/datctype desde pg_catalog.pg_database de current_database() y añade
proveedor, locale, reglas ICU y versión registrada, con consumidores explícitos.
La suite offline actual contiene **103 negativas PASS**. Ver el apartado P1 del
[informe](RAXI_HQ_PR39_CONSTRAINT_DIVERGENCE.md) para contrato, fuentes PG17 y riesgos.
No se ejecutó otra prueba nativa y no se concede equivalencia al CHECK. **La
próxima ejecución --run-local sigue requiriendo nueva autorización humana.**

- [ ] Git diff contains **only** runbook, local opt-in runner, catalog/constraint diagnostic helpers and offline tests.
- [ ] Exact HEAD reviewed by Codex; fix P1/P2 and verify rerun.
- [ ] Local **preflight** passes without Docker/network/SQL; invalid flags and tampered manifest/NO-GO rejected.
- [ ] Local negative tests pass; \`git diff --check\` passes; report only observed exit codes.
- [ ] **No** \`--run-local\` execution before new explicit approval.
- [ ] User separately authorizes merge after review; merge does not authorize hosted SQL or RLS/B2 activation.

**Security classification: PREPARATION_ONLY. Overall hosted readiness: NO_GO_HOSTED_MIGRATION.**

Official technical context is in \`docs/RAXI_HQ_PR38_STAGING_RECOVERY_STRATEGY.md\` and \`docs/RAXI_HQ_STAGING_BACKUP_RECOVERY_PLAN.md\`.
