# Raxi HQ — staging read-only inventory and recovery gap register

**Observation date:** 2026-10-27. **Status:** observed metadata only. No hosted SQL executed, no schema changes, B2, user creation or provider operations.

## Live observation via Supabase project metadata

| Check | Observed result |
| --- | --- |
| Project ID/ref | `zvhxjindgyvtasstfjut` |
| Name | `raxi-hq-staging` |
| Organization ID | `qpjzdqkvjzgqwvismeku` |
| Region | `us-east-2` |
| Status | `ACTIVE_HEALTHY` |
| Database PG version | `17.11.0.003` |
| PostgreSQL engine | `17` |
| Applied migrations | Empty array (`[]`) |
| Public tables | Empty array (`[]`) |
| Security adviser notices | Empty array (`[]`) |

Read-only evidence originates from Supabase connector actions `get_project`, `list_migrations`, `list_tables(schemas=['public'])` and `get_advisors(type='security')`. They are **point-in-time metadata**. An empty security-advisor result does NOT validate Auth, RLS, tenants, backing storage, session privilege grants, recovery readiness, or absence of risks.

### Baseline comparison

Prior PR #25 preflight was 11 PASS / 2 BLOCK for selective `service_role` access to `auth.sessions` and `auth.users`. Those privileges were **not rechecked in this inventory**: status remains **unverified now**, not presumed fixed. No migration or public Raxi table was present previously; today's metadata matches that prior observed baseline.

## Recovery capability — unresolved blocking evidence

The installed Supabase connector does not expose a database backup inventory, plan/retention, point-in-time recovery controls, downloadable verified database backup, restore-job evidence, nor evidence that Auth/Storage are recoverable together. **Do not infer backups from project health or provider features.**

Before granting hosted SQL write authorization:
1. Collect a **read-only, nonsecret** snapshot of the actual staging backup/PITR status, coverage/retention and most recent completed backup from the project dashboard or an approved backup-specific tool. Avoid copying credentials or sensitive row contents into GitHub.
2. Identify separately how database schema and migration history, Auth users and sessions, Storage metadata, and object bytes are recovered. Document RPO/RTO, restore owner and failure rollback/forward-fix strategy.
3. Test restoration in a separately authorized isolated environment, if such test incurs resources or new project creation obtain cost-specific approval first. **No destructive recovery test on staging**.
4. Pin an exact transaction/lock-aware five-file application order and verify hashes and package scope. Reject all unlisted SQL including campaign migration; no generic `db push`.
5. Require separate human sign-off specifying project ref, SQL hashes, safe execution method, recovery evidence and stop conditions.

## Remaining read-only security validation

- Reconfirm Auth/Storage objects exist with correct types; check required `service_role` column grants individually (five column checks), not table-wide privilege as proxy.
- Inventory RLS policies/views/function EXECUTE only when Raxi objects exist; no hosted Auth behavioral conclusion before installation.
- Verify that no unexpected migration history exists immediately before any future proposal to apply.
- Isolated test identities, session/JWT, workspace A↔B tests and simulated Director B2 are separate approvals.

## Authorization boundaries

- Document/inventory only. **No hosted SQL executed** in this pass, including SELECT. The only hosted calls here were read-only connector metadata actions.
- No SQL DDL/DML, no GRANT, no `supabase db push`, no schema migration, no Auth accounts, no B2, no deployment, no provider call, no additional spend.
- Production `jrkefsylpfriiqefcmzq` is excluded.
- `supabase/staging/raxi-hq-staging.manifest.json` remains unchanged, including `executionReady:false` and all authorizations false.

## GO / NO-GO

**NO-GO for hosted migration.** The empty database baseline is confirmed; the actual backup/recovery capability, required Auth privilege preflight refresh and migration rollback plan are not established. A clean metadata inventory is necessary but not sufficient.

Next reviewable deliverable: narrow, read-only Auth/column-grant catalog audit + backup dashboard evidence. Any write/test account/future migration needs its own scoped approval.
