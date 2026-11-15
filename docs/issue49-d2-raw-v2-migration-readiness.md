# Issue #49 / PR #50 — Preparación de migración D2 legacy → RAW v2

**Estado: PLAN + AUDITORÍA DE COMPATIBILIDAD. NO se ha sustituido D2 legacy, NO hay cliente Docker real, no hay SQL, socket, pipe, despliegues ni merge.** `NO_GO_HOSTED_MIGRATION` vigente.

## 1. Evidencia fijada (2026-11-06)

| Evidencia | Resultado | Límite |
|---|---|---|
| D2 legacy, `scripts/issue49-d2-engine-api-mock.mjs` | Windows Node: 55/55 negativas simuladas PASS sobre `12fc87b609fa4a81ad1204011298ae5f58c212ac` | Su intercambio acepta `{status,data}` como objetos JS activos; Codex reportó bypass adicional de métodos heredados de array; **no certificado para producción** |
| RAW v1 | Windows Node: 19/19 negativas simuladas PASS | Codex reportó 4 P2; no migrar |
| RAW v2, `scripts/issue49-d2-raw-v2-mock.mjs` | Windows Node: 52/52 negativas simuladas PASS sobre `1ae634917a5012ad899d0b9f728c2fdafd48d59f` | Prototipo aislado sin transporte real |
| Codex sobre RAW v2 | Recibo `6688369728`: `Didn't find any major issues` para `1ae634917a` | Revisión acotada al prototipo; no aprueba reemplazo completo |
| PR #50 | DRAFT, unmerged | 15 hilos P2 históricos abiertos, no cerrar automáticamente |

**Regla:** PASS de tests de un módulo aislado no implica paridad de contratos, equivalencia de inventario ni conexión segura a Docker.

## 2. Matriz de operaciones real del código

Fuente: `buildIssue49D2Request` y `checkResponse` del legacy frente a `issue49RawV2Check`. Estado `PARCIAL` no significa soportado para migración.

| Operación | Legacy request → respuesta esperada | RAW v2 actual | Bloqueo de migración |
|---|---|---|---|
| `ping` | GET `/v1.51/_ping`, HTTP 200, texto literal `OK` | Valida string JSON `"OK"` | **INCOMPATIBLE**: texto plano no es JSON; definir tratamiento explícito de `text/plain` sin aceptar body arbitrario |
| `version` | GET `/version`, 200, `ApiVersion` y `Version` | Sin rama | FALTA validador y casos adversariales |
| `info` | GET `/info`, 200; identidad Linux `ID/OSType` | Valida ambos | PARCIAL; contratos de respuesta y límites deben equipararse |
| `imageInspect` | GET imagen SHA256 fijada, 200, `Id`, Linux/amd64, `PG_VERSION=17.11` | Sin rama | FALTA pin de imagen y comprobaciones de metadatos |
| `listContainers` | GET `/containers/json?all=1`, 200, array denso con IDs SHA64 únicos | Valida IDs SHA64 únicos | PARCIAL: conservar exhaustividad, cardinalidad e inventario sin éxito parcial; schema de otros campos y ownership se verifican fuera de D2 |
| `listVolumes` | GET `/volumes`, 200, `Volumes` con `Name` únicos y `Warnings` nulo o vacío | Valida ambas | PARCIAL: mantener manejo de null/[] y volúmenes sin identidad |
| `inspectContainer` | GET `/containers/{id}/json`, 200, `Id` SHA64 | Sin rama | FALTA |
| `createContainer` | POST `/containers/create?name=...`, 201, `Id` SHA64 | Sin rama | FALTA; request builder con nombre, owner, imagen y aislamiento debe conservarse; **no ejecutar** |
| `startContainer` | POST `/containers/{id}/start`, 204, body nulo | Admite bytes de longitud cero | PARCIAL: nueva representación, status, sin ejecución |
| `deleteContainer` | DELETE `/containers/{id}?force=1&v=1`, 204, body nulo | Admite bytes de longitud cero | PARCIAL: mismas restricciones de identidad/autorización; sin ejecución |
| `createExec` | POST `/containers/{id}/exec`, 201, `Id` SHA64, solo `READY_TCP` | Sin rama | FALTA allowlist de comando y validador |
| `inspectExec` | GET `/exec/{id}/json`, 200, `Running=false` y `ExitCode=0` | Valida ambos | PARCIAL: verificación independiente requerida |
| `startExec` | POST `/exec/{id}/start`, 200, multiplex stdout/stderr con parser binario | **Rechazo deliberado** | BLOQUEADO hasta parser binario con límites, framing correcto y vinculación a `inspectExec` |

