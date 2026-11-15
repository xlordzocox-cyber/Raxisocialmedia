# Raxi HQ · Issue #49 — primer piloto REAL del Director IA (admisión sin ejecución)

**Estado:** PR de código y QA **solo de preparación**. No se ha ejecutado IA ni habilitado un proveedor, host HTTP, worker, SQL remoto, facturación ni despliegue. Producción prohibida.

## Hallazgo verificado directamente en staging, 14-nov-2026

Proyecto staging confirmado: `zvhxjindgyvtasstfjut`.

- `public.raxi_supervised_prepare` alojado **exige** `p_spec.provider = 'simulated'`, política `p.simulated = true`, `p.provider = 'simulated'`, y su inserción titula la tarea `LOCAL SIMULATION ...`. Por lo tanto, **no es posible crear una tarea real del Director a través de ese contrato** sin una revisión de esquema y migración futura aprobada.
- `server/agent-runtime/supabaseSupervisedRepository.ts` actualmente llama `canonicalLocalSpec`, que igualmente solo permite `simulated`. `createSupabaseSupervisedHost` exige `liveEnabled:false` y usa `simulatedProvider`.
- `runOne()` **sí existe** y puede coordinar llamadas de proveedores por un puerto `Provider`, pero no hay ruta alojada habilitada para ejecución real.
- Recuento SELECT en staging: `raxi_runtime_policies=0`, `raxi_agent_tasks=0`, `raxi_agent_runs=0`, `raxi_agent_events=0`, aprobaciones `subject_kind='TASK'` = **0**. Son observaciones de ese momento, no garantías futuras.
- La propuesta histórica `pilotBudget.ts` contiene una cotización que **caducó el 23-oct-2026**; sus cifras/modelo no se toman como tarifa vigente ni como aprobación de gasto.

**Conclusión:** no habilitar proveedores ahora. Falta antes un contrato persistente **REAL** separado del flujo de simulación, con permiso humano independiente. No sustituir `provider='simulated'` por `'openai'` en SQL sin modelar y probar sus autorizaciones, idempotencia, presupuestos y recibos.

## Incremento incluido en este PR

`server/agent-runtime/firstRealDirectorPilot.ts` aporta `inspectFirstRealDirectorPilot()`, una inspección **server-only y fail-closed** que recibe solo `workspaceId` y `taskId`. Nunca crea un token, cambia una política, registra tareas, llama a `runOne` ni invoca APIs. Reutiliza `taskSpec()` y el contrato `HostedIdentity`. Requiere que **un futuro puerto del servidor confiable** proporcione:

1. Identidad del único operador real en Supabase staging, con `actorId`, `sessionId`, workspace y caducidad. Se lee **antes y después** de las comprobaciones, bloqueando cambio de sesión.
2. Una **lectura canónica y atómica futura** de tarea `DIRECTOR` con `simulated=false`, estado `READY_FOR_MANUAL_EXECUTION` aún **no implementado en SQL**, especificación exacta, scope SHA256, aprobación humana de ejecución persistida y política de presupuesto vigente. Actor, sesión, tarea, workspace, versión, proveedor, modelo y tope de coste deben coincidir.
3. Cotización **fresca y verificada por el host** para el proveedor/modelo específico, con presupuesto reservado conservador, fecha de verificación y caducidad. El campo de URL HTTPS no prueba por sí solo la autenticidad de la cotización; el puerto es responsable de comprobar fuente oficial, cálculos y límites del proveedor, y los gastos siguen siendo inciertos hasta recibo.
4. Una sola fase `DIRECTOR`, respuesta de texto sin recuperación web, máximo 256 tokens de salida, sin continuación automática a `RESEARCHER`, sin proveedores de medios, publicaciones ni herramientas.

El resultado, incluso cuando pasa con fixtures sintéticos, contiene obligatoriamente:

```json
{"kind":"DIRECTOR_REAL_PREFLIGHT_ONLY","liveEnabled":false,"executionEnabled":false,"providerCalls":0}
```

Es **evidencia de inspección, no una autorización reutilizable**. Antes de `runOne`, un futuro servicio deberá hacer **revalidación transaccional de sesión, política y aprobación**, reserva y vinculación durables de ejecución, y despacho manual. Una lectura y un resultado de este PR nunca habilitan una acción.

La suite `apps/raxi-hq/tests/firstRealDirectorPilot.test.ts` prueba con datos totalmente sintéticos: usuario ajeno, otra sesión de la misma cuenta, tarea errónea, research no autorizado, falsificación de aprobación, revocación, políticas caducadas o insuficientes, scope y versionado manipulados, costes no verificados o agotados, fallos de los puertos y ausencia de permisos. **No** prueba Supabase E2E ni una IA real.

## Próximo trabajo real en Issue #49, separado de este PR

- Diseñar y revisar SQL/migración **staging-only** para tarea Director `simulated=false` y autorización de ejecución firmemente vinculada, conservando intacto el camino simulado, RLS/grants, journal/recibos, lease y rate limit. Primero ensayar en PG17 aislado. **No aplicar SQL remoto sin autorización expresa**.
- Revisar adaptador servidor que solo reciba evidencia confiable de esas RPC y habilite un único `runOne` exclusivamente tras commit de permiso y presupuesto; no permitir que un payload del navegador construya la aprobación. Mantener interruptor de apagado y cero ejecución nocturna.
- Actualizar/verificar documentación oficial del modelo, precio y límites **en la fecha del piloto**, con presupuesto del proveedor y autorización humana específica; no usar `PILOT_QUOTE` vencida. Proponer por separado la cuota exacta y permitir aceptación/rechazo informado.
- Conectar el host bajo nueva autorización de despliegue, hacer pruebas E2E de Auth y revocación con segunda sesión de **la misma cuenta**, y solo después un piloto Director de texto manual bajo coste permitido.
- Publicar a Pixi únicamente eventos durables y verificables `AGENT_EXECUTOR / VERIFIED / simulated=false` y no confundir el resultado textual de modelo con verdad factual. No retirar DEMO/MOCK todavía.

**GitHub:** ver Issue #49 y la consolidación inerte ya integrada mediante PR #73 `47ad219981c195cbbbf2ef6ac069f76ae43f5c6d`.
