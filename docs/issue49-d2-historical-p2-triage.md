# Issue #49 / PR #50 — Triage of 18 historical P2 review threads
Date: 2026-11-06. **FAKE_ONLY / PR DRAFT / NO_GO_HOSTED_MIGRATION**.

M4 was scoped Windows Node QA 30/30 negative cases PASS on code SHA `df6796d7c76769f6498003417909d0b534c4e8e1`, with scoped Codex rereview no major issues (receipt #6693852183). This does **not** close outstanding historical threads or certify real Docker transport.

## Verified checkpoint after H1.4 — 2026-11-06

**Current PR HEAD before this documentation-only edit:** `9d34b71a2a39976bdbdda1fdd5ec5bf159aa846a`. **Verified open GitHub review threads: 16** (legacy D2: 10; historical RAW response: 4; M1 parity: 2).

**Formally resolved this checkpoint (six threads only):**
- `PRRT_kwDOVIWc5s60jpFg` — inherited `every/map` and inventory truncation
- `PRRT_kwDOVIWc5s60qxVW` — inherited `constructor` / `ArraySpeciesCreate`
- `PRRT_kwDOVIWc5s60q3Ov` — inherited `filter` in `imageInspect`
- `PRRT_kwDOVIWc5s60q_M-` — test omitted required `imageId:PIN` and falsely passed negatives before exchange
- `PRRT_kwDOVIWc5s60rFZM` — inherited `toJSON` changed image version after validation
- `PRRT_kwDOVIWc5s60pWFQ` — independent full-path/body/expected-status comparison for 13 M0 descriptors

Each thread received a technical reply and its GitHub review thread was marked resolved; verification confirms **16 remain**. Evidence: Windows Node `H1.4 6/6 + H1.2 6/6 + M0 13/13` PASS on the pinned code SHA, PR comment #6694412615; independent Codex scoped review of the same code SHA said **Didn't find any major issues**, PR comment #6694415067. No implications for previously unresolved P2s. This document edit does not alter tested code.

**Next phase — H2, fail-closed replacement-boundary audit (DESIGN/FAKE_ONLY).** Before further patching mutable legacy fixtures:
1. Trace every import, call site, and export of historical `issue49-d2-raw-response-mock.mjs`, `issue49-d2-raw-m1-parity-mock.mjs`, the D2 legacy engine mock, and the M2/M3/M4 candidate. Identify any remaining reachable bypass or import path; do not assume historical means unused.
2. Separate fixture-only test constructors from a hypothetical future trusted raw-byte source. Prove that arbitrary object/Proxy/SharedArrayBuffer responses cannot be promoted into a trusted envelope by M2–M4.
3. Run fresh negative tests for each reachable bypass, scoped Codex review and Windows pinned-SHA QA; close only matching P2 threads. Preserve any unresolved historic code issues in GitHub as blockers if those paths remain reachable.
4. Keep `FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION` and no real Docker/socket/SQL/Supabase or merge.

**Historical inventory below is a snapshot from before these six closures, not the current count.**

## Thread classification (exact inventory from GitHub after M4)
### A. Legacy D2 `scripts/issue49-d2-engine-api-mock.mjs` — 11 P2 threads
- `PRRT_kwDOVIWc5s60U6t6` operation mutation during await
- `PRRT_kwDOVIWc5s60U6uB` volume warning acceptance
- `PRRT_kwDOVIWc5s60VIHE` invalid volume identities
- `PRRT_kwDOVIWc5s60VIHI` sparse containers array
- `PRRT_kwDOVIWc5s60VQW_` toJSON copy changed identities
- `PRRT_kwDOVIWc5s60VVKy` capture identities before serializing
- `PRRT_kwDOVIWc5s60VVK0` request getter / descriptor changes
- `PRRT_kwDOVIWc5s60VdYg` inventory copied length mismatch
- `PRRT_kwDOVIWc5s60VisM` volume getters before cardinality capture
- `PRRT_kwDOVIWc5s60jEA1` inherited ID/Name getter
- `PRRT_kwDOVIWc5s60jpFg` inherited every/map getter

Last thread (`jpFg`) now has a candidate **code correction** and a four-case regression script. **Do not close before pinned Windows PASS and scoped independent rereview.** Other ten threads need evidence against current HEAD; a historical P2 may have an existing fix, but existence of a fix must be independently validated, not inferred from later source.

### B. Legacy RAW response `scripts/issue49-d2-raw-response-mock.mjs` — 4 P2
- `PRRT_kwDOVIWc5s60j3jD` hostile Uint8Array iterator
- `PRRT_kwDOVIWc5s60j3jM` Proxy envelope traps
- `PRRT_kwDOVIWc5s60j3jT` SharedArrayBuffer race
- `PRRT_kwDOVIWc5s60j3jd` duplicate JSON keys

Architectural strategy: retain original file as a historical reference while explicitly demonstrating that trusted-fixture M2/M3/M4 successors remove these surfaces. **Supersession alone does not prove integration:** do not close until the replacement boundary and negative coverage are confirmed. Do not silently modify an untrusted caller into a trusted source.

### C. M0 descriptor audit `scripts/test-issue49-d2-migration-readiness.mjs` — 1 P2
- `PRRT_kwDOVIWc5s60pWFQ` incomplete 13 request descriptors

Current test source already includes exact complete method/path/body/expect comparisons for 13 descriptors. Candidate for evidence-based historical closure after pinned rerun and independent review, not automatic closure.

### D. Historical M1 `scripts/issue49-d2-raw-m1-parity-mock.mjs` — 2 P2
- `PRRT_kwDOVIWc5s60pxJ7` expected HTTP status vs operation
- `PRRT_kwDOVIWc5s60pxKA` conflicting PG_VERSION env

M2 contains an operation status allowlist and count of **all** PG_VERSION declarations; M1 remains historical. Verify successor + negative regressions and migration relevance before closing historical threads.

## Safe execution order
1. **H1** — Pinned Windows revalidation of D2 inherited array method getter fix and four-case test; independent Codex review of exact SHA. Close only thread jpFg if both clean.
2. **H2** — Rerun existing M0 full 13 request descriptor assertions, inspect test independence and close pWFQ only if supported.
3. **H3** — Verify and document D2 async-operation, volume/container inventory safety on current HEAD, with adversarial regressions (remaining D2 historical P2).
4. **H4** — Audit RAW and M1 supersession by M2, plus no downgrade/alternate runtime path. Do not force-close P2 by claiming a historical module is unused without call-graph and integration evidence.
5. **H5** — Independent review of consolidated bounded 13-operation fake-only migration candidate. Real transport is a separate new approval gate.

## Hard limits
NO merge, hosted migration, SQL, Docker connections, network, sockets, providers, workers, deployments, auto-closing unrelated threads, or production execution based on fake-only PASS. Preserve clearly labeled DEMO/MOCK when runtime is not verifiable.
