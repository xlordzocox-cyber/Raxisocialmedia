# Issue49 / PR50 — D2 RAW v2 (isolated mock)

**Status: IMPLEMENTED AS ISOLATED PROTOTYPE, NOT INTEGRATED. No Docker Engine API client, no socket/pipe, subprocess, network, containers, SQL, or hosted migration.**

## Why

Independent Codex audit of RAW v1, SHA `4c20d464d54c1943672165665bf0e9d2b674b257`, reported 4 P2: altered `Uint8Array[Symbol.iterator]`, Proxy envelope traps, SharedArrayBuffer race and duplicate JSON property names masked by `JSON.parse`. Operator validated RAW v1 19/19 simulated negatives on Windows. Original D2's 55/55 Windows pass is separate, and all historical review threads stay open.

## Implementation

Files:

- `scripts/issue49-d2-raw-v2-mock.mjs`: exports `issue49RawV2JsonFixture(status, primitiveText)`, `issue49RawV2BinaryFixture(status, primitiveHex)`, `issue49RawV2Check(token, operation, expectedStatus)`. All fixtures are **module-internal owned** with opaque frozen tokens keyed by private WeakMap. The caller cannot provide a bodyBytes property, a binary object, SharedArrayBuffer or Proxy envelope to the validator. An unbranded object or Proxy token is rejected before any property access. Input fixtures must be primitive strings (JSON literal or hex), NOT active JavaScript object graphs. Built-in TextEncoder creates a new owned byte buffer. The parser never uses the caller's custom iterator. No transport exists.
- The JSON scanner traverses textual values before `JSON.parse`, tracks duplicate names separately per object (including escaped property aliases), and rejects extra tokens, bad escapes, malformed JSON structures, excessive item count/depth, oversized body and invalid UTF-8. `JSON.parse` is used only after duplicate-key scan, on decoder output. JSON object graph is generated from inert text, not from JS object fixtures.
- Per-operation validation is intentionally a **limited subset**: ping, container/volume inventory, daemon identity, inspectExec and empty-body mutation acknowledgment. `startExec` fails closed, regardless of binary payload, because multiplex stream and exec status integration were NOT implemented in v2. No images, createExec, createContainer or real transport implemented in this prototype.
- `scripts/test-issue49-d2-raw-v2-mock.mjs`: 52 negative adversarial tests plus valid JSON/volume/container/inspectExec cases. Tests use **literal JSON text**; no `JSON.stringify` of active fixtures to produce accepted bytes.
- The code has no direct system interfaces; fixtures only simulate trusted transport-owned bytes. **Actual trust boundary between a future HTTP stream and internal buffers remains unimplemented**. This does not prove no proxies could reach a real transport implementation, since there is none.

## Test status

- Isolated V8 run: 52/52 negative tests PASS using ASCII-only TextEncoder/TextDecoder polyfills, with positive cases. This is not Node Windows QA, not full Unicode/UTF-8 verification.
- Node Windows QA: **PENDING**. Run `node --check` on both new files and `node scripts/test-issue49-d2-raw-v2-mock.mjs` from an exact SHA extracted into a temporary folder; expect `PASS ISSUE49 D2 RAW V2 NEGATIVES (52 adversarial cases; no Docker/socket/SQL)`.
- Codex independent review: **PENDING** on the exact SHA. Review JSON scanner with escaped Unicode key equivalence, surrogate/invalid UTF-8, unusual number/exponent syntax, depth/size, duplicate keys, prototype token spoofing, and future real HTTP adapter assumptions.

## Gates before replacing D2

1. 52/52 Node Windows pass, independent Codex review without unresolved blockers.
2. Decide migration separately: reconcile original D2 request allowlist and response schemas, port all prior negative regression evidence to the new bytes-only contract, and verify no feature regression.
3. Separate protocol review for Docker multiplex streams, binary framing, HTTP status and daemon authorization, resource lifetimes.
4. **No D3/D4/D5, no real Docker, SQL, Supabase, hosted migration, deployment or merge without separate authorization.**

PR #50 stays DRAFT; `NO_GO_HOSTED_MIGRATION`.


## Verificación independiente y Windows (2026-11-06)

El operador verificó `FETCH_HEAD` SHA exacto `1ae634917a5012ad899d0b9f728c2fdafd48d59f`, ejecutó `node --check` en ambos archivos RAW v2 y obtuvo `PASS ISSUE49 D2 RAW V2 NEGATIVES (52 adversarial cases; no Docker/socket/SQL)` junto con pruebas positivas. **Node Windows 52/52 PASS** para el prototipo RAW v2 en ese commit.

El recibo Codex `6688369728` para código SHA `1ae634917a` dice: `Didn't find any major issues`. La revisión específica terminó sin nuevos hallazgos importantes. El marcador agregado del PR conserva `has_any_findings=true` debido a **15 hilos P2 históricos sin resolver** sobre diseños anteriores; no es un dictamen limpio sobre la totalidad del PR ni autoriza integración.

**Alcance validado:** exclusivamente módulo aislado RAW v2 fake-only de fixtures con texto primitivo, token opaco y JSON estricto. No integra D2 legacy, no tiene transporte Docker HTTP/named pipe, no implementa `startExec`, no valida un ciclo PG17 real ni autoriza migración hospedada. No resolver hilos históricos hasta documentar reemplazo de código viejo y portar regresiones relevantes. PR #50 DRAFT, `NO_GO_HOSTED_MIGRATION`.
