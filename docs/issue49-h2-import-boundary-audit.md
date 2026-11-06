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
