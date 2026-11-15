# Raxi HQ · Issue #49 — Director REAL readiness host (sin publicar)

**Estado: diseño implementado como código Node interno, sin endpoint montado y sin proveedor.** Continúa a PR #77, que instaló la migración `20261115040235` únicamente en `raxi-hq-staging`. Este incremento **NO** modifica SQL, migrations, credenciales, UI ni despliega.

## Qué existe

- `server/agent-runtime/stagingDirectorReadiness.ts`: manejador HTTP *aún no montado*, acepta únicamente `POST` con JSON cerrado `{workspaceId,taskId}` (máximo 512 bytes). Rechaza `action`, `confirmed`, proveedor, presupuesto u otros campos. No prepara, aprueba, revoca ni ejecuta tareas.
- `apps/raxi-hq/server/stagingDirectorNodeGate.ts`: composición Node con **dos clientes Supabase independientes** y sin persistir sesión; verifica `getClaims`, `getUser`, `raxi_supervised_host_identity` cada petición, antes y después de consultar DB. Comprueba el proyecto exacto staging `zvhxjindgyvtasstfjut` y claves separadas. El cliente `service_role` expone solo RPCs permitidas: identidad, `raxi_supervised_request_rate_admit` y `raxi_director_real_read`.
- `apps/raxi-hq/server/stagingNodeAuthIngress.ts`: reutiliza *sin cambiar la ruta previa* el control de origen de preview HTTPS, política same-origin, rateKey de contexto confiable y limitador de **preautenticación** inyectado, pero solo permite un segundo path cerrado `/api/raxi-hq/director-real-readiness`. No hay ruta registrada en Vercel.
- `raxi_supervised_request_rate_admit`: RPC que YA existe en Supabase staging. Es una cuota PostgreSQL atómica de **30 solicitudes PREFLIGHT por minuto por workspace/usuario**, serializada entre instancias. Revalida `auth.sessions` y dueño bajo lock. **La única escritura posible de este host es el contador de cuota**; no escribe tareas, grants, runs, políticas ni crea proveedores.
- Una segunda capa de limitador *previo a JWT* `IngressAdmissionPort` está requerida, pero **NO IMPLEMENTADA** aquí: debe ser una implementación duradera/atómica que el host futuro aporte en el montaje autorizado, no una cuota en memoria ni una clave derivada de headers spoofables. Sin esta dependencia no se puede construir la ruta.
- La respuesta al cliente es solamente `persistedApprovalVisible: boolean` (si `raxi_director_real_read` entrega snapshot canónico para la misma sesión), siempre `readOnly:true`, `hostMounted:false`, `liveEnabled:false`, `actionsEnabled:false`, `executionEnabled:false` y `providerCalls:0`. **No equivale a autorización de ejecución**: falta cotización oficial verificada, política y segunda evaluación atómica previa a despacho.

## Validación que sí se puede ejecutar offline

`apps/raxi-hq/tests/stagingDirectorNodeGate.test.ts`: fake SDK sin red, *dos sesiones de un solo propietario*, revocación de A con B independiente, revocación durante la llamada y rechazo al revalidar, dueño/workspace extranjeros, JWT inválido, cuota persistente representada por puerto falso compartido que rechaza solicitud 31, limitador previo denegado/caído, Origin y URL incorrectos, body mal formado, RPC no permitidas, snapshot adulterado. **Esta prueba es sintética**, no reemplaza un E2E real de Supabase Auth en staging ni valida la cuota bajo concurrencia física (eso requiere otro incremento).

## Lo que falta (puertas independientes)

1. Aprobación de Codex del SHA exacto, CI 935+ pruebas, typecheck/build/npm audit PASS; no integrar al main antes.
2. Proveer y revisar en una etapa separada un limitador **preauth** duradero/cross-instance, rate key confiable del edge/runtime, CSRF/Origin, protección de tráfico de Vercel. El puerto actual falla cerrado si no existe.
3. Obtener autorización específica del propietario antes de **montar/desplegar** un endpoint; revisar secretos server-only, SHA, host y origen real, y probar JWT del mismo usuario en **dos sesiones distintas**, revocación en `auth.sessions`, CORS y cuota en staging.
4. Antes de aceptar `prepare`/ `approve`/`revoke` como comandos reales, diseñar autenticación de acción humana explícita e idempotente, cuota más restrictiva `SUBMIT`, precio/modelo y presupuesto aprobados. Esas acciones todavía NO existen en este host.
5. Antes de `runOne`, permiso diferente y específico de consumo, cotización oficial fresca y recibos durables verificados; **ningún agente real se mueve** sin evidencia `AGENT_EXECUTOR VERIFIED simulated=false`.

**Frontera:** sin SQL remoto, sin host publicado, sin proveedores, sin tokens facturables, sin secretos en GitHub, sin otro usuario humano, sin trabajo nocturno y sin producción. Issue #49 continúa abierto.
