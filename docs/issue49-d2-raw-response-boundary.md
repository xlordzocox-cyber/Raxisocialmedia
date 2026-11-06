# Issue49 / PR50 — D2 strict serialized-response boundary

**Status: proposed D2 hardening contract, not a replacement for existing D2 yet. No Docker, HTTP, pipe, SQL or subprocess implementation or authorization.**

## Root cause

The original fake `exchange` returns arbitrary executable JavaScript object graphs to a validator claiming to validate HTTP/JSON: getters, inherited methods and `toJSON` can alter inventory identities/counts between observations. At least eleven independent P2 findings resulted from this mismatch. A production HTTP boundary does not carry JavaScript prototype methods; the transport produces bytes.

**Decision proposal:** D2 fake exchange should return a **strict response envelope** with `status` (integer) and **`bodyBytes`**, a freshly owned Uint8Array containing UTF-8 JSON (or, for Docker exec multiplex output, binary stream bytes). The validator must reject object-shaped `data` input, not JSON.stringify it, and parse JSON bytes exactly once using `TextDecoder('utf-8',{fatal:true})` then `JSON.parse`. JSON values are inert data values, not caller-supplied active objects.

## Constraints

- Protect status and bytes shape with own-data-property descriptor validation; do not read accessors or inherited properties; reject unexpected extra envelope keys. Copy bodyBytes before an asynchronous boundary or ensure there is no await between read and parse. Do not accept SharedArrayBuffer-backed data or buffer aliasing where externally modified bytes may change between validation and use.
- Limit bodyBytes to 8 MiB (smaller limits for ping, version, inventories where practical). Reject empty JSON, malformed JSON, invalid UTF-8 and non-JSON response for each endpoint. Strict HTTP status expected per operation. No redirect/fallback.
- For JSON requests, only `JSON.parse` creates the parsed graph; call schema validations on that graph. Enforce dense arrays, valid own identity fields and no duplicate IDs; volume Warnings MUST be null or [].
- For Docker multiplexed binary, reuse byte-oriented parser only on defensive copy; stderr must remain separate. `exec` exit code requires independent `inspectExec` and `Running=false`, `ExitCode=0`.
- No raw URLs, user-selected commands, network transport, named pipe, Docker subprocess or shell. No adapters to real daemon until separate D4/D5 approvals.
- **Fail closed** when old `{status,data}` fixture shape is passed: test fixtures must use encoded UTF-8 JSON bytes to exercise the same trust boundary as a future HTTP client. Legacy active-object regressions can continue to run against previous mock to document previous attacks but never be accepted as valid raw response.
- Do not promote this proposal into production without independent Codex rereview, complete Windows QA and a separate review of HTTP framing/protocol and resource cleanup.

## Gates

1. Prototype implementation entirely isolated from original `scripts/issue49-d2-engine-api-mock.mjs` and its 55-case QA (so history remains reproducible); separate regression suite on raw-response boundary.
2. Independent audit of accepted envelope type and binary/UTF-8/body-size edge cases.
3. Only after favorable review, decide whether to replace original `exchange` contract and adapt its historical tests to bytes; preserving the original regression evidence.
4. No D3/D4/D5 and no real Docker/SQL until explicit authorization and completed gates.

Proposed outcome does **not** claim D2 closure or pass a real Docker/SQL trial. PR #50 remains DRAFT, `NO_GO_HOSTED_MIGRATION`.
