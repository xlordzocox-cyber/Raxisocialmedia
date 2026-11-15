# Raxi HQ · Issue #49 — contrato SQL candidato del piloto REAL Director

**ESTADO:** Propuesta en `supabase/proposals/`, **NO** en `supabase/migrations/`. Sin efectos sobre staging ni producción. La única cuenta humana es el propietario; una sesión distinta de la misma cuenta solo puede revocar.

## Justificación y límite de confianza

En staging, `raxi_supervised_prepare` y el host existente **solo admiten `simulated`**. No se cambia ese contrato. El nuevo SQL solo crea una tarea `DIRECTOR_REAL_PILOT_NOT_EXECUTABLE` con `raxi_agent_tasks.status='WAITING_APPROVAL'`; ni `runOne` ni el host existente pueden reclamarla por su camino de simulación.

La propuesta reutiliza `raxi_workspaces`, `raxi_agent_tasks`, `raxi_runtime_policies` y `raxi_approvals` existentes. Crea una sola tabla de *gate* `raxi_director_real_pilots`, sus restricciones y funciones server-only. **No modifica migraciones ni funciones existentes.**

| Contrato | Efecto permitido |
| --- | --- |
| `raxi_director_real_prepare(identity,key,spec,version)` | Comprueba sesión real de staging por `raxi_supervised_host_identity`, dueño, versión de política REAL y texto sin investigación; persiste tarea WAITING_APPROVAL y scope SHA; cero llamadas a IA |
| `raxi_director_real_approve(identity,task,key,scope,confirmed)` | Segunda confirmación humana explícita por el host (no generada por un agente). En transacción atómica, comprueba sesión, tarea, scope, política/budget; inserta aprobación `TASK` inmutable, reserva `per_call_micros` y marca gate preparado, **sin poner el task en QUEUED** |
| `raxi_director_real_read(identity,task)` | Proyección canónica *solo servicio* para el inspector de código PR #74; sin claves, lease, worker o habilitación de ejecución |
| `raxi_director_real_revoke(identity,task,key)` | Revocación por cualquier sesión autenticada del **mismo owner**, con historial TASK `CANCELED` y estado REVOKED; presupuesto previamente reservado **no se reembolsa automáticamente** |
| `raxi_director_real_scope(...)` | SHA-256 del JSON UTF-8 con orden de campos idéntico al `scopeDigest()` del PR #74; la fecha `expiresAt` se conserva como el mismo string |

La aprobación editorial de Strategy **no** satisface la segunda aprobación de ejecución. El parámetro `p_confirmed=true` **no es por sí mismo prueba de un clic humano**; un futuro host confiable deberá producirlo solo después de una confirmación interactiva verificada, con protección anti-CSRF/rate, verificación de identidad y auditoría. El servicio utiliza `service_role` exclusivamente en servidor, y el `p_identity` lo construye una verificación JWT + sesión auténtica; no aceptar el JSON de identidad directamente desde el navegador.

## Límites intencionales del piloto

- **Un solo Director / una llamada / sin Investigador automático.** Política `simulated=false`, `max_tasks=1`, `max_output_tokens<=256`, vencimiento del permiso como máximo 24 h; no hay cron ni trabajo nocturno.
- Se exige presupuesto y reserva persistente, pero una reserva SQL **no garantiza un límite de facturación externo**. Falta cotización oficial fresca, medición de tokens reales, validación del payload exacto, cuota del proveedor, parada y recibo de coste. `pilotBudget.ts` está vencido y NO se usa.
- **No hay dispatch**. La tarea se conserva como `WAITING_APPROVAL` incluso tras aprobar el gate. No hay `runOne`, `raxi_runtime_claim`, `raxi_runtime_step`, journal operativo, eventos `AGENT_EXECUTOR VERIFIED` ni movimiento Pixi; son futuros incrementos sujetos a autorización independiente.
- El `read()` del gate no es una credencial de ejecución. La operación de despacho futura necesitará un **commit transaccional** que vuelva a comprobar sesión, aprobación, política, reserva, estado, lease e idempotencia justo antes del proveedor; nunca ejecutar solo por una respuesta de `read()`.
- Revocación **antes de dispatch** no garantiza interrumpir una llamada ya enviada; el journal deberá conservar recibos/costes de efectos inciertos. No reintentos pagados automáticos.
- RLS activado en tabla nueva, ACL de `anon`/`authenticated` revocadas para tabla y funciones, servicio único. La función de identidad existente conserva chequeos sobre `auth.sessions`, propiedad y vigencia.

## Evidencia prevista en PostgreSQL 17 aislado

Workflow `raxi-hq-issue49-director-pg17.yml` inicia `postgres:17` en Docker con `--network none`, sin puertos publicados, base desechable en tmpfs y credenciales solo de fixture. Ejecuta:

1. `apps/raxi-hq/tests/pg17/issue49_director_real_fixture.sql`: esquema **mínimo sintético**, que reproduce exclusivamente las columnas/restricciones utilizadas por el contrato. No es un dump de staging ni una prueba de paridad completa del catálogo.
2. `supabase/proposals/issue49_director_real_sql.candidate.sql`: DDL y funciones solo dentro del contenedor.
3. `apps/raxi-hq/tests/pg17/issue49_director_real_qa.sql`: tests positivos y negativos de owner/sesión, inyección, rol de navegador, digest SHA JS↔PG17, idempotencia, confirmación explícita, presupuesto y versión, lectura de gate, revocación desde otra sesión del mismo propietario, inmutabilidad.

**Los tests del SQL aislado no acreditan E2E con JWT hospedado, performance, contención en conexiones independientes, paridad completa del esquema staging, ni que el cliente SDK del PR #74 ya lea este contrato.**

## Puertas pendientes antes de cualquier efecto real

1. CI nativo PostgreSQL 17 **PASS** y auditoría independiente de SQL, permisos e idempotencia. Revisar también PR #74 por separado; no fusionar nada automáticamente.
2. Prueba de **paridad completa del esquema real y migraciones autorizadas**, incluyendo triggers/ACL reales de TASK, reproducibilidad desde PG17, concurrencia de múltiples conexiones y reversión. Preparar migración candidata auditada — **no aplicar remoto hasta autorización específica**.
3. Host Node protegido con rate limiter persistente, JWT propietario, sesión revocada E2E en staging, snapshot canónico y precio oficial del modelo; contar la aprobación humana por acción, no por texto del modelo.
4. Obtener **aprobación humana específica** del proveedor/modelo disponible, costo máximo y fecha, despliegue de SHA exacto y plan de rollback. Solo entonces preparar despacho/recibos reales, sin activar investigador ni publicidad.
5. Integrar eventos reales a Pixi exclusivamente desde evidencia duradera `AGENT_EXECUTOR / VERIFIED / simulated=false`. Sin evidencia, estado quieto.

La existencia de este SQL **no** autoriza nuevas cuentas, secretos, cambios a campañas existentes, proveedores, consumos, despliegues, trabajo nocturno ni producción.
