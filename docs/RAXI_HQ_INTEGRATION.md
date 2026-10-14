# Raxi HQ Office v0.3 — Canonical Integration

## Repository and scope

Canonical remote: `https://github.com/xlordzocox-cyber/Raxisocialmedia.git`.

Integration branch: `feature/raxi-hq-office-v0.3`.

Verified main/base commit: `6d0988866b33d05a3ccc4604ae5a2ad5ffb95acf`.

The durable clone was verified clean before integration. The application belongs at `apps/raxi-hq/` relative to the repository root. As of commit `aa7771c8dc97331c665bf83e00add253d590a407`, the deliverable contains 41 application source/configuration/test/documentation files, this integration note and five evidence screenshots. Four screenshots were retained from the earlier visual passes; the fifth, `RAXI-HQ-EVIDENCE-V03-DURABLE-DEV`, was captured during durable-clone pre-commit validation. Copied source and evidence hashes matched their originals. The previous temporary checkout was retained without modification.

No dependency directories, build output, validation intermediates, environment files, Codex files, MCP proxies, private notes, credentials, local recordings or caches were transferred. Existing repository strategy, campaigns and approved image files were not modified. Commit `aa7771c` did modify `content/asset-library/ASSET_CATALOG.json` to register all five evidence screenshots, bringing the catalog from nine to 14 entries. The nine original entries remain intact; each new entry has `supermemory_document_id: null` and verified dimensions, file size and SHA-256.

## Run and validate

From `apps/raxi-hq/`:

```sh
npm ci
npm run build
npm run typecheck
npm test
node scripts/security-scan.mjs
npm run dev -- --host 127.0.0.1
```

On Windows with the trusted root CA in the system certificate store, use `NODE_USE_SYSTEM_CA=1` for npm without disabling TLS validation. No lint script is configured.

## Architecture and runtime boundaries

`mockAdapter → timed HQEvent → HQStore → pure reducer → HQState → React/Pixi → deterministic agent motion`.

The v0.3 pass adds isometric rooms, procedural furniture and chibi avatars, limb/status animation, event-driven handoffs, Y-based depth sorting, shadows, camera controls and React inspection. The v0.2 engine, reducer, domain contracts, adapters, pathfinding and movement were preserved.

The executable adapter loads cloned local mock data. Aria Studio, GitHub, Munder Difflin and Supermemory adapters are documentation-only stubs. They perform no external reads or writes from HQ. A verified MEMORY_ARCHIVED mock event only triggers a visual effect; it is not a real memory save. No credentials or networking are configured in the app.

The three previously accepted Supermemory documents belong to the historical v0.3 milestone. They were written outside HQ, through the host integration; they are not runtime functionality. No additional memories are written during this canonical integration.

## Selected visual evidence

Each screenshot is registered in `content/asset-library/ASSET_CATALOG.json` by canonical Asset ID and portable repository path. Entries include verified dimensions, byte size and SHA-256, with `supermemory_document_id: null`. They are technical review evidence, not campaign photography or proof of real external integration.

| Asset ID | Repo path | Review purpose |
| --- | --- | --- |
| `RAXI-HQ-EVIDENCE-V02-OFFICE` | `output/reports/raxi-hq-integration/evidence/v02-office.jpg` | Earlier technical map for comparison. |
| `RAXI-HQ-EVIDENCE-V03-DURABLE-DEV` | `output/reports/raxi-hq-integration/evidence/v03-durable-dev.jpg` | Fresh dev-server verification from the durable clone. |
| `RAXI-HQ-EVIDENCE-V03-FINAL` | `output/reports/raxi-hq-integration/evidence/v03-final.jpg` | Furnished office after the complete mock scenario. |
| `RAXI-HQ-EVIDENCE-V03-INSPECTION` | `output/reports/raxi-hq-integration/evidence/v03-inspection.jpg` | React inspection and mock handoff from avatar selection. |
| `RAXI-HQ-EVIDENCE-V03-OPENING` | `output/reports/raxi-hq-integration/evidence/v03-opening.jpg` | Furnished isometric office during the initial mock stages. |