En total: **13 operaciones legacy**; RAW v2 implementa solo un subconjunto y `startExec` está rechazado deliberadamente. El valor numérico de esta tabla no constituye certificado de cobertura.

## 3. Decisiones técnicas propuestas (no implementadas)

1. **Separar solicitudes de respuestas.** Conservar el constructor allowlisted de solicitudes como contrato lógico; no permitir URLs, rutas, comandos ni IDs construidos desde campos sin validar. Nunca habilitar conexión real en esta etapa.
2. **Reemplazar la frontera de respuesta, no duplicarla.** El futuro fake transport debe construir internamente un token opaco para cada respuesta a partir de texto/bytes controlados. El módulo de validación no aceptará envelopes de JS activos `{status,data}`, proxies o vistas externas como verdad.
3. **Definir media type cerrado por operación.** `ping` es texto plano exacto, las operaciones estructuradas son JSON estricto, `startExec` es binario multiplex; respuestas vacías solo cuando status/operación las autoricen. No intentar convertir todo indiscriminadamente con `JSON.parse`.
4. **Conservar el rechazo de JSON ambiguo.** Claves duplicadas detectadas antes de parsear, alias con escapes Unicode, límites de tamaño/profundidad/elementos, UTF-8 fatal, IDs/Warnings exhaustivos.
5. **NO usar `JSON.stringify` de objetos externos para fabricar evidencia.** Tests deben fijar strings JSON literales y hex/bytes capturados desde fixtures confiables. No hay transporte real todavía.
6. **Marcar intencionalmente faltantes**: version/imageInspect/inspectContainer/createContainer/createExec, y después `startExec` con parser separado, sin activar ninguno sobre Docker.
7. **Mantener los tests legacy como regresión histórica inmutable.** Portar su intención a negativos del nuevo contrato, no afirmar equivalencia porque cambie el número de casos. Conservar controles del pin PG17, red `none`, ausencia de puertos, permisos y salida fail-closed.
8. **Exigir evidencia por SHA y revisión independiente** antes de reemplazar exportaciones, cerrar hilos P2 o considerar D2 finalizado.

## 4. Plan por gates

| Gate | Entregable | Autorización / salida |
|---|---|---|
| M0 — Preparación | Este documento, matriz de operaciones, clasificación de brechas y plan QA | Preparación documental; sin reemplazar código |
| M1 — Paridad fake-only | Nuevo adaptador **aislado** de contrato de respuesta completo, `ping` texto plano, JSON estricto, binario todavía negado; exportaciones legacy sin modificar | Nueva revisión Codex, pruebas negativas y positivas offline |
| M2 — Paridad binaria fake-only | Parser multiplex independiente que conserve stdout/stderr/frame limits y resultado de `inspectExec`; fixture binario construido internamente, no vista externa | QA independiente de binario y regresiones por operación |
| M3 — Migración controlada | Sustituir/retirar la interfaz vulnerable `{status,data}` cuando toda la matriz y regresiones sean equivalentes; auditar imports y referencias | **Pedir autorización específica**, QA Windows y Codex clean; no hay permiso implícito por este plan |
| M4 — Infra real | Cualquier apertura de named pipe/Docker o contenedor y SQL requerirá autorizaciones separadas D4/D5 y evaluación de riesgos TOCTOU | BLOQUEADO por ahora |

## 5. Criterios de aceptación de la futura migración

