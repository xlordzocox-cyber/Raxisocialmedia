# Raxi HQ — PR #37: hosted staging Auth catalog evidence and post-install safety gates

**READ-ONLY EVIDENCE / DESIGN ONLY. NO HOSTED WRITES, MIGRATION, B2, USER CREATION, PROVIDERS OR DEPLOYMENT AUTHORIZED.**

## Canonical target and provenance

- Repo: `xlordzocox-cyber/Raxisocialmedia`. PR #36 offline staging-readiness contract merged into `main` as `8dd01e4328dc471329161b83319b127423a1da1d`.
- Supabase **staging ONLY**: `zvhxjindgyvtasstfjut` (`raxi-hq-staging`), org `qpjzdqkvjzgqwvismeku`, region `us-east-2`, PostgreSQL `17.11.0.003`. Production `jrkefsylpfriiqefcmzq` is strictly excluded.
- Source: **read-only Supabase connector queries executed 2026-10-29 after independent `get_project` identity check**. All SQL reads only PostgreSQL catalogs/privilege metadata via the existing `supabase/tests/staging-b2-preflight.readonly.sql` and a five-column `VALUES + has_{schema,column,table}_privilege` query. No `auth.users`/`auth.sessions` **rows**, credentials, JWTs, refresh tokens or user data were accessed; no SQL writes, GRANTs, migrations, B2, providers, external deployments or user creation occurred.

## Verified point-in-time results

| Check | Observed value | Scope |
| --- | --- | --- |
| `get_project` | `ACTIVE_HEALTHY`, PostgreSQL 17.11, staging target matches exact org/region/ref | Metadata only |
| `list_tables(public)` | `[]` | No installed public Raxi tables |
| `list_migrations` | `[]` | No recorded applied migrations |
| `get_advisors(security)` | `lints=[]` | **Not** evidence that RLS/Auth is secure |
| Existing reviewed 13-check catalog preflight | **11 PASS / 2 BLOCK** | Catalog and effective privileges, not authenticated behavior |
| `auth` schema `USAGE` for `service_role` | **PASS** | SQL privilege metadata |
| Five required Auth column `SELECT` permissions | **0 PASS / 5 BLOCK** | Current preinstall delta, not provider incompatibility |
| `auth.sessions` / `auth.users` table-level `SELECT` | **BLOCK** for both tables | Separate from individual column checks |
| Raxi hosted RLS/workspace isolation | **NOT TESTED / NO RAXI TABLES INSTALLED** | No test-user or JWT flows |

The prior PR #25 snapshot (2026-10-27) also recorded 11 PASS / 2 BLOCK. This audit **reconfirms** the pattern, but does not make any claim about future changes or an operationally ready hosted runtime.

### Five exact blocked column privileges

| Relation | Column | Schema `USAGE` | Column `SELECT` | Table `SELECT` |
| --- | --- | --- | --- | --- |
| `auth.sessions` | `id` | PASS | **BLOCK** | BLOCK |
| `auth.sessions` | `user_id` | PASS | **BLOCK** | BLOCK |
| `auth.sessions` | `not_after` | PASS | **BLOCK** | BLOCK |
| `auth.users` | `id` | PASS | **BLOCK** | BLOCK |
| `auth.users` | `is_anonymous` | PASS | **BLOCK** | BLOCK |

The reviewed `supabase/proposals/supervised_host_stage_b.sql` already contains **proposed** exact-column grants:

```sql
-- REFERENCE ONLY. DO NOT EXECUTE ON HOSTED STAGING.
grant usage on schema auth to service_role;
grant select(id,user_id,not_after) on auth.sessions to service_role;
grant select(id,is_anonymous) on auth.users to service_role;
```

Those statements remain part of the **review-only** Stage B proposal and **must not** be executed as ad hoc remediation. This PR does not modify SQL artifacts or grant permissions. A successful later authorized migration must still verify *effective* permissions, not assume source text equals deployment.

## Reusable architecture, no parallel authorization or runtime

Use the existing `server/agent-runtime/supabaseSupervisedAuth.ts` and `supabaseSupervisedRepository.ts` contracts. Supabase's official session model binds the `session_id` JWT claim to `auth.sessions`; token validity alone does not prove an active/nonrevoked session or workspace ownership. Never use editable `user_metadata` for authorization or expose `service_role` to the browser.

Future installation MUST be checked against RLS `USING` AND `WITH CHECK`, role grants, SECURITY DEFINER/PUBLIC EXECUTE, `security_invoker`, ownership, search_path, anonymous vs authenticated identities, and negative cross-workspace A/B access. Do not run hosted Auth behavioral tests or create synthetic identities without separate user-scoped permission.

For the Pixi/React Office Experience, only verified canonical runtime events may produce `REAL` activity. This staging catalog inventory is configuration evidence, not evidence of an agent working; preserve `MOCK` and `UNKNOWN/DISCONNECTED` classifications.

## Blocking recovery and migration conditions

PR #31 documented an **empty `public` schema only**: 1,679-byte dump, SHA-256 and successful isolated local PG17 restore. It does not cover managed Auth/Storage state, storage object bytes, roles/ACLs or full-project rollback. Therefore **no hosted migration authorization can be inferred**.

Before requesting a hosted write:
1. Review the exact five-file package in `supabase/review-packages/b2-20261027213431`, with immutable order/hashes and the campaign migration explicitly excluded. No generic `supabase db push`.
2. Establish reviewed scope and recoverability for the relevant schema/data, Auth, Storage metadata/object bytes, permissions, RPO/RTO and an independently authorized restore rehearsal. A public-only restore is insufficient.
3. Obtain explicit authorization with staging ref, exact SQL file hashes, execution identity, stop conditions, evidence and restoration strategy. A reviewed PR is **not** that authorization.
4. **After** authorized installation only: rerun exact Auth permissions, catalog inventory and post-install RLS audit; require a separate approval to create test identities for two-workspace positive/negative Auth/session tests.
5. **After** those gates only: separately authorize one simulated supervised Director run; no autonomous downstream agents, providers, publications or spending.

## Acceptance of this documentation PR

- Confirm only this evidence document was added, no changes to `AGENTS.md`, manifest, `supabase/migrations`, SQL proposals, runtime or Pixi.
- Codex review on exact head; no unresolved P1/P2 issues.
- Merge only after explicit user authorization.
- **Final GO/NO-GO now: NO-GO** for applying hosted SQL, running B2, creating users or deploying. This PR records a verified preinstall permission gap; it is **not** an installation plan, rollback solution or provider capability verification.

Official references: https://supabase.com/docs/guides/auth/sessions and https://supabase.com/docs/guides/database/postgres/row-level-security .
