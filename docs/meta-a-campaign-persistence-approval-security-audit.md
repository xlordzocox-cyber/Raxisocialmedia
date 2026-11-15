# Raxi HQ / Meta A — auditoría offline de persistencia y aprobaciones
Fecha: 2026-11-06. Naturaleza: **inspección estática, sin ejecución, sin escrituras y sin autorización para desplegar**.

## Alcance y evidencia

Código inspeccionado en GitHub `main` (`e7bb31adb04fd5a22b10120e45a4fcef7c96c863` según base del PR #50):
- `supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql` (168 líneas, pendiente)
- `supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql` (políticas RLS y esquema base)
- `supabase/functions/campaign-command/handler.ts` y `index.ts`
- `apps/raxi-hq/src/persistence/{campaignCommands,realCampaignStore}.ts`, `RealCampaignCenter.tsx`
- `apps/raxi-hq/tests/realCampaignPersistence.test.tsx`, `campaignDatabase.ts`
- `apps/raxi-hq/scripts/build-campaign-function.mjs`

Inventario mediante operaciones Supabase de **solo lectura**:
- Proyecto principal `raxi-hq`: PostgreSQL 17.11, cuatro migraciones registradas (20261019030541/30659/30808/19231655), **sin** migración `20261020234358`. Edge activa `create-real-idea`; **no** `campaign-command`. 18 tablas públicas `raxi_*`, todas reportadas con RLS.
- Proyecto `raxi-hq-staging`: PostgreSQL 17.11 activo, **sin migraciones**, sin tablas públicas `raxi_*` y sin Edge Functions según inventario.
- No se invocaron RPC de escritura ni se realizaron consultas a datos privados o pruebas de sesión real.

Fuentes profesionales de contraste:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/auth-headers

## Controles implementados (confirmados en código, aún no verificados remotamente)

1. **Autenticación Edge**: `handler.ts:15-20` exige Bearer, `index.ts:7` valida token mediante `auth.getUser(token)` y rechaza usuarios anónimos. `handler.ts:21-27` acota tamaño a 100 KB y valida JSON UTF-8 y contrato de comando.
2. **Estado canónico**: `handler.ts:28-34` lee snapshot del backend, ejecuta `applyCampaignOperation` del bundle compartido, hace `commit` y valida snapshot confirmado. `build-campaign-function.mjs` compara bundle generado frente al contrato TypeScript.
3. **Autorización SQL**: migración propuesta `:8-16` crea snapshot como `SECURITY INVOKER` y verifica propietario; `:59-73` restringe el commit a workspace de `p_actor` y `:165-167` revoca `EXECUTE` de `PUBLIC/anon/authenticated`, concediéndolo solo a `service_role`. El servicio Edge usa clave privilegiada solo en entorno servidor (`index.ts:5-9`).
4. **Consistencia e historial**: `commit:72-79` usa bloqueo `FOR UPDATE`, deduplicación por operationId, comparación exacta del comando y CAS de versión; restricciones de aprobación e inmutabilidad `:30-57`, y auditoría `:151-163`.
5. **UX fail-closed**: `realCampaignStore.ts` no da por confirmada una escritura sin recibo y versión válida; `RealCampaignCenter.tsx` deshabilita acciones cuando el servicio no está disponible.
6. **Pruebas existentes**: `realCampaignPersistence.test.tsx` cubre PGlite local, secuencia idea→campaña→strategy, revisión, aprobación, idempotencia, escenario de rol autenticado y fallos. **La existencia de estas pruebas no certifica un PASS reciente en Windows ni su equivalencia con Supabase PG17 remoto.**

## Hallazgos, severidad y pasos verificables

### B-01 — BLOQUEANTE DE DISPONIBILIDAD (confirmado)
La migración de campañas y la Edge `campaign-command` **no están desplegadas** ni en proyecto principal ni en staging. `realCampaignStore.ts` lee `raxi_campaign_snapshot` y llama `campaign-command`; su ruta real no puede declararse funcional actualmente.
**Acción**: no desplegar por esta auditoría. Validar migración en copia local PG17 aislada y luego pedir autorización **separada y específica** para staging, no para principal. Pasar checklist de Auth/RLS e integración Edge antes de activar Meta A.

### B-02 — BLOQUEANTE DE SEGURIDAD/QA (riesgo pendiente de demostrar)
`raxi_campaign_commit(p_actor, p_command, p_next)` recibe `p_next` completo desde una identidad **privilegiada** y reproduce partes de esa proyección en bucles JSON (`:85-159`). El Edge reconstruye y valida la proyección, pero para demostrar **defensa en profundidad** falta una matriz negativa independiente que inyecte directamente a la RPC, bajo servicio de pruebas, proyecciones manipuladas: entradas omitidas/duplicadas, decisiones históricas alteradas, estrategias agregadas, falsificación de eventos, transiciones mezcladas y referencias cruzadas. La función comprueba varios aspectos, pero esta auditoría **no prueba una vulnerabilidad de escalamiento** ni que todas las formas sean rechazadas.
**Acción**: ejecutar pruebas negativas en local PG17 aislado (con consentimiento separado para recursos locales), verificar que cada rechazo conserve estado/auditoría/revisión y que el recibo idempotente sea canónico. No aceptar respuestas de una RPC mock como prueba de esa propiedad.

### B-03 — RIESGO DE PERMISOS (pendiente de validación real)
`index.ts` usa cliente `service_role`, que puede sobrepasar RLS; `p_actor` es pasado desde `auth.getUser`. Por diseño la seguridad depende de que la función Edge nunca acepte `p_actor` suministrado por el cliente y de que su secreto no sea accesible desde navegador/logs. Se comprobó la selección en el código, **no** la configuración final de `verify_jwt`, permisos de esquema, revocación por sesión o aislamiento real entre dos usuarios.
**Acción**: revisar configuración efectiva del despliegue de pruebas, verificar `verify_jwt=true`, grants de RPC y probar 401/403 (incluido anónimo, sesión revocada, workspace ajeno) con dos identidades de staging. No incluir ningún secreto en logs ni evidencia.

### B-04 — RIESGO DE INTEGRIDAD/OPERACIÓN (pendiente)
La protección de inmutabilidad y el CAS existen en SQL, pero falta demostrar en PG17 objetivo rollback transaccional, casos concurrentes, respuesta perdida y reintento exacto en entorno separado. El harness actual `campaignDatabase.ts` usa `@electric-sql/pglite` y crea una simulación de roles/Auth; no equivale por sí solo a la configuración de PostgreSQL/Supabase desplegado.
**Acción**: suite nativa PostgreSQL 17 con dos conexiones independientes, pruebas negativas de usuario y de reintento, esquema/roles equivalente a staging, `ROLLBACK` y verificación de no persistencia; revisión independiente de resultados.

### B-05 — MEJORA DE ENDURECIMIENTO (no bloqueante por sí sola)
`handler.ts:11` usa `Access-Control-Allow-Origin: *` para una ruta que exige Bearer y autentica servidor. No implica por sí solo acceso no autorizado con JWT, pero si la política de producto exige restringir orígenes del navegador, conviene una allowlist y pruebas de preflight. No sustituye autorización por identidad.

## Matriz mínima de aceptación para Meta A

| Control | Evidencia necesaria | Estado |
| --- | --- | --- |
| Snapshot RPC y commit desplegados en staging autorizado | Inventario de migración, grants, función | NO |
| Lectura owner vs no-owner, anon y sesión invalidada | Pruebas autenticadas de dos identidades | PENDIENTE |
| Ideas manuales, entrega a operaciones, campaña | Persistencia confirmada tras recarga | PENDIENTE |
| Strategy DRAFT/IN_REVIEW/APPROVED y solicitud de cambios | Revisiones y aprobaciones inmutables | PENDIENTE |
| Idempotencia, CAS, rollback, errores de red | Doble solicitud, concurrencia y evidencia DB | PENDIENTE |
| Identidad y auditoría por operación | operación, propietario, decisión y recibo concordantes | PENDIENTE |
| Bloqueo de proveedor externo y publicación | Ninguna ejecución externa implícita | PENDIENTE |

## Dictamen y límites

**NO_GO_CAMPAIGN_PERSISTENCE_DEPLOYMENT** hasta completar B-02/B-03/B-04, revisar B-01 y obtener autorización de staging. No existe evidencia de que el componente esté operando con campañas reales. La prioridad **Meta A** (oficina utilizable con supervisión humana) está aprobada, pero **no** autoriza instalar SQL/Edge, crear usuarios, migrar datos, utilizar credenciales, ejecutar Docker o fusionar PRs. Mantener PR #50 (16 P2 históricos D2) separado de esta decisión de producto; sus hallazgos no se declaran resueltos por este documento.

Siguiente acción más pequeña: crear un paquete de QA local **offline y revisable** con casos negativos sobre la RPC candidata y el handler, sin modificar ni desplegar servicios. Revisión Codex independiente después del paquete; cualquier ejecución que cree recursos PG17 requiere aprobación específica.
