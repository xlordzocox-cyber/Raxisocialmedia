# Issue #49 / PR #50 — M1 RAW response parity candidate (FAKE_ONLY)

**Status: IMPLEMENTED AS AN ISOLATED CANDIDATE; NOT INTEGRATED OR PRODUCTION-READY.** No HTTP, Docker socket/pipe, subprocess, SQL, network, container, provider, Supabase, migration or merge. `NO_GO_HOSTED_MIGRATION` remains active.

## Context and approved evidence
- Legacy D2 has 13 allowlisted request operations. Windows M0 QA on exact SHA `d7175596bd1ceb5d0817fe29fb671dfb57ebc4fb`: 13/13 full descriptor checks PASS, including path/method/status/body. Codex scoped rereview on same SHA returned `Didn't find any major issues`. Legacy D2 is not the transport to adopt because its old JS object return boundary has historical P2 findings.
- Separate RAW v2 at SHA `1ae634917a5012ad899d0b9f728c2fdafd48d59f`: Windows 52/52 negative simulated cases PASS, scoped Codex review found no major issues. Its `ping` incorrectly expects JSON `"OK"`, lacks some legacy JSON operations, and deliberately refuses binary `startExec`.
- Original RAW v2 module and test remain **unchanged** for reproducibility.

## M1 implementation
- `scripts/issue49-d2-raw-m1-parity-mock.mjs` copies the RAW v2 trust-boundary design into a **new file**, keeping opaque internally owned response tokens and primitive-string JSON/hex fixture constructors, per-object duplicate JSON key detection before JSON.parse, and size/depth limits.
- Adds `issue49RawM1TextFixture(status,text)` and validates `ping` as exactly two ASCII bytes `OK` (actual Engine API plain text, not JSON). Empty, whitespace-padded, lower-case and JSON-quoted ping bodies fail closed.
- Adds the previously missing JSON response checks: `version` (ApiVersion and Version), `imageInspect` (pinned SHA digest, Os=linux, Architecture=amd64, exactly one PG_VERSION=17.11 environment marker), `inspectContainer`, `createContainer`, `createExec` (valid 64-character lowercase hex IDs).
- Retains validated `listContainers`, `listVolumes` (Warnings=null or empty), `info`, `inspectExec`, empty-body `startContainer` and `deleteContainer`. **The `startExec` binary path remains intentionally STOP** until M2 separate review of multiplex framing, stdout/stderr separation and independent exec status. M1 does not build or dispatch requests: M0 legacy descriptors are only offline construction evidence.
- The code has no Docker adapter and no external JS response-envelope acceptance. No arbitrary JS object can replace internal bytes by changing getters, toJSON, array methods, or Proxy hooks.

## Preliminary QA
- `scripts/test-issue49-d2-raw-m1-parity-mock.mjs`: 39 simulated adversarial negatives plus successful operations, using a variety of invalid ping, version, image metadata, missing IDs, JSON duplicate keys, partial inventories, forged token, incorrect HTTP status, and blocked binary.
- **V8 isolated execution PASS: 39/39 simulated negatives** using ASCII TextEncoder/TextDecoder polyfills. This does **not** replace real Node QA or prove full Unicode correctness.
- **Node Windows QA PENDING.** Execute `node --check` on both M1 scripts and `node scripts/test-issue49-d2-raw-m1-parity-mock.mjs` from the **same pinned Git SHA** and verify the exact 39-case marker.
- **Independent Codex M1 rereview PENDING.** Confirm contract parity, no new bypasses, no real side effects, compatibility with legacy request builder, and unchanged M2 binary exclusion.

## Future gates
M1: Windows test on exact SHA + Codex scoped review without new blockers, document any gaps.
M2: isolated byte-only Docker multiplex parser with strict header/stream/size/error constraints and linkage to inspectExec, separately approved.
M3: replacement of legacy `{status,data}` exchange only after full migration of regression intent and explicit approval (including routes/import references and 15+ historical review threads).
M4: actual Docker/SQL/named pipe/host access requires separate authorization and safety review. No automatic merge, no deletion of mocks, and no hosted migration.

**Separate topic:** Instagram competitor access for Investigador tracked in issue #52, using authorized vi dIQ or Work/browser evidence, not coupled to the Docker/PG17 M1 transport.


## Windows Node M1 QA confirmado (2026-11-06)

El operador ejecutó PowerShell y verificó `FETCH_HEAD` exacto `e6989f4f36e97fd444dc94f34191e90053a251b2`; los dos scripts M1 pasaron `node --check`. La suite M1 produjo `PASS ISSUE49 D2 M1: response parity candidate, plain-text ping and JSON schema`, `PASS ISSUE49 D2 M1 NEGATIVES (39 simulated cases; no Docker/socket/SQL)` y `ISSUE49 D2 M1: FAKE_ONLY / NOT_INTEGRATED / NO_GO_HOSTED_MIGRATION`. **Windows Node 39/39 negativas simuladas PASS** y rutas positivas de respuesta PASS solo en este candidato aislado.

La revisión Codex solicitada para exactamente ese commit mediante comentario 6693058177 constaba como **running** en la última consulta GitHub. No declarar M1 cerrado hasta revisar dictamen independiente y hallazgos. Los 16 hilos P2 históricos del PR #50 siguen abiertos. Sin sustitución del D2 anterior, sin M2 real, sin Docker/socket/SQL, PR DRAFT, `NO_GO_HOSTED_MIGRATION`.
