# Issue49 / PR50 — H2A static replacement-boundary audit (FAKE_ONLY)

Date: 2026-11-06. Baseline audited code SHA: `4e83e9bc37677eaf6074eedd8103427797c1dc95`.

## Confirmed source findings (direct inspection of files at the pinned SHA)

1. **M4 still imports the legacy D2 request constructor.** `scripts/issue49-d2-raw-m4-request-binding-mock.mjs` imports `buildIssue49D2Request` from `issue49-d2-engine-api-mock.mjs`. It uses this when making createExec/startExec/inspectExec request descriptors and for descriptor drift validation. Thus the D2 *request builder* remains on the M4 simulated path. This does **not** mean the legacy D2 *response parser* is called by M4.
2. **M4 validates receipts through M2 and M3.** `issue49M4FakeReceipt` checks a private M2 fixture token and pins operation/status. M3 separately checks createExec/startExec/inspectExec and preserves `executionConfirmed:false`. This is scoped fixture-state integrity, **not an authenticated host receipt**.
3. **M2's fixture constructors are public exports.** `issue49RawM2*Fixture` functions accept locally supplied primitive text/hex and construct opaque WeakMap-backed tokens; M4 callers may use such fixtures to simulate successful receipts. No real source of truth is attested. Opaque token possession is **not** equivalent to Docker execution provenance.
4. **Historical RAW / M1 still exist as independent exported modules.** `issue49-d2-raw-response-mock.mjs` exposes `parseIssue49D2RawResponse`; `issue49-d2-raw-m1-parity-mock.mjs` exposes M1 fixture and checker functions. They have historical open P2s and cannot be called automatically superseded merely because later fixture modules exist.
5. **M0's 13 descriptor assertions are unit/static checks only**; they do not establish live Engine API, daemon authenticity, SQL parity, or migration readiness.
6. **There is no verified native execution bridge in the files inspected for this review.** This is a statement about this inspected set, not the entire repository. The tree-wide reference scan below is required to determine whether other routes import these modules.

## Safeguards and decisions

- H2A is an **audit**, not integration: no changes to runtime exports, module signatures, third-party providers, deployment, or database.
- No historic RAW/M1 P2 threads can be closed solely by the existence of M2–M4. First prove whether the old modules are **reachable** from any application code / scripts or whether only tests and documentation refer to them.
- Any future real transport requires an independently reviewed boundary creating **authenticated, immutable status+byte receipts from actually executed requests**; direct production access to fake fixture constructors must be structurally forbidden. A source-compatible import swap does not meet this requirement.
- Historical legacy D2 still has ten open P2s, RAW four, M1 two. **No reduction to 16** is inferred until GitHub review threads are resolved with evidence.
- Restriction: `FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION`.

## H2B reproducible complete-tree reference audit (READ_ONLY)

Run on the user's Windows 11 repository with Git installed and after fetching exactly the pinned SHA of this document. The audit uses `git grep` on the exact commit **object**, not the checked-out working tree. It neither imports JS modules nor executes project code. Use `git grep -n -F` for each token and capture all hits; Git exit 1 means *zero matches* (not failure). Detect true errors when exit code is greater than 1.

Search literals:
- `issue49-d2-engine-api-mock`
- `issue49-d2-raw-response-mock`
- `issue49-d2-raw-m1-parity-mock`
- `issue49-d2-raw-v2-mock`
- `issue49-d2-raw-m2-binary-mock`
- `issue49-d2-raw-m3-exec-correlation-mock`
- `issue49-d2-raw-m4-request-binding-mock`
- `parseIssue49D2RawResponse`
- `issue49RawM1Check`
- `issue49RawM2Check`
- `issue49M4FakeReceipt`
- `createIssue49D2MockTransport`
- `buildIssue49D2Request`

**Interpretation:** A `git grep` hit is only a literal reference, not necessarily a live code import. Every hit must be classified as executable import/call, test only, documentation, or unknown; dynamical import/require and generated code may require further analysis. No zero-hit claim is allowed without completing the tree scan. Paths should be reviewed before any P2 closure.

## H2A preliminary gate

**PARTIAL / NOT VERIFIED TREE-WIDE / NO_GO_HOSTED_MIGRATION**. Do not close the remaining 16 P2 threads, mark PR50 ready, or merge.


## H2B Windows full-tree literal-scan result and classification (verified 2026-11-06)

Pinned tree: `3b66e3f26ea0dd0e8e3ee9c40a34c6294d8dbc92`. User's `git grep -n -F` completed PASS in PowerShell, and full transcript (path:line:content) was inspected. The **95 text-match entries are not distinct references or vulnerabilities**; terms intentionally overlap across searches.

| File class | Text-match entries | Source of classification |
| --- | ---: | --- |
| Documentation (`docs/**`) | 46 | Narrative, references and historical audit evidence |
| Test scripts (`scripts/test-*`) | 33 | Test imports, calls, assertions |
| Other `scripts/**` modules | 16 | Exports, imports and internal references; **not 16 executable dependencies** |
| **Total** | **95** | All 13 terms, complete supplied transcript |

