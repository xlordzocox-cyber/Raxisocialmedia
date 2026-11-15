# Raxi HQ · Issue #49 — Director REAL readiness host (sin publicar)

**Estado: diseño implementado como código Node interno, sin endpoint montado y sin proveedor.** Continúa a PR #77, que instaló la migración `20261115040235` únicamente en `raxi-hq-staging`. Este incremento **NO** modifica SQL, migrations, credenciales, UI ni despliega.

## Qué existe

- `server/agent-runtime/stagingDirectorReadiness.ts`: manejador HTTP *aún no montado*, acepta únicamente `POST` con JSON cerrado `{workspaceId,taskId}` (máximo 512 bytes). Rechaza `action`, `confirmed`, proveedor, presupuesto u otros campos. No prepara, aprueba, revoca ni ejecuta tareas.
- `apps/raxi-hq/server/stagingDirectorNodeGate.ts`: composición Node con **dos clientes Supabase independientes** y sin persistir sesión; verifica `getClaims`, `getUser`, `raxi_supervised_host_identity` cada petición, antes y después de consultar DB. Comprueba el proyecto exacto staging `zvhxjindgyvtasstfjut` y claves separadas. El cliente `service_role` expone solo RPCs permitidas: identidad, `raxi_supervised_request_rate_admit` y `raxi_director_real_read`.
- `apps/raxi-hq/server/stagingNodeAuthIngress.ts`: reutiliza *sin cambiar la ruta previa* el control de origen de preview HTTPS, política same-origin, rateKey de contexto confiable y limitador de **preautenticación** inyectado, pero solo permite un segundo path cerrado `/api/raxi-hq/director-real-readiness`. No hay ruta registrada en Vercel.
- `raxi_supervised_request_rate_admit`: RPC que YA existe en Supabase staging. Es una cuota PostgreSQL atómica de **30 solicitudes PREFLIGHT por minuto por workspace/usuario**, serializada entre instancias. Revalida `auth.sessions` y dueño bajo lock. **La única escritura posible de este host es el contador de cuota**; no escribe tareas, grants, runs, políticas ni crea proveedores.
- Una segunda capa de limitador *previo a JWT* `IngressAdmissionPort` está requerida, pero **NO IMPLEMENTADA** aquí: debe ser una implementación duradera/atómica que el host futuro aporte en el montaje autorizado, no una cuota en memoria ni una clave derivada de headers spoofables. Sin esta dependencia no se puede construir la ruta.
- La respuesta al cliente es solamente `persistedApprovalVisible: boolean` (si `raxi_director_real_read` entrega snapshot canónico para la misma sesión), siempre `readOnly:true`, `hostMounted:false`, `liveEnabled:false`, `actionsEnabled:false`, `executionEnabled:false` y `providerCalls:0`. **No equivale a autorización de ejecución**: falta cotización oficial verificada, política y segunda evaluación atómica previa a despacho.

## Dependencia histórica SQL y reconstrucción reproducible

La RPC `public.raxi_supervised_request_rate_admit(jsonb,text)` y la tabla `raxi_supervised_request_rate_counters` **sí existen en staging**, con la primera accesible solo por `service_role` y sin `DELETE/TRUNCATE` para ese rol. Su instalación histórica **no estaba versionada como SQL completo dentro de `main`**. Esto es una discrepancia de reproducibilidad y no se considera corregida por las pruebas TypeScript sintéticas.

- Se capturó la definición real mediante `pg_get_functiondef` en una consulta **solo lectura** al proyecto staging. SHA256 del texto de función almacenado: `57b94e50e622acb3c6dee7e41707993b1f0d0a2087d358627e2a455d817e67b7`.
- `supabase/proposals/issue49_supervised_rate_hosted_snapshot.offline.sql` conserva esa definición y el esquema mínimo de la tabla, ACL y RLS verificados. **Solo replay offline**, NO migración ni instrucción para reaplicar a staging.
- `apps/raxi-hq/tests/pg17/issue49_director_hosted_rate_qa.sql` ejecuta la RPC **real** dentro de un PostgreSQL 17 desechable separado, verifica hash idéntico, límites de 30/min PRE-FLIGHT y 3/min SUBMIT, rechazo de rol público y bloqueo tras revocar una sesión sintética.
- El workflow PostgreSQL 17 ejecuta estos archivos en una base adicional `raxi_rate_qa` en Docker `--network none`, no mediante mocks ni acceso al servicio hospedado.

**Pendiente formal antes de publicar:** reconciliar el catálogo hospedado y el historial de migraciones de la RPC histórica, dejando una migración o baseline aprobado para reconstruir staging desde cero, con autorización separada antes de cualquier SQL remoto. El host actual fallará cerrado (503) si esa RPC no está disponible.

## Validación que sí se puede ejecutar offline

`apps/raxi-hq/tests/stagingDirectorNodeGate.test.ts`: fake SDK sin red, *dos sesiones de un solo propietario*, revocación de A con B independiente, revocación durante la llamada y rechazo al revalidar, dueño/workspace extranjeros, JWT inválido, cuota persistente representada por puerto falso compartido que rechaza solicitud 31, limitador previo denegado/caído, Origin y URL incorrectos, body mal formado, RPC no permitidas, snapshot adulterado. **Esta prueba es sintética**, no reemplaza un E2E real de Supabase Auth en staging ni valida la cuota bajo concurrencia física (eso requiere otro incremento).

## Lo que falta (puertas independientes)

1. Aprobación de Codex del SHA exacto, CI 935+ pruebas, typecheck/build/npm audit PASS; no integrar al main antes.
2. Proveer y revisar en una etapa separada un limitador **preauth** duradero/cross-instance, rate key confiable del edge/runtime, CSRF/Origin, protección de tráfico de Vercel. El puerto actual falla cerrado si no existe.
3. Obtener autorización específica del propietario antes de **montar/desplegar** un endpoint; revisar secretos server-only, SHA, host y origen real, y probar JWT del mismo usuario en **dos sesiones distintas**, revocación en `auth.sessions`, CORS y cuota en staging.
4. Antes de aceptar `prepare`/ `approve`/`revoke` como comandos reales, diseñar autenticación de acción humana explícita e idempotente, cuota más restrictiva `SUBMIT`, precio/modelo y presupuesto aprobados. Esas acciones todavía NO existen en este host.
5. Antes de `runOne`, permiso diferente y específico de consumo, cotización oficial fresca y recibos durables verificados; **ningún agente real se mueve** sin evidencia `AGENT_EXECUTOR VERIFIED simulated=false`.

**Frontera:** sin SQL remoto, sin host publicado, sin proveedores, sin tokens facturables, sin secretos en GitHub, sin otro usuario humano, sin trabajo nocturno y sin producción. Issue #49 continúa abierto.
