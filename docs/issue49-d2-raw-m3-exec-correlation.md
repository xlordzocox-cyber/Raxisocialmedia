# Issue49 D2 M3 — isolated mock exec identity correlation

**Status: FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION.** This increment adds two independent files and does not replace M0, M1, M2, original D2 or any runtime. No Docker, HTTP, pipes, sockets, SQL, Supabase, deployment, or workers.

## Contract
1. `issue49RawM3CreateSession` accepts only a private M2-owned `createExec` fixture with HTTP 201 and a lowercase 64-hex ID. The ID is retained inside a WeakMap session, not supplied independently by the caller.
2. `issue49RawM3AcceptStart` consumes a private M2-owned non-TTY multiplex `startExec` fixture with HTTP 200, copies the parsed stdout/stderr and leaves `executionConfirmed:false`. It is one-shot.
3. `issue49RawM3InspectExit` consumes a private M2-owned `inspectExec` fixture with HTTP 200, `Running:false`, `ExitCode:0`, and **exact matching uppercase `ID` JSON field**. Missing, mismatched, unsupported IDs or nonzero exit fail closed. The session is terminal on any attempt. The result states `simulatedExitValidated:true` but **always `executionConfirmed:false`**.
4. Zero-frame valid multiplex body is allowed only in conjunction with the matching successful simulated exit; no stream bytes alone prove command execution.
5. All session/order/replay/invalid-token validation fails closed. A failed inspection cannot be retried with a different fixture.

## Security boundary and remaining gaps
This is **mock correlation only**, not independent or cryptographic attestation. The startExec URL and inspectExec URL are not yet derived/bound to the same trusted request descriptor or transport origin. Caller-side sequencing cannot prevent a future transport adapter from sending responses for a different ID. There is no real Docker Engine interaction, no authenticated connection, no idempotent native operator, no production success assertion. Do not use the `simulatedExitValidated` field as production QA, approval or a campaign execution receipt.

## QA gates
- On Windows, pin the exact reviewed SHA; use `git show FETCH_HEAD:scripts/...` to extract the new two M3 files and the reviewed M2 dependency into a fresh temporary directory; `node --check` all three, run `node test-issue49-d2-raw-m3-exec-correlation-mock.mjs` and record the exact negative count.
- Independent Codex review for fail-closed behavior, replay, identity spoofing, zero-frame policy, ID field casing, byte aliasing, JS Proxy/accessor boundaries, and misuse of success fields.
- Later, separately approved adapter migration requires a pinned 13-operation descriptor/transport binding, historic negative regressions, authenticated origin verification, and no false positive execution. No merge or hosted migration under current approval.

## Codex P2 remediation (2026-11-06)
Codex identified that out-of-order inspection and repeated start were rejected without poisoning the session; a subsequent legal-looking sequence could still produce `simulatedExitValidated:true`. The M3 candidate now marks the session `failed` **before** rejecting an invalid phase in both `AcceptStart` and `InspectExit`. Four new negative assertions require permanent rejection after premature inspection, repeated start, and replay attempts. Verified negative count in test source: **31** (original 26 plus 5 added assertions). The previous 30-case expectation was a QA wrapper/documentation error; Windows Node test output reported 31 and exited successfully. Windows Node QA and independent Codex rereview are **pending** for the corrected HEAD; neither an older 26/26 PASS nor a prior review authorizes integration. No transport, Docker, SQL or production operation is enabled.