### Source-module edges confirmed by exact matches

- `M4 -> legacy D2`: `scripts/issue49-d2-raw-m4-request-binding-mock.mjs:3` imports `buildIssue49D2Request`, and uses it at lines 34 and 75. Legacy D2 itself defines this export at line 73 and calls it internally at line 243.
- `M4 -> M2`: M4 line 4 imports `issue49RawM2Check`; `M3 -> M2`: M3 line 3 imports the same checker.
- `M4 -> M3`: M4 line 8 imports the M3 session functions (continued across multiple lines).
- Historical RAW parser exported at `scripts/issue49-d2-raw-response-mock.mjs:43`; its only matching import in this scan is in `scripts/test-issue49-d2-raw-response-mock.mjs:3`.
- Historical M1 checker exported at `scripts/issue49-d2-raw-m1-parity-mock.mjs:112`; its only matching import in this scan is in `scripts/test-issue49-d2-raw-m1-parity-mock.mjs:4`.
- M2 checker export at M2 line 151; M4 fake-receipt export at M4 line 45; original D2 fake transport export at D2 line 237. The original fake transport appears as test uses; no matching non-test import was found.
- Among these **literal matches**, there is **no non-test static import of original RAW or M1**. This is a bounded negative statement about the provided `git grep` output, not proof that they are unreachable via computed/dynamic imports, alternate aliases, build scripts, or other repository paths.

### Architecture and security implication

`RAW original` and `M1` appear *candidate historical/test-only modules* in this literal reference graph. **This is a recommendation for isolation, not a verified safe removal or justification for resolving their six historic P2 threads.** Source modules can still be invoked directly by any caller that imports them; this audit has not implemented nor proven a runtime import restriction.

`M4` is not independent of the D2 request constructor; do not replace or delete D2 without separating its descriptor builder from the legacy fake transport in an explicitly reviewed and tested change. `M2/M3/M4` still operate on mock fixtures, not an authenticated host boundary. `executionConfirmed:false` remains mandatory.

### H2B gate and recommended next validation

**H2B literal reference classification: PASS (95/95 entries categorized).**
**Reachability and dynamic import/build-reference audit: PENDING.**
**Historic P2 status: 16 OPEN, 0 additional closures from H2B.**
**PR #50: DRAFT / FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION.**

Next: inspect package scripts, TypeScript/JavaScript imports, dynamic `import()`/`require()`, module-resolution aliases and any generated entrypoints; then build a **read-only, reproducible negative guard** showing that the legacy RAW/M1 parsers have no route from application or candidate runtime code, and an explicit guard that real runtime paths cannot accept public fake-fixture receipts. Review with Codex and perform pinned Windows QA before closing anything. No network, Docker, SQL, merge or deployment is authorized by this result.

## H2C inspection of app build entrypoint (preliminary, 2026-11-06)

Reviewed `apps/raxi-hq/package.json` at SHA `9c8a66148856965a647cd282f20d7ba3db9df1bc`: scripts `dev:vite`, `build:node scripts/build-campaign-function.mjs --check && tsc -b && tsc -p ../../server/agent-runtime/tsconfig.json && vite build`, `typecheck:tsc -b && tsc -p ../../server/agent-runtime/tsconfig.json`, and `test:node scripts/test.mjs`. **None of these package script definitions explicitly names legacy RAW/M1.** This does not prove that scripts, build entrypoints, transitive dependencies, dynamically imported modules, or generated artifacts are free of those references. No script was executed during this audit.

**H2C still requires a pinned whole-tree scan** of dynamic `import()`, `require()`, `createRequire`, Vite `import.meta.glob`, package scripts, `tsconfig` aliases and generated imports plus a human review of relevant hits; do not close historic RAW/M1 P2 based on package.json alone. All checks remain read-only. A future static guard should fail on unapproved import edges from production/application/runtime modules to legacy RAW/M1 and on import of public fake-fixture receipt constructors from any live runtime. An allowlist must explicitly constrain tests/docs to avoid incorrectly allowing all `scripts/**` code.

## Completion roadmap (proposed, not approved implementation)

