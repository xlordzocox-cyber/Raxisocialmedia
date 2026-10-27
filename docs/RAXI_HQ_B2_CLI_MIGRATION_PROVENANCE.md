# Raxi HQ — Supabase CLI migration artifact provenance (offline only)

**Review candidate, not an approved deployment migration.** Do not copy into live `supabase/migrations/`, execute `db push`, apply SQL to staging/production, or enable B2.

## User-observed local evidence — 2026-10-27

The user ran the independently downloaded and SHA-256-verified official Windows AMD64 Supabase CLI **2.122.0**, using the isolated directory `C:\Users\joslu\tools\raxi-b2-offline`. This is a user-provided terminal transcript, **not** a GitHub CI or assistant-executed CLI run.

- CLI command: `supabase --workdir <isolated-local-dir> migration new supervised_runtime_b2`.
- CLI-created filename: **`20261027213431_supervised_runtime_b2.sql`**.
- Actual CLI-generated migration version: **`20261027213431`**.
- Initial generated SQL file size: **0 bytes**.
- Candidate source: `supabase/candidates/supervised_runtime_b2.candidate.sql`; after `verify-staging-preparation.mjs` and `consolidate-runtime-candidate.mjs --check` both returned successfully, the user copied the candidate byte-for-byte into the CLI-named file.
- Final file size: **51,245 bytes**.
- SHA-256 of source and derived file: **`bc4ce83cfe5e64fc116dd5eb408254f1b0363b868d1a71b5378053435c3b0c15`** (terminal compared actual hashes). The preexisting manifest pins the same SHA-256 for the canonical LF candidate.
- The isolated CLI workdir also contains `supabase/.temp/cli-latest`; exclude this CLI auxiliary file.
- CLI binary ZIP SHA-256 (from user transcript matched official release checksum): `60031fd5bf050fc12a0c6aef68997600d143870f944bf13109c7765dca329af8`. This is **the archive digest**, not an independently measured digest of `supabase.exe`.
- User's local source checkout HEAD: `676c30537e7a41fa4090d6a3fa22e2c662fd8674`, with `git status --short` empty. Note that this is the original PR #23 head, **not** current main.
- None of these outputs indicates SQL execution, remote connectivity, creation of accounts, or provider calls.

## Seven authoritative SQL sources

Preserve exactly the seven `applicationPlan.steps` of `supabase/staging/raxi-hq-staging.manifest.json`: four existing base migrations followed by `agent_runtime.sql`, `supervised_host_stage_a.sql`, `supervised_host_stage_b.sql` consolidated into **one** migration. Verify canonical LF hashes using repo scripts. The independent campaign migration `20261020234358_raxi_hq_campaign_strategy_pending_review.sql` must **never** be included via a generic `db push`.

The generated filename is evidence of the real CLI version-generation event; copying the candidate did **not** cause Supabase CLI to validate its SQL contents. PR #24 independently reports validation on local PostgreSQL 17 with synthetic Auth/Storage. This is not hosted Supabase Auth evidence.

## Review and acceptance gates

1. Reproduce/check the seven original file hashes from current `main` with the existing offline verifiers. Check the reconstructed candidate against the LF SHA-256 above.
2. Reconcile whether the 51,245-byte file is byte-identical (user evidence says yes). Obtain and separately record executable SHA-256 and CLI version only if independently measured. Do not claim a binary executable hash from the ZIP checksum.
3. Keep this provenance outside the live migrations directory. Do not alter the pinned `manifestSha256` semantics, existing checks, or `candidate.cliMigrationVersion:null` / `consolidatedRuntimeVersion:null` until a **separate reviewed mapping change** is designed with version and hash checks. In particular keep `executionReady:false`, `candidate.executionAuthorized:false`, and **all** `authorizations` false.
4. Future build step may produce a *standalone, isolated* five-migration review package (four bases + single runtime consolidated) with a real CLI-derived filename. Require separate explicit approval before creating a deployable package or touching staging.
5. PR #25 preflight found 11 PASS / 2 BLOCK *before* hosted migration for the five required Auth column privileges. Do not fix by ad-hoc hosted GRANT. Stage B contains intended column-level GRANTs; verify only after an independently approved migration.
6. Re-check hosted project ref and baseline before any later SQL execution; production project ref is `jrkefsylpfriiqefcmzq` and **strictly excluded**. Staging ref is `zvhxjindgyvtasstfjut`.
7. Future hosted application, Auth accounts, B2, deployment, paid providers and merge require independent human authorization. This report grants none of them.

**Current state:** CLI-generated filename observed and candidate copied/hashed offline; no CLI execution through the GitHub connector; no SQL remote, no deploy, no hosted users, no B2.
