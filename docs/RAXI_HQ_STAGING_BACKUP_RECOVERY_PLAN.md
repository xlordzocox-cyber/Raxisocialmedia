# Raxi HQ — staging backup and recovery evidence / plan

**DRAFT / DESIGN ONLY. NO EXECUTION AUTHORIZED.** This document records the user's observed local backup and defines a safe recovery verification path. It does NOT grant SQL writes, hosted restores, creating users, B2, providers, deployment or additional spending.

## Verified user-observed baseline (2026-10-27 / UTC archive 2026-10-28)

Target staging project `zvhxjindgyvtasstfjut` (`raxi-hq-staging`), PostgreSQL 17.11, Supabase Free. Production project `jrkefsylpfriiqefcmzq` is not involved.

Supabase Dashboard screenshot states Free plan does **not include project backups**; no automatic project backup is available to rely upon. Session Pooler `aws-0-us-east-2.pooler.supabase.com:5432`, database `postgres`, pooler user `postgres.zvhxjindgyvtasstfjut` was confirmed; password was reset by the user, then `psql` read-only query succeeded against server version 17.11. **Never store password, connection secret or full URI in GitHub.**

User ran `pg_dump` from Docker `postgres:17` (pg_dump 17.11), using `--schema=public --format=custom --no-owner --no-acl` into a local directory outside repository. File name only, without user profile path:

- `raxi-staging-public-20261027-180405.dump`
- Archive UTC created: `2026-10-28 00:04:06 UTC`.
- Size: **1,679 bytes**.
- SHA-256: **PENDING EXACT RECHECK** — the value originally transcribed in this PR contained 63 hex characters; do not use it for validation. Obtain a fresh exact 64-character hash of the **existing local file** using `Get-FileHash` before recording the value. Do not regenerate or restore the archive.
- `pg_restore --list` returned success and listed SCHEMA `public` and COMMENT for it, no Raxi tables. Archive format CUSTOM / gzip, dumped from PG 17.11 with pg_dump 17.11.
- This proves archive is parseable **not** that restore succeeded or that it is a comprehensive Supabase backup. The hash was checked locally but no offsite copy, separate restore verification or signature is evidenced.
- Existing dump was created using `PGSSLMODE=require`, **encryption without strict server certificate hostname/CA verification**. Do not describe that transfer as server-identity validated.
- Data in `auth`, `storage`, Auth service behavior, Storage object bytes, cluster roles/ownership/ACL and any other schemas **are not included** in this public-only archive.

## Remaining work before any hosted migration

1. **Secret-safe inventory, no credentials in outputs:** identify supported Supabase Free backup approaches and their documented exclusions for CLI `db dump` versus raw `pg_dump`; verify against current official Supabase documentation and installed CLI `2.122.0 --help`. Determine permissible scopes/permissions and exact version of clients. Do not assume `db dump` includes managed schemas or object bytes.
2. **TLS hardening:** use a trusted CA chain and `sslmode=verify-full` / validated hostname consistent with the actual Supabase pooler certificate. Obtain the CA from an authoritative trusted source; no `sslmode=disable` or bypass. Test with read-only query before a subsequent export. Document OS/container trust store and exact verification outcome, never store secrets.
3. **Backup plan, separately approved:** choose which logical exports cover role definitions, user schemas, schema/data and minimal Auth/Storage requirements. Account for permissions, provider-managed secrets and object-byte limits; export only approved scope and use encrypted local storage. No privileged data extraction or new backups of private Auth rows without explicit scoped user approval.
4. **Restore rehearsal:** plan an isolated disposable **local PostgreSQL 17** test database/container with no exposed ports, safe naming, no connection to hosted staging, clear cleanup policy. Validate that the public-only archive restores if authorized and prove expected schema/comment presence. This does NOT prove managed Supabase Auth/Storage restore. Do **not** touch the existing `raxi-pg17-validation` PostgreSQL fixture or OpenGym containers.
5. **Integrity and report:** protect backup directory from public access, SHA-256 per file, encrypted storage/offsite plan, inventory of exclusions, recovery point objective/recovery time objective. Classify outcome as `PUBLIC_ONLY_VERIFIED`, `LOGICAL_SET_VERIFIED`, or `RECOVERY_TESTED` based strictly on evidence. No `BACKUP_COMPLETE` label without full scope and restoration evidence.
6. **Go/no-go:** require a separately reviewed, exactly-scoped hosted five-file migration plan, backup/restore evidence and explicit authorization before any SQL write. Refuse blanket `supabase db push` or unrelated campaign migration. The pending permissions on five Auth columns are **not** permission to apply ad hoc GRANT.

## Codex review checklist

- Verify exact archive metadata/hash is labeled as user-supplied evidence, not CI measurement.
- Verify backup scope statements and TLS caveat.
- Assess recovery test isolation; forbid contamination of local fixture/other containers.
- Ensure **no private path**, passwords, JWTs, API keys or connection strings.
- Recommend a **separate proposed PR** for local-only restore-test scripts after plan review; never implement or run restoration without new authorization.
- Keep `supabase/staging/raxi-hq-staging.manifest.json` unchanged, `executionReady:false` and all authorizations false.

**Current decision:** NO-GO for hosted SQL and B2. Review/merge of this documentation does not change any gate.
