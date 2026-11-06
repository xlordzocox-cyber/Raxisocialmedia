# Issue49 / PR50 — M2 binary multiplex candidate, FAKE_ONLY

**Status: isolated prototype, not integrated.** No Docker Engine connection, HTTP, named pipe, daemon, subprocess, network, SQL, Supabase or real operation. NO_GO_HOSTED_MIGRATION.

## Motivation and prerequisites

M1 candidate `scripts/issue49-d2-raw-m1-parity-mock.mjs` at SHA `17d91420aa462e4e78eb7117801affa360d5c0fc` passed Windows Node 46/46 simulated adversarial cases and Codex scoped review (receipt `6693208584`) said no major issues. Its `startExec` deliberately failed closed because binary Docker Engine API multiplex parsing was not yet validated.

## Implemented M2 prototype

- New separate `scripts/issue49-d2-raw-m2-binary-mock.mjs` based on M1; originals M0/M1/RAW v2 unchanged.
- Retains private WeakMap-owned response tokens and *primitive string* JSON/hex fixtures. Caller-provided active JS envelope/proxy or arbitrary Uint8Array cannot become a recognized response.
- For `startExec`, checks the operation-scoped expected HTTP status 200 and parses only *owned* non-TTY Docker Engine API multiplex frames: 8-byte header, stream kinds 1 stdout or 2 stderr, three reserved zero bytes, big-endian uint32 frame length; all lengths bounded and checked before copies. A single frame may contain binary null/high bytes; stdout/stderr remain separate and ordered per stream.
- Max encoded body: 8 MiB; stderr accumulated <=65,536 bytes; <=100,000 frames; truncation, unsupported stream number, nonzero reserved bytes and oversized length reject. Output arrays are newly allocated and not aliases to internal token byte storage.
- Returns `streamValidated:true`, `executionConfirmed:false`, stdout/stderr, frames. **A syntactically valid stream is NOT proof the command succeeded.** Independent `inspectExec` currently checks `Running=false, ExitCode=0` but M2 does not correlate startExec stream and inspectExec response by immutable execution ID. That correlation and clean exit evidence remain blocking before production integration.
- Deliberately no TTY/raw undelimited stream mode; TTY false is fixed by M0 request contract, but no transport request correlation yet.
- `scripts/test-issue49-d2-raw-m2-binary-mock.mjs`: 29 simulated negative cases plus positive binary/nonempty/zero-frame cases and inspectExec checks.
- Initial V8 isolated execution (ASCII-only TextEncoder/TextDecoder polyfill) reports **29/29 negatives PASS**, plus positive scenarios; not Node Windows QA.

## Pending gates

1. **Pinned SHA Node Windows** syntax check both files, run M2 test and assert 29-case marker. No Docker/socket/SQL.
2. **Codex independent review** of exact M2 SHA. Review zero-frame acceptance policy, frame maxima, status, reserved bytes, stdout/stderr limits, buffer aliasing, malformed hex, error handling, and false-success risk. Do not close new P2 without evidence.
3. Before replacing D2 original: correlate immutable exec ID/session and inspected exit code after stream completion, complete 13-operation integration test and port historical regressions; **separate approval**.
4. Any real Docker/SQL/pipe/hosted migration remains blocked pending explicit authorization and safety assessment.

PR50 stays DRAFT and unmerged; prior historical P2 threads remain unresolved until architectural migration validates replacements.
