# Raxi HQ PR #32 — Local Auth and Director E2E readiness (offline, opt-in)

**SCOPE: local-only test design and review harness. NO TEST EXECUTION OR STAGING WRITES AUTHORIZED BY THIS PR.** Production `jrkefsylpfriiqefcmzq` and staging `zvhxjindgyvtasstfjut` excluded from runtime operations.

## Grounded implementation paths

- `apps/raxi-hq/tests/supervisedHostIntegration.test.ts` imports real `createLocalSupervisedHost`, `localSupervisedRepository`, `runOne` and `simulatedProvider`; its database fixture uses **PGlite** and synthetic Auth tables. This is actual local runtime wiring but not native PG17 / hosted Supabase.
- `apps/raxi-hq/tests/supabaseSupervised.test.ts` imports `supabaseSupervisedAuth`, `supabaseSupervisedRepository`, `createSupabaseSupervisedHost` and staging gate functions, with **test doubles** (not signed JWTs or live Supabase).
- `apps/raxi-hq/tests/nativePg17Safety.test.ts` includes immutable lab guard tests; `apps/raxi-hq/scripts/native-pg17-lab.mjs` pins local existing Docker PG17 by full container ID. **Do not touch this container in PR #32**.
- `apps/raxi-hq/scripts/test.mjs` compiles individual TS tests using esbuild, then runs the project test suite. Its broad `npm test` entrypoint is **not** the first thing to run for this opt-in check; it covers unrelated tests.

## Phase A — Local E2E behavior, real orchestration, simulated provider

Document and test an exact, auditable single-task success case through `createLocalSupervisedHost` → `runOne` → `simulatedProvider` → journal/state snapshot; do not claim app UI, remote Auth, JWT signing or native PG17 verification from PGlite results.

Required negative cases (one test per invariant):
1. Missing, expired or reused human approval → no claim and no journal side effect beyond explicitly audited rejection; reject incompatible workspace/task.
2. Caller is not the owner / workspace B → no read/claim/journal access to workspace A; validate server-side authorization not only client hiding.
3. Repeated claim or identical request idempotency key → one logical execution/output, no duplicate provider invocation; race tests with controlled overlap.
4. Crash/timeout between claim and commit → bounded lease release/recovery, no double commit or abandoned execution.
5. Simulated provider only → deterministic fixture response, no external HTTP, provider keys or spending.
6. Director terminates before automatic Investigator / Creative / Publisher handoff; no publishing.

Capture evidence as counts/state transitions and short synthetic task IDs only (no JWTs/keys or local profile paths).

## Phase B — Native PG17 parity (separate explicitly approved local run)

Port only the minimum fixture/protocol proven in Phase A to a **new disposable**, network-isolated PostgreSQL 17 instance with synthetic Auth/Storage and the pinned seven SQL sources; avoid modifying the existing immutable laboratory or any OpenGym container. Verify concurrent claims, RLS across two workspaces and journal rollback using server-native transactions.

### Minimum evidence required

- Exact Git commit and dependency lockfile; CLI/Node versions and SHA-256 of SQL sources.
- Signed-off local fixture boundaries, complete positive and negative outcomes, test command exit status and cleanup evidence.
- Explicit classification: `PGLITE_LOCAL`, `NATIVE_PG17_SYNTHETIC_AUTH`, not `SUPABASE_AUTH_REAL`.
- No B2 invocation against hosted staging, no actual hosted Auth users, no real provider or deployments.
- Keep existing manifest `executionReady:false` and all authorizations false. PR #31 backup remains independent and cannot be inferred complete from this test.

## Next engineering increment

Use `docs/RAXI_HQ_STAGING_READINESS_AND_FIRST_DIRECTOR_RUN.md` gates and add targeted tests by extending the **existing** `supervisedHostIntegration.test.ts` and `supabaseSupervised.test.ts`; do not create a parallel fake Director implementation. First PR #32 delivers exact wiring inventory + a static, read-only verification utility; actual runtime execution requires a distinct local test authorization and measured results.

## Offline verification

From repo root, run `node scripts/verify-director-e2e-scope.mjs`. This only reads source files and checks the expected integration imports and prohibitions: no Docker, network, SQL, provider access or mutation. Passing verifies **scope and code wiring presence only**, not E2E behavior or runtime correctness.

## PR #32 targeted local runner (review-only until user runs)

**Command from `apps/raxi-hq`:** `node scripts/run-director-local-e2e.mjs --run-local`. Without this exact opt-in, the runner refuses. It bundles and executes only existing suites `supervisedHostIntegration.test.ts` and `supabaseSupervised.test.ts`, using Node test and the existing PGlite fixtures, serially. This does not invoke Docker, hosted staging, native PostgreSQL 17, real Supabase Auth, real providers or deployments. No test outcome is claimed until the user supplies console output and process exit status. This is an **existing-test integration execution**, not a new test implementation.

The existing suite contains named tests for independent Director/Researcher authorizations, simultaneous duplicate preparation/claim, revoked scope at dispatch with zero provider calls, journal idempotency, recovery after simulated persisted uncertainty, ownership separation and synthetic Supabase Auth/session-revocation checks. Evidence from these suites remains **PGLITE_LOCAL with Auth test doubles**; physical PG17 and hosted Auth/JWT remain separately pending. A passing test suite cannot satisfy hosted staging migration authorization.