- Mapa de 13/13 operaciones con control explícito (soportadas o fail-closed y documentadas), prueba de path/método/status/cuerpo para cada una; sin rutas dinámicas inesperadas.
- Regresiones de los 15 hilos históricos reproducidas o clasificadas como imposibles por construcción de la nueva frontera, con evidencia de código/test, no por declaración.
- Suite offline completa que incluya cuerpo vacío, texto plano `ping`, JSON malformado/duplicado, inventario truncado, getters/proxies en APIs públicas, SharedArrayBuffer, errores de status, reentrancia, multipart binario truncado/oversized y fallas de exit code.
- Verify cambios con git diff --check, lint/typecheck/build pertinentes al repositorio, pruebas de los scripts legacy y nuevos; no correr tests que disparen Docker/SQL o proveedores reales sin auditoría del comando.
- Revisión de Codex sobre commit exacto sin hallazgos bloqueantes y QA Windows verificada sobre el mismo código. Documentar exclusiones; **no cerrar P2 antiguos automáticamente**.
- Mantener PR DRAFT; no `merge`, Docker real, contenedores, hosted migration, Supabase ni SQL.

## 6. Riesgos no resueltos

- RAW v2 es un *mock de fixture primitivo*: **no implementa la frontera de confianza de un HTTP/Engine transport real**. El diseño seguro de recepción de streams, propiedad de buffers, respuesta cancelada y lifecycle exige una auditoría separada.
- `startExec` es una función sensible: el parser multiplex y la correlación con exit code son todavía pendientes de paridad.
- Los 15 P2 históricos no desaparecen por crear una implementación nueva si el código legacy sigue disponible e invocable.

**Decisión de esta etapa:** preparar la migración, no ejecutarla. `NO_GO_HOSTED_MIGRATION` continúa vigente.


## 7. Auditoría M0 reproducible (offline)

Se agregó `scripts/test-issue49-d2-migration-readiness.mjs`. Compara **13/13 descriptores de solicitudes legacy** sin enviarlos a ningún endpoint y confirma las brechas del contrato RAW v2, incluidos el formato incompatible de ping y el rechazo intencional de startExec. Clasificación reproducida: **6 PARCIALES, 5 AUSENTES, 1 PING INCOMPATIBLE y 1 BLOQUEADO**, total 13. Ejecutar únicamente con Node sobre los tres módulos copiados a un directorio temporal; no conecta Docker ni SQL. Verificación V8 offline (polyfill ASCII) del script M0 PASS, **Node Windows todavía pendiente**. Se requiere validar con SHA exacto antes de aceptar M0 como probado en Windows. Los 15 hilos P2 históricos siguen abiertos.


## M0 QA Windows y corrección del dictamen Codex (2026-11-06)

El operador confirmó el SHA `291243be63f104c5186eb55951eb7d1178abb53e`, ejecutó los tres `node --check` y la auditoría M0 en Windows con salidas `PASS ISSUE49 D2 M0: 13/13 legacy request descriptors audited offline`, `PASS ISSUE49 D2 M0: RAW v2 gaps identified, ping incompatibility reproduced` y `NOT_READY_FOR_MIGRATION / FAKE_ONLY / NO_GO_HOSTED_MIGRATION`. Este PASS corresponde **solo a la versión previa de la prueba**.

Codex revisó ese SHA y encontró un P2: la auditoría solo comprobaba fragmentos de rutas, método y estado, pero no el cuerpo completo; no detectaba cambios inseguros como `NetworkMode: 'host'`, `Privileged: true`, `all=0` o comandos distintos de `READY_TCP`. Se corrigió `scripts/test-issue49-d2-migration-readiness.mjs` para comparar **13 rutas completas, cuerpos íntegros, método y estado esperados**, además del digest fijo de imagen, etiquetas del propietario, bloqueo de puertos, red `none`, privilegios falsos y comando cerrado de `pg_isready`. Corrigió también el índice de clasificación tras ampliar las columnas de escenarios. **V8 offline del nuevo script PASS, pero QA Node Windows actualizado todavía pendiente**; no atribuir el PASS anterior al cambio nuevo. Mantener el hilo P2 abierto hasta revisión de Codex y QA del mismo SHA.

La corrección editorial oficial `FanView → Fanvue` se documenta por separado en el [issue #51](https://github.com/xlordzocox-cyber/Raxisocialmedia/issues/51), sin reemplazo automático de enums o datos. No altera los contratos PostgreSQL de esta auditoría. No SQL/Docker/transport ejecutado.
