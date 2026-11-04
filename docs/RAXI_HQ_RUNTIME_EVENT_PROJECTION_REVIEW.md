# Raxi HQ — Auditoría de clasificación de eventos de RuntimeOfficeStore

Estado: **correctivo de proyección visual, para revisión; no desplegado**. Base: `eb3ef309fb5ec42c13393e465df14e9aaf656fe8`.

## Problema confirmado en main

`projectRuntime` trataba todos los eventos distintos de `RUNTIME_ACKNOWLEDGED` y `RUNTIME_RESULT_COMMITTED` como `AGENT_BLOCKED`. El productor SQL actual registra `RUNTIME_OUTCOME_UNKNOWN` y `RUNTIME_LEASE_UNKNOWN` para efectos inciertos que requieren reconciliación. Una entrada desconocida no acredita un bloqueo concreto ni una falla del agente. El frontend también sustituía por `BLOCKED` el estado proyectado de una tarea `RUNNING` cuyo lease ya no acreditaba actividad vigente.

## Corrección acotada

- Matriz visual cerrada: `RUNTIME_ACKNOWLEDGED → TASK_STARTED` y `RUNTIME_RESULT_COMMITTED → TASK_COMPLETED`. Eventos `RUNTIME_OUTCOME_UNKNOWN`, `RUNTIME_LEASE_UNKNOWN` o futuros no se reinterpretan como `AGENT_BLOCKED`. Se excluyen del flujo `HQEvent` visual, **no se eliminan de PostgreSQL**.
- En la proyección `HQState.tasks`, una tarea recibida `RUNNING` sin lease válido se etiqueta `UNCONFIRMED`, no `BLOCKED`. El valor original permanece en `RuntimeOfficeStore.tasks`, que alimenta el listado de tareas original. `UNCONFIRMED` es descriptivo, nunca una autorización para reintentar o una declaración de fallo.
- El estado `BLOCKED` que **sí llega declarado por el servidor** permanece como tal. El SQL `raxi_runtime_office` puede presentar `BLOCKED` para un `RUNNING` antiguo; esta corrección no altera el SQL ni su semántica. Antes de integrar el runtime como fuente de P3B hay que examinar por separado esa derivación y el modelo de evidencia.
- No se deducen aprobaciones, recibos de proveedor, resultados o permisos a partir de eventos visuales. Ningún ejecutor/proveedor es activado.

## Comprobación esperada

Regresiones añadidas en `apps/raxi-hq/tests/agentRuntime.test.ts`: variantes inciertas/futuras, combinación ACK+incierto, lease válido/vencido, preservación del estado original y resultado completado.

Ejecutar en un worktree aislado con las autorizaciones apropiadas: suite focalizada del runtime, suite completa y staging guard offline, `npm run typecheck`, `npm run build`, `git diff --check`, escaneo de secretos, QA visual y revisión independiente de Codex sobre el HEAD publicado.

**Límite de evidencia:** cambios enviados mediante el conector GitHub; en este entorno no se pudo instalar dependencias ni ejecutar la suite de aplicación contra el repositorio completo. No declarar pruebas PASS sin ejecución real. Solo proyección; `RuntimeOfficePanel`, SQL, Auth, RLS, migraciones, P3A/P3B, Guardian, `MemoryArchiveEffect` y PR #39 permanecen intactos. Sin merge/despliegue.
