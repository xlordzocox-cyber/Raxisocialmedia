# Issue #60 — Primer incremento de movimiento por evento REAL confirmado

**Estado:** desarrollo aislado de proyección visual. PR DRAFT. No se ha desplegado un runtime real ni generado una ejecución.

## Base verificable

- Main de partida: `af4187a81c79a4c44334243b893c2f44c5bcfe0a` (PR #57).
- El runtime alojado **no** expone `raxi_runtime_office` en staging; `RuntimeOfficePanel` queda deshabilitado.
- La oficina ya usa `OfficeScene`, `AgentMotion` y `destinationZone` para rutas Pixi, sin paseo aleatorio.
- `projectRuntime` conserva exclusivamente eventos reales del servidor marcados `AGENT_EXECUTOR / VERIFIED / simulated=false`. No se debe suponer que un snapshot de prueba sea trabajo real.

## Comportamiento de este incremento

Al recibir un **nuevo** evento `TASK_ASSIGNED` derivado de `RUNTIME_DISPATCH_AUTHORIZED`, o un `TASK_STARTED` derivado de `RUNTIME_ACKNOWLEDGED`, solo cuando:

1. Ya existía una lectura conectada del mismo runtime; no hay reconstrucción de historial en primera carga o reconexión.
2. El evento está confirmado, no simulado, pertenece al runtime y no se había observado antes.
3. La tarea y el agente coinciden, la lease sigue vigente, y el estado es **`QUEUED/WAITING` para despacho** o `RUNNING/RUNNING` para ACK. Un despacho solo indica autorización; no significa que el proveedor esté procesando.
4. El personaje no existía antes en el estado visual (evita teletransportar un sprite que ya está trabajando).

...se añade **únicamente una ruta visual** del área de recepción del trabajo al lugar del agente: `GITHUB_HUB -> WAR_ROOM` (Director) y `WAR_ROOM -> RESEARCH_LAB` (Investigador). Se reutiliza el motor de movimiento existente.

**Interpretación:** esas áreas iniciales son una convención visual de oficina; no representan una ubicación física reportada por un agente. No se crea un evento, recibo, handoff, tarea, permiso ni ejecución. La UI no afirma que un viaje virtual pruebe trabajo real. En el siguiente snapshot no se reinicia la ruta.

## Propuesta mínima de recibo temprano (NO desplegada)

`supabase/proposals/issue60_runtime_dispatch_receipt.sql` agrega un trigger **AFTER UPDATE** de `dispatch_authorized_at` a la propuesta de runtime existente. En una única transacción del `step('dispatch')` genera el evento `RUNTIME_DISPATCH_AUTHORIZED` y un evento auditado. No genera tareas ni ejecuta proveedores; las filas se revierten si la autorización/actualización se revierte. Las filas llevan `providerAcknowledged=false` y `operationalReceiptOnly=true`. Cuando la consulta `raxi_runtime_office` pública lee un despacho auténtico, el adaptador lo traduce a **`TASK_ASSIGNED` + agente `WAITING`** (NO `RUNNING`) y representa un desplazamiento autorizado a la zona de trabajo. Si la llamada se completa después, ACK y resultado son eventos separados.

Este SQL sigue siendo **propuesta independiente**, para no cambiar el checksum del antiguo `agent_runtime.sql` ni el manifiesto. Necesita ensayo físico PG17 y auditoría del permiso que dispara el trigger antes de su adopción.

## Restricción importante detectada

En la propuesta SQL de runtime vigente, `runOne()` llama `step('dispatch')` **antes** de invocar el adaptador, pero ese paso no emite un evento público. La RPC registra `RUNTIME_ACKNOWLEDGED` **después** de que el proveedor responde, y luego `RUNTIME_RESULT_COMMITTED`. El nuevo recibo de despacho permitiría visualizar la transición antes de la llamada al proveedor si existe una lectura durante la ventana de ejecución. Si el trabajo se completa íntegramente entre dos lecturas (polling de 5s), la oficina seguirá sin animar el historial como si sucediera ahora, de manera intencional.

**No presentar esta propuesta como prueba de ejecución real ni garantía de movimiento visible durante la llamada al modelo.** La incorporación de un recibo de despacho no confirma la entrada al adaptador ni la recepción del proveedor. Mantener diferenciadas autorización, despacho, inicio comprobado, recibo de proveedor y terminación.

## Pruebas incluidas

- Evento de despacho o ACK nuevo, verificado, lease vigente y coincidencia de tarea => ruta `AgentMotion` determinista.
- Despacho `WAITING`/`QUEUED` sin afirmar proveedor activo; rechazo si `phase` o `providerAcknowledged` no cuadran.
- Propuesta SQL de trigger: recibo y auditoría en una sola transacción, sin acuse del proveedor y sin duplicados.
- Primera carga / historial => sin caminata retrospectiva.
- Refresco repetido => sin reiniciar ruta.
- Tarea completada en el mismo snapshot => sin fingir actividad.
- Lease expirado => sin movimiento.
- Simulación y evento no verificado => sin agente en la proyección.
- Fuente desconectada => sin movimiento.
- Agente ya existente => sin teletransporte.

**Pendiente de QA ejecutada:** tests completos, typecheck, build y revisión independiente en worktree del SHA final. La edición se realizó por GitHub; no se ha ejecutado el proyecto localmente.

## Gates siguientes (separados)

1. Completar revisión de seguridad y estado exacto del PR #59.
2. Implementar/desplegar primero, con aprobación individual, RPC/host de runtime auténtico y evento durable de inicio de despacho.
3. Autorizar por separado una sola ejecución READ_ONLY con proveedor/modelo, presupuesto y vencimiento explícitos.
4. Validar en staging eventos genuinos, movimiento Pixi, detención, reconexión, revocación, 0 efectos de Aria y 0 publicaciones.
5. Solo con evidencia real, considerar integración y despliegue.

**NO-GO:** ningún SQL en remoto, Edge, runtime, proveedor, llamada facturable, publicación, tarea nocturna, ni merge está autorizado por este documento.
