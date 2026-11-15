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

## Resultado de la revisión Codex del prototipo inicial (2026-11-06)

**Review del código SHA `4c20d464d54c1943672165665bf0e9d2b674b257`: COMPLETED, cuatro nuevos P2. No aprobado para sustituir D2 existente.** El operador confirmó Node Windows 19/19 negativas PASS sobre ese mismo SHA; esa cobertura no incluye los cuatro ataques observados.

1. **Iterador redefinido:** `Uint8Array.from(raw)` consulta `Symbol.iterator` de la instancia y puede copiar bytes distintos del almacenamiento real; objetos que falsifican `Uint8Array.prototype` pueden superar comprobaciones superficiales.
2. **Proxy en el envelope:** `Object.getPrototypeOf`, `Reflect.ownKeys` y `Object.getOwnPropertyDescriptor` ejecutan traps de Proxy; el cliente no puede declarar inerte un envelope arbitrario por examinarle descriptores.
3. **Memoria compartida:** aceptar `SharedArrayBuffer` permite una carrera durante la captura; no es suficiente evitar `await` o copiar después.
4. **JSON con propiedades duplicadas:** `JSON.parse` aplica la última clave, perdiendo advertencias/inventarios sobreescritos. Debe rechazarse durante el análisis del texto, antes de construir objetos.

### Rediseño recomendado de frontera (pendiente de implementación)

- Evitar que el validador acepte *envelopes de JavaScript aportados por código no confiable*. La capa confiable de transporte deberá construir internamente el estado de respuesta (código HTTP + bytes) a partir de eventos de red, con capacidades no expuestas a proveedores, UI, agentes o fixtures arbitrarios.
- Para pruebas simuladas, construir fixtures como **literales de texto UTF-8 o arrays de bytes controlados**; no pasar objetos activos al parser ni convertirlos mediante `JSON.stringify`. Mantener separados los tests de entradas activas como regresiones de rechazo de adaptadores externos, no como respuesta HTTP auténtica.
- Aplicar límites *antes* de reservar y copiar; verificar el tipo real de almacenamiento mediante APIs intrínsecas fiables, sin utilizar iteración externa, y prohibir `SharedArrayBuffer` y aliases mutables no controlados. Cualquier uso de `Proxy` debe excluirse en una frontera anterior confiable; no suponer que inspección de propiedades mediante JavaScript ordinario es libre de efectos.
- Analizar JSON estricto con detección **por objeto** de claves duplicadas y límites de profundidad/tamaño. No sirve JSON.parse seguido de reviver; las claves duplicadas ya se han perdido. La implementación exacta del parser y su QA requieren revisión independiente.
- Seguir separando cuerpo JSON y frames binarios Docker; no declarar `startExec` completo hasta validar multiplexing, límites y `ExitCode` en flujo separado.
- Conservar D2 original y sus 55/55 pruebas Windows, sin integrarlo con RAW hasta una decisión y auditoría posteriores. No presentar una revisión fallida con nuevos P2 como cierre de los once P2 anteriores.

**Estado:** prototipo RAW aislado, QA Windows 19/19 PASS, 4 P2 nuevos abiertos. PR #50 draft/unmerged, Windows Docker real bloqueado, `NO_GO_HOSTED_MIGRATION`.