Except for `RAXI-HQ-EVIDENCE-V03-DURABLE-DEV`, these are historical browser-review screenshots from the v0.2/v0.3 passes. Catalog visual approval applies only to screenshot readability and suitability as technical evidence; it does not approve campaign assets or change mock runtime states.

## Commit boundary

Only HQ, this integration note, the five evidence screenshots and their asset-catalog registrations belong to this change. Generated `node_modules/`, `dist/`, `.validation/` and TypeScript outputs remain ignored. Do not commit environment files or host integration data. Navigation is still zone-based BFS without collision avoidance. The app remains a local mock, committed and pushed on its feature branch, pending PR review before merge.

## Durable-clone validation — 2026-10-14

- `npm ci`: PASS; 134 packages installed and zero reported vulnerabilities. Dependencies were installed afresh, not copied.
- `npm run build`: PASS; Vite 7.3.7, 476 modules, no bundle warnings.
- `npm run typecheck`: PASS.
- `npm test`: 9 passed, zero failures.
- App security scanner: zero findings in 50 application/configuration/build text files.
- Deliverable inventory after `aa7771c`: 48 affected repository paths relative to the verified base, comprising 47 added files (41 HQ files, this integration note and five screenshots) and one modified existing asset catalog. The inventory contains 43 text files and five JPEGs. The pre-stage audit detected no secrets, local absolute paths or excluded candidates; public registry and repository URLs were distinguished from filesystem paths.
- Runtime source/configuration search: no networking calls, hosted memory tools, MCP proxies or external-write operations. Adapter-isolation regressions pass.
- `main` remains at the verified base commit. Integration commit `01488c8` added HQ and its evidence; `aa7771c` then registered those five screenshots and updated their documentation. The original temporary clone was retained clean, on its original v0.2 branch and at the base commit.
- After `aa7771c`, only the existing asset catalog is modified relative to the base; all other affected paths are additions. Both feature-branch commits were pushed, and the working tree was clean. No memory writes occurred during integration or the evidence-registration correction.

npm warns that the esbuild postinstall is not listed in the host's allowScripts policy. The installed binary, build and tests work. The host policy was not changed. Lint remains unavailable because no script/configuration exists.

Retained standalone copies are not automatically synchronized; subsequent development uses this durable clone.

## Final pre-commit validation — 2026-10-14

The dev server was launched from this repository's `apps/raxi-hq/`, using `npm run dev -- --host 127.0.0.1 --port 5177 --strictPort`. The durable app is available at `http://127.0.0.1:5177/`. A different port avoids disturbing the pre-existing servers from the standalone copy.

Visual inspection confirmed seven isometric rooms, role-specific chibi agents, procedural furniture, event-driven movement, handoff packet/indicators, pan, zoom, centering and React inspection panels. Selecting Creative showed ARIA_LINK, task-creative, WRITE_DISABLED and the expected role/capabilities. The mock completed 18 events at 100% MOCK_READY. Browser console had no observed warnings or errors. Fresh evidence from this dev server: Asset ID `RAXI-HQ-EVIDENCE-V03-DURABLE-DEV`, repo path `output/reports/raxi-hq-integration/evidence/v03-durable-dev.jpg`.

One requested repeat passed: build, typecheck, nine tests and `git diff --check`. The initial pre-commit staged the 47 added files under `apps/raxi-hq/`, this document and `output/reports/raxi-hq-integration/`; they were committed as `01488c8` and pushed. The P1 correction in `aa7771c` subsequently changed only the asset catalog and this document, then was committed and pushed to the same branch. No memory writes were performed.

Technical backlog: keep the host esbuild allowScripts/postinstall warning documented; it does not affect build/tests, and the policy is unchanged. Lint configuration is deferred to v0.4. Neither item is a blocker for this mock release.

The first cached whitespace check found surplus blank lines at the end of hqStore.ts and hqReducer.ts. Only those trailing blank lines were removed; no functional logic changed. Git's LF-to-CRLF notices are host line-ending normalization warnings; no global settings or broad formatting configuration were changed.
