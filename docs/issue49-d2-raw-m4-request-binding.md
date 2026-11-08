# Issue49 D2 M4 — fake-only request/reply binding candidate
Status: **FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION**.

M4 is a separate prototype atop the unchanged D2 request-builder (M0), M2 opaque response tokens, and M3 immutable session/execution state. It generates the exact pinned paths and body for `createExec`, `startExec`, `inspectExec`, using the trusted 64-hex ID from the create response. Request and receipt identity are private WeakMap tokens; a receipt is tied to one request and cannot be swapped across trials, operations or phases. A failed consume poisons the trial. Result **always** states `executionConfirmed:false`.

## Critical limitation
`issue49M4FakeReceipt(request, fixture)` is a mock constructor, callable by the local test with its own arbitrary fixture. It cannot authenticate a real remote endpoint, transport connection, request/response correlation, network provenance, or process execution. M4's invariants only hold within this trusted fake test context; an integration that passes synthetic receipts as real evidence would be a security defect. No code path opens a socket, pipe, Docker connection, network, SQL, subprocess or Supabase.

Before any real integration: independent immutable transport envelope, authenticated origin, request URL/method/body response proof with ID correlation, negative cross-request concurrency tests, cleanup attestation, complete 13-operation regression coverage, separate security review and approval. No real Docker, hosted migrations, merge, infrastructure, or deployment permitted.

Windows QA: pin HEAD SHA, extract M0/M2/M3/M4 and M4 test files into one temp directory with `git show`; `node --check` each; run tests and compare displayed marker against actual count (do not assume count from test source). Follow with scoped Codex review and correct any P1/P2 before closing M4.
