# Raxi HQ — staging backup and recovery evidence / plan

**DRAFT / DESIGN ONLY. NO EXECUTION AUTHORIZED.** This document records the user's observed local backup and defines a safe recovery verification path. It does NOT grant SQL writes, hosted restores, creating users, B2, providers, deployment or additional spending.

## Verified user-observed baseline (2026-10-27 / UTC archive 2026-10-28)

Target staging project `zvhxjindgyvtasstfjut` (`raxi-hq-staging`), PostgreSQL 17.11, Supabase Free. Production project `jrkefsylpfriiqefcmzq` is not involved.

Supabase Dashboard screenshot states Free plan does **not include project backups**; no automatic project backup is available to rely upon. Session Pooler `aws-0-us-east-2.pooler.supabase.com:5432`, database `postgres`, pooler user `postgres.zvhxjindgyvtasstfjut` was confirmed; password was reset by the user, then `psql` read-only query succeeded against server version 17.11. **Never store password, connection secret or full URI in GitHub.**

User ran `pg_dump` from Docker `postgres:17` (pg_dump 17.11), using `--schema=public --format=custom --no-owner --no-acl` into a local directory outside repository. File name only, without user profile path:

- `raxi-staging-public-20261027-180405.dump`
- Archive UTC created: `2026-10-28 00:04:06 UTC`.
- Size: **1,679 bytes**.
- SHA-256: `214d57ca84bbc3341f53663eb6a88daa52838c451a0858c0a913337c094cd7fd` (**64 hexadecimal characters**, independently re-read from the unchanged existing local file by the user with `Get-FileHash`; user output reports `Caracteres: 64` and `PASS`).
- `pg_restore --list` returned success and listed SCHEMA `public` and COMMENT for it, no Raxi tables. Archive format CUSTOM / gzip, dumped from PG 17.11 with pg_dump 17.11.
- This proves the archive is parseable. **Additionally, the user completed a local disposable PostgreSQL 17 restore rehearsal successfully** (see evidence below); this is **not** a comprehensive Supabase backup or restoration. The hash was checked locally; no offsite copy, signature or full-system recovery is evidenced.
- Existing dump was created using `PGSSLMODE=require`, **encryption without strict server certificate hostname/CA verification**. Do not describe that transfer as server-identity validated.
- Data in `auth`, `storage`, Auth service behavior, Storage object bytes, cluster roles/ownership/ACL and any other schemas **are not included** in this public-only archive.

## Verified isolated local restore rehearsal (user-reported terminal output)

After the public-only archive was produced, the user explicitly ran a controlled restoration into a **new disposable local** `postgres:17` container. This is historical evidence from the user's PowerShell output, **not** an independent hosted inspection or a newly performed test.

- Source file: the unchanged `raxi-staging-public-20261027-180405.dump` (1,679 bytes). The script compared the independently recomputed SHA-256 to the pinned, 64-hex-character expected hash and emitted `PASS: Integridad SHA256`.
- Test container used Docker `--network none`, no published ports, a temporary `tmpfs` data directory and a read-only bind mount for the archive. The existing local validation container was not targeted.
- Within this new disposable database only, the script dropped its default `public` schema and used `pg_restore --exit-on-error --no-owner --no-acl` to import the custom-format archive.
- The immediate post-restore query checked whether `public` existed and counted ordinary/partitioned tables in that schema. The result was **`t|0`**, matching the known empty-`public` dump.
- Terminal output included `PASS: RESTAURACION LOCAL VERIFICADA`, followed by the removal of the uniquely named disposable container. This script did not connect to or modify the hosted staging or production projects.

**Classification: `PUBLIC_ONLY_VERIFIED`.** The empty `public` schema's parseability, SHA-256 match and successful local restore are verified by the user's terminal output. This does **not** establish restoration of managed Supabase `auth`/`storage` services, role grants/passwords, actual object bytes, sitewide data, or a production-grade recovery procedure. Do **not** label `LOGICAL_SET_VERIFIED`, `RECOVERY_TESTED` (full project) or `BACKUP_COMPLETE`.

## Remaining work before any hosted migration

1. **Secret-safe inventory, no credentials in outputs:** identify supported Supabase Free backup approaches and their documented exclusions for CLI `db dump` versus raw `pg_dump`; verify against current official Supabase documentation and installed CLI `2.122.0 --help`. Determine permissible scopes/permissions and exact version of clients. Do not assume `db dump` includes managed schemas or object bytes.
2. **TLS hardening:** use a trusted CA chain and `sslmode=verify-full` / validated hostname consistent with the actual Supabase pooler certificate. Obtain the CA from an authoritative trusted source; no `sslmode=disable` or bypass. Test with read-only query before a subsequent export. Document OS/container trust store and exact verification outcome, never store secrets.
3. **Backup plan, separately approved:** choose which logical exports cover role definitions, user schemas, schema/data and minimal Auth/Storage requirements. Account for permissions, provider-managed secrets and object-byte limits; export only approved scope and use encrypted local storage. No privileged data extraction or new backups of private Auth rows without explicit scoped user approval.
4. **Further restore rehearsal (future scope, separate authorization):** the public-only archive was **already restored and validated locally** as documented above. Plan any additional *fuller logical set* restore in a newly isolated disposable **local PostgreSQL 17** container with no exposed ports and an explicit cleanup policy; this still does not prove hosted Supabase Auth/Storage services work. Do **not** touch the existing `raxi-pg17-validation` PostgreSQL fixture or OpenGym containers.
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