1. **H2C:** classify dynamic imports, aliases, app/build/test entrypoints and transitive module graph, document negative guard; code SHA and Windows QA. No changes to runtime.
2. **H2D:** test real reachability of legacy D2/RAW/M1 exports, fix or structurally quarantine still-reachable historical vulnerabilities, close 16 remaining P2 *only* with targeted regression and independent review.
3. **D2 boundary refactor:** extract immutable, allowlisted request descriptor builder from legacy mock transport; M4 can use a separately audited request contract. Preserve all M0 13 descriptor invariants and SHA/owner/ports/command pin.
4. **Host provenance gate:** design/implement a genuine trusted transport adapter and receipt origin that cannot be created from public fake fixtures; distinguish request construction, transport success, inspect status and real execution. Requires fresh user approval before any real Docker or database activity.
5. **Local native verification:** complete prereqs and safety gate for Windows isolated Docker/PG17.11, verify resource isolation/cleanup/RLS/PG parity/canonical catalog, and compare against PR39 known discrepancies. No unapproved local writes or migrations.
6. **Hosted staging gate:** only when separate approval, validate Supabase Auth/RLS/migrations against pinned manifest, permissions, rollback, policies and no production data copying. Never extrapolate mock PASS into hosted PASS.
7. **Application integration and UX:** connect actual agents/workflows and state to office without invented movement, implement human approvals, retry/idempotency, errors, audit trail, durable assets and schedule/publisher controls. Distinguish MOCK/LIVE_READ_ONLY/REAL.
8. **Product launch QA:** repository regression/typecheck/build/security+secrets, independent review and manual desktop/mobile E2E; performance, monitoring, rollback and operator runbooks; merge/deploy only after explicit approvals.
9. **Creator workflow readiness:** validate one end-to-end campaign (idea → investigation → creative assets → independent QA → approval → publish only with separate consent → analytics and memory) before declaring the office operational. Publishing and paid-provider connections remain opt-in.

Each item is a **proposal/remaining gate**, not a statement that all listed implementation work is absent. Exact implementation coverage of steps 4–9 must be inventoried against main and PRs before scope/estimates are frozen.


## H2C — detailed dynamic-loading classification (Windows pinned report, 2026-11-06)

Pinned tree `4ec2c374391badad304a6bea573438c53c92b1e8`. User supplied the full `git grep -n -E` results for source/config files and configuration inventory; code files above were independently inspected via GitHub. **Scan completed; findings are static, no modules executed.**

- `import(...)`: **11** textual lines. Eight in `apps/raxi-hq/scripts/staging-runtime-acceptance.mjs` (builtin `node:fs/promises`, `node:crypto`, `node:assert/strict`, `node:url`, `@supabase/supabase-js`, `pg`, `esbuild`, and two generated local bundles); one in `apps/raxi-hq/src/auth/AuthRoutes.tsx` dynamically imports `../App` behind React.lazy; one opt-in local script `scripts/run-native-concurrent-pr35.mjs` imports `node:child_process`; one opt-in local script `scripts/run-native-js-adapter-pr35.mjs` dynamically imports its generated local runOne/repository/provider bundle. **None of these 11 import expressions directly names RAW original or M1.** Staging runtime has approval gates, but this audit did not run or verify them.
- `require(...)`: **11** textual lines. Ten in `scripts/pr39-catalog-diagnostic.mjs` invoke its own local assertion function named `require`, *not* CommonJS imports. One `require('esbuild')` occurs in opt-in `scripts/run-native-js-adapter-pr35.mjs` after `createRequire`. `createRequire` appears **twice** in the same file (import and invocation).
- `import.meta.glob`, `new Function(...)`, `eval(...)`: **0 matches in scanned extensions** (not a universal runtime ban).
- RAW original `issue49-d2-raw-response-mock`: **1 direct import**, in `scripts/test-issue49-d2-raw-response-mock.mjs` only.
- M1 `issue49-d2-raw-m1-parity-mock`: **1 direct import**, in `scripts/test-issue49-d2-raw-m1-parity-mock.mjs` only.
- `issue49M4FakeReceipt`: **2 matches**, the export in the mock module and an import in `scripts/test-issue49-d2-raw-m4-request-binding-mock.mjs`; no non-test reference in this source-extension scan.

**Five configuration paths**: `apps/raxi-hq/package.json`, `apps/raxi-hq/tsconfig.json`, `apps/raxi-hq/tsconfig.node.json`, `apps/raxi-hq/vite.config.ts`, `server/agent-runtime/tsconfig.json`. Inspected all five. Vite config sets React, manual pixi/react chunks, dev port 5174, **no aliases**; TypeScript configs use bundler module resolution and contain no `paths` aliases, source includes `src`, Vite config, or agent-runtime `*.ts` respectively. Package scripts do not explicitly import RAW/M1. This inspection does **not** prove bundler graph or generated output are closed to other import expressions.

### Reachability verdict

**PASS limited H2C static classification:** for the tested source extensions, RAW original and M1 have no detected static/dynamic module imports outside their dedicated tests; M4 fake receipt likewise has no detected call outside its own module/test. This is a **bounded source finding**, not a guarantee against alternative external callers, future code, generated artifacts or undiscovered resolution mechanisms. Existing D2 `buildIssue49D2Request` is still directly imported into M4.

**Open engineering gate:** add a fail-closed repository check detecting new non-test imports of historical RAW/M1 and imports of M4 fake receipt into operational source; run test on exact SHA and independent review. Do not claim permanent runtime quarantine until that guard exists. Do not resolve the remaining 16 historical P2 merely because present static references are test-only.

**Security/operational separation:** opt-in PR35 native scripts, staging acceptance paths, and Meta A usable UI are separate concerns; no Docker, SQL, hosted migration, app startup, provider use or deployment was executed in H2C. `NO_GO_HOSTED_MIGRATION` remains effective.
