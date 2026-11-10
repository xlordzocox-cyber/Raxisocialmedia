# PR #59 — Primera habilitación supervisada de Raxi HQ en staging

**Estado de este documento: plan ejecutable pendiente de QA y autorización. Ningún SQL remoto, deploy ni cambio de credenciales se ejecutó al escribirlo.** No sustituye aprobación humana del operador ni las restricciones del manifiesto existente.

## Objetivo único del piloto

Tomar **CAMPAIGN-001** (provenance `REAL`, `PLANNING`), Strategy **rev. 1** (`APPROVED`), entregable **STRATEGY-ITEM-001** (`INSTAGRAM_FEED` / `PUBLIC_SOCIAL` / `PHOTO`, cantidad 1) y producir exactamente un recibo `SUPERVISED_CAMPAIGN_REQUESTED` con autorización `PENDING_HUMAN_EXECUTION_AUTH` tras una confirmación manual explícita. **No** crear agentes, jobs, assets, generación, publicación ni gastos.

### Inventario hospedado confirmado por lecturas 2026-11-09

- Staging: `zvhxjindgyvtasstfjut`, PostgreSQL **17.11**, cinco migraciones aplicadas; `create-real-idea` y `campaign-command` activos con `verify_jwt=true`. No tocar producción `jrkefsylpfriiqefcmzq`.
- `raxi_supervised_host_identity` y todas las `raxi_supervised_%` **ausentes** del esquema hospedado. El SQL del puente **no se puede ejecutar primero**: necesita identidad alojada.
- Existen `auth.sessions(id,user_id,not_after)`, `auth.users(id,is_anonymous)`, workspace propietario, tabla audit con RLS. `service_role` ya puede leer workspaces, pero no tiene SELECT sobre `auth.sessions` y `auth.users`; la propuesta específica añade **sólo esos grants de columnas**.
- Hay 10 registros audit históricos, pero **0** `SUPERVISED_CAMPAIGN_REQUESTED`.
- Manifiesto de staging previo señala `executionReady=false`, `sqlApplied=false`, y no autoriza por sí solo despliegue. **No reinterpretar una lectura del plan como cambio de permisos.**

## Nuevos archivos de preparación

1. `supabase/proposals/supervised_campaign_staging_identity.sql`: identidad **mínima e independiente** de Stage A/B de agentes, fijada a ref exacta de staging. Invoker, roles explícitos, sesión vigente/no anónima y propietario de workspace. No expone tareas ni provee ejecución.
2. `supabase/proposals/supervised_campaign_requests.sql`: recibos inmutables, tamaño y rate limiting distribuido ya probados en PostgreSQL 17 nativo sintético, pero no instalados alojados.
3. `supabase/functions/supervised-campaign-request/handler.ts`: borde HTTP con orígenes cerrados, métodos y operación `x-raxi-operation` (`preflight` o `submit`) estrictos; modo `DISABLED` por defecto.
4. `supabase/functions/supervised-campaign-request/index.ts`: fija URL exacta de staging y usa clientes separados para `auth.getClaims`/`getUser` y `service_role` (nunca enviados al navegador). Sólo crea clientes cuando `RAXI_SUPERVISED_REQUESTS_ENABLED=true`.
5. `server/agent-runtime/supervisedCampaignEdge.ts` y `apps/raxi-hq/scripts/build-supervised-campaign-function.mjs`: generación reproducible de bundle `supabase/functions/_shared/supervised-campaign-domain.js` a partir del dominio existente. **El bundle generado debe ser creado, auditado y fijado en Git antes de un deploy.**
6. `apps/raxi-hq/src/persistence/SupervisedCampaignPilot.tsx`: controla el piloto manual de dos pasos desde el Centro de Campañas. Por defecto oculto/inactivo si `VITE_RAXI_SUPERVISED_REQUESTS_ENABLED` no es `true` o la URL no coincide con staging. Retiene la misma clave en memoria si el envío resulta incierto; no afirma un `REQUESTED` sin recibo validado. Reinicia el estado al cambiar usuario/workspace.
7. `supabase/config.toml`: el gateway de la nueva Edge Function requiere JWT.

## QA obligatoria antes del primer cambio alojado

- Worktree de QA nuevo y **SHA exacto**; `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=moderate`, `git diff --check`.
- `npm run build:supervised-function`, luego `npm run check:supervised-function` y revisión del bundle. No dar por deployable un archivo `_shared/supervised-campaign-domain.js` inexistente.
- Pruebas negativas PGlite del RPC de identidad de staging y del borde HTTP antes de habilitar nada.
- Revisar estáticamente (independiente) la frontera `service_role`/JWT/origin/CORS/rate limit + posibilidad de bypass de commit SQL privilegiado.
- Ensayo de validación **sin desplegar** de composición de los dos SQL en entorno nuevo con roles Auth reales simulados. Evitar re-preparar los cuatro Docker labs anteriores.

## Secuencia hospedada propuesta (NO EJECUTADA)

Sólo tras autorización separada sobre **el SHA final, SQL exacto y plan de rollback**:

1. Confirmar proyecto `zvhxjindgyvtasstfjut` y respaldos/estado actual; verificar que no exista identidad ni solicitudes supervisadas hospedadas. Fijar hashes de ambos SQL.
2. Preparar/aplicar migración de identidad mínima **sólo staging**; verificar RPC `anon`/`authenticated` denegada, `service_role` con sesión válida, inválida y revocada. `service_role` nunca se expone en frontend.
3. Aplicar propuesta de recibos/rate limiter con **un plan transaccional revisado**, comprobar grants, RLS, índices parciales y triggers. Corregir errores sin reintentar destructivamente; no añadir acciones a agent runtime.
4. Desplegar sólo la Edge Function `supervised-campaign-request` **desactivada por defecto**, con JWT habilitado y origin allowlist explícita; comprobar 503 `DISABLED` y ninguna solicitud en audit. NO utilizar `--no-verify-jwt`.
5. Autorizar/habilitar explícitamente el flag privado de staging `RAXI_SUPERVISED_REQUESTS_ENABLED=true`, el control de ingreso pre-Auth y el flag del cliente `VITE_RAXI_SUPERVISED_REQUESTS_ENABLED=true` únicamente después de pruebas de sesión JWT firmada, usuario ajeno, 429, 503, revocación y `origin` ajeno.
6. Con sesión REAL de usuario, realizar `preflight` en `CAMPAIGN-001`; confirmar manualmente; ejecutar **un** `submit`; verificar en staging exactamente un recibo `REQUESTED` y **cero** nuevas tareas/assets/publicaciones/jobs. Si hay 503 o respuesta incierta, recuperar **la misma** `requestKey` antes de permitir crear otra.
7. Rollback: **deshabilitar flags y ruta primero**, comprobar que la UI no habilite acciones. No borrar recibos inmutables ni retirar migraciones con datos audit existentes; cualquier reversión SQL requiere inspección previa y plan de preservación de evidencia.

## Reglas para evitar otro ciclo infinito de QA

No crear una campaña demo adicional ni un dashboard de métricas antes del primer recibo. El primer valor de negocio es revisar, confirmar y **recibir una solicitud supervisada real de staging sin ejecución**. Conservar la auditoría existente y monitorizar inicialmente vía agregaciones SQL/Edge logs. Sólo implementar mejoras adicionales si bloquean una prueba verificable del primer piloto.
