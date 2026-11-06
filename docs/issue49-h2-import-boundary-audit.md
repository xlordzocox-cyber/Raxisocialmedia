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
