# Issue #60 — Primer incremento de movimiento por evento REAL confirmado

**Estado:** desarrollo aislado de proyección visual. PR DRAFT. No se ha desplegado un runtime real ni generado una ejecución.

## Base verificable

- Main de partida: `af4187a81c79a4c44334243b893c2f44c5bcfe0a` (PR #57).
- El runtime alojado **no** expone `raxi_runtime_office` en staging; `RuntimeOfficePanel` queda deshabilitado.
- La oficina ya usa `OfficeScene`, `AgentMotion` y `destinationZone` para rutas Pixi, sin paseo aleatorio.
- `projectRuntime` conserva exclusivamente eventos reales del servidor marcados `AGENT_EXECUTOR / VERIFIED / simulated=false`. No se debe suponer que un snapshot de prueba sea trabajo real.

## Comportamiento de este incremento

Al recibir un **nuevo** evento `TASK_STARTED` derivado de `RUNTIME_ACKNOWLEDGED`, solo cuando:

1. Ya existía una lectura conectada del mismo runtime; no hay reconstrucción de historial en primera carga o reconexión.
2. El evento está confirmado, no simulado, pertenece al runtime y no se había observado antes.
3. La tarea y el agente coinciden, ambos siguen en `RUNNING` y la validación previa de lease sigue vigente.
4. El personaje no existía antes en el estado visual (evita teletransportar un sprite que ya está trabajando).

...se añade **únicamente una ruta visual** del área de recepción del trabajo al lugar del agente: `GITHUB_HUB -> WAR_ROOM` (Director) y `WAR_ROOM -> RESEARCH_LAB` (Investigador). Se reutiliza el motor de movimiento existente.

**Interpretación:** esas áreas iniciales son una convención visual de oficina; no representan una ubicación física reportada por un agente. No se crea un evento, recibo, handoff, tarea, permiso ni ejecución. La UI no afirma que un viaje virtual pruebe trabajo real. En el siguiente snapshot no se reinicia la ruta.

## Restricción importante detectada

En la propuesta SQL de runtime vigente, `runOne()` llama `step('dispatch')` **antes** de invocar el adaptador, pero ese paso no emite un evento público. La RPC registra `RUNTIME_ACKNOWLEDGED` **después** de que el proveedor responde, y luego `RUNTIME_RESULT_COMMITTED`. Por eso, si el trabajo concluye entre dos lecturas (polling de 5s), un agente real puede terminar sin mostrar una caminata.

**No presentar este incremento como prueba de ejecución real ni garantía de movimiento visible durante la llamada al modelo.** Una siguiente fase debe introducir una transición de despacho persistida y semánticamente honesta (por ejemplo, `DISPATCH_AUTHORIZED`, solo si pasó la autorización y no afirmar `PROVIDER_RUNNING` sin su evidencia) antes de habilitar el runtime alojado. Separar autorización, despacho, comienzo confirmado, recibo y terminación.

## Pruebas incluidas

- Evento nuevo, verificado, lease vigente y coincidencia de tarea => ruta `AgentMotion` determinista.
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
