# Raxi HQ · Gate de autenticación del primer host (Issue #60)

**Estado:** preparación en código y pruebas con dobles / PostgreSQL17 anterior. **No hay endpoint hospedado**, host ejecutor, proveedor, tarea ni gasto. El usuario autorizó preparación y pruebas Auth sin ejecución.

## Estado de base verificado

Proyecto permitido **exclusivamente**: `raxi-hq-staging` (`zvhxjindgyvtasstfjut`). PostgreSQL 17.11, ocho migraciones incluida `raxi_hq_issue60_staging_runtime_install`. RPC `raxi_runtime_office(uuid)` disponible para `authenticated`; `raxi_supervised_host_identity(jsonb)` y `raxi_supervised_host_command(jsonb,text,jsonb)` solo accesibles por `service_role`. Última consulta read-only: 0 perfiles, 0 tareas, 0 runs, 0 políticas, 0 eventos.

## Componente preparado

`server/agent-runtime/stagingAuthReadinessProbe.ts` es **un handler no montado**. No escucha ningún puerto ni conecta con proveedores. Solo un POST JSON con `workspaceId` UUID y límite 256 B; rechaza campos adicionales, tokens en body, cualquier acción, contenido grande, método GET o Content-Type incorrecto. Exige un Bearer JWT, verifica identidad mediante `supabaseSupervisedAuth`: `getClaims(token)` y `getUser(token)` sobre proyecto esperado y una consulta *actual* de `raxi_supervised_host_identity` que cruza sesión en `auth.sessions` y ownership del workspace. **También exige el projectRef exacto de staging** antes de responder.

La respuesta no contiene actor, ID de sesión, clave, token, workspace ni mensajes internos. Tres barreras de construcción (`liveEnabled`, `providersEnabled`, `actionsEnabled`) solo aceptan `false`. No hay importaciones de `runOne`, repositorio de ejecución, ni operaciones `prepare/approve/claim/step`. Este handler **no es** `createSupabaseSupervisedHost` del Stage B: el anterior todavía admite comandos de simulación con efectos en tablas y no debe montarse durante este gate.

## Matriz de validación

| Caso | PR #68 (dobles) | Hosting real |
| --- | --- | --- |
| Bearer válido con claims, usuario y workspace correctos | Probado localmente | Pendiente |
| Token ausente/otro proyecto/vencido/anónimo | Probado con dobles | Pendiente |
| Sesión revocada o usuario cambiado | Probado con dobles y SQL sintético | Pendiente |
| Campos `action:execute/approve/prepare` inyectados | Denegados antes del Auth | Pendiente |
| GET, body no JSON, cuerpo excesivo y campos adicionales | Denegados | Pendiente |
| Acceso de otra cuenta real a un workspace existente | No probado | Pendiente |
| Cero proveedores, tareas y costes | Contrato sin puertos de escritura | Verificar tras deploy, si se autoriza |

**Prueba móvil complementaria, sin host público:** PR #69 prepara botón manual de solo lectura desde Runtime del usuario ya autenticado, usa `getUser()` (network), RPC del propietario, workspace aleatorio y cliente sin sesión (anónimo). No cierra la sesión y marca segunda cuenta / revocación `NOT_TESTED`. No copiar JWT ni credenciales a GitHub, Supermemory, capturas o este chat.

## Bloqueos para hosting

1. **Decidir runtime servidor y validarlo:** Node/Edge puede exponer globals diferentes; `supabaseSupervisedAuth` rechaza `typeof window!=='undefined'`, por lo que no inferir compatibilidad Deno Edge sin pruebas. No publicar el handler sin adapter revisado.
2. Asegurar que el verificador `getClaims` se ejecute con un **cliente del proyecto exacto**, y que el `service_role` exista **solo en el proceso servidor**, nunca en frontend, Vercel build público, logs o trazas. `getUser(token)` debe ser solicitud real a Auth; no confiar en JWT decodificado sin verificar.
3. Habilitar protección de endpoint: JWT obligatorio, ruta no pública sin CORS permisivo, límites de tamaño/tiempo/tasa, sin logs de `Authorization`; defensa adicional WAF opcional después de evaluar.
4. Autorizar explícitamente un **despliegue de diagnóstico**, con SHA exacto, proyecto y entorno. Aun entonces, `createSupabaseSupervisedHost` y `runOne` permanecen sin ruta, sin workers y sin proveedores.
5. Ejecutar E2E en staging con la sesión real del usuario: propietario PASS; desde segunda cuenta *existente y autorizada para QA*, RPC del workspace ajeno DENIED; sesión revocada: operación sensible denegada aunque JWT siga sin expirar. No crear cuentas ni cerrar sesión existente sin nuevo consentimiento.
6. Solo después de pruebas firmadas y aprobación adicional se considera entrada controlada de tareas reales, proveedor/modelo/presupuesto/ventana horaria y apagado. El evento de despacho sin recibo del proveedor no es trabajo confirmado.

## Fuentes oficiales consultadas (noviembre de 2026)

- [Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims): verifica JWT con JWKS o mediante Auth según la clave configurada.
- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser): valida en el servidor de Auth.
- [Supabase sesiones](https://supabase.com/docs/guides/auth/sessions): `session_id` correlaciona con `auth.sessions` y permite revocación sensible.
- [RLS y seguridad](https://supabase.com/docs/guides/database/postgres/row-level-security): roles y propiedad no deben confundirse con simple autenticación.

**Regla:** no atribuir al Director IA o Investigador movimiento o trabajo REAL sin evento de ejecución autenticado, vinculado a tarea y recibo verificable; DEMO sigue completamente separado.
