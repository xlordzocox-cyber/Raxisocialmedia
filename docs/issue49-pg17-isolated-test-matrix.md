# Issue #49 · Matriz de ensayos aislados PostgreSQL 17

**Estado:** PLAN DE EJECUCIÓN; ninguna prueba SQL de este documento se declara PASS sin archivo de evidencia de una ejecución real. No aplicar en producción o staging sin una autorización independiente.

## Preparación segura en la estación Windows

Desde `$HOME\source\RaxiHQ-Oficina`:

```powershell
git status --short
git rev-parse HEAD
docker version --format '{{.Server.Version}}'
docker ps --filter "name=raxi-pg17" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker images postgres:17 --format '{{.Repository}}:{{.Tag}} {{.ID}}'
```

Estas operaciones son **solo lectura**: no paran contenedores, no cambian volúmenes, ni solicitan credenciales. Antes de crear un contenedor/cargar migraciones, identificar qué base aislada anterior existe y si el fallo PR #39 sobre `raxi_workspaces_slug_check` permanece abierto. Nunca usar `supabase db reset --linked`, `migration repair` o `db push` para este ensayo.

## Contrato de campaña (para tests negativos)

| ID | Área | Caso negativo / aceptación | Criterio |
|---|---|---|---|
| PG17-01 | Baseline | Aplicar los cuatro SQL base a un entorno equivalente a Supabase PostgreSQL 17, **sin datos reales**, y comparar catálogo | Diffs explicados; `raxi_workspaces_slug_check` evaluado por verificador estructural, no equivalencia inferida |
| PG17-02 | Migración propuesta | Aplicar `20261020234358_raxi_hq_campaign_strategy_pending_review.sql` **solo en base temporal aislada** | Sin errores SQL; índices, grants, constraints, triggers y RPC coinciden |
| SEC-01 | Cliente anon | Llamar RPC snapshot y commit sin sesión | Rechazo; 0 modificaciones |
| SEC-02 | Tenant A/B | Usuario A lee/escribe workspace B y proporciona `p_actor` falso | Rechazo; sin fuga, 0 modificaciones |
| SEC-03 | Roles | `authenticated` no puede ejecutar commit privilegiado; `service_role` requiere actor validado por Edge | Rechazo/fail-closed |
| CAS-01 | Carrera | Dos comandos distintos con misma `expectedVersion` | Solo uno puede confirmar; versión monotónica |
| IDEMP-01 | Reintento | Mismo `operationId` y JSON idéntico | Un solo efecto, mismo recibo |
| IDEMP-02 | Colisión | Mismo `operationId` y payload diferente | Error de conflicto, sin doble escritura |
| IDEA-01 | Transición | Saltar PROPOSED → APPROVED_FOR_HQ | Rechazo |
| IDEA-02 | Handoff | Crear campaña sin idea SENT_TO_HQ y sin handoff verificado | Rechazo |
| CAMP-01 | Campaña | Transición no admitida por el grafo | Rechazo |
| STRAT-01 | Strategy | Editar revisión APPROVED o CHANGES_REQUESTED | Rechazo |
| STRAT-02 | Strategy | Mutar entregables de revisión no DRAFT | Rechazo |
| APPR-01 | Aprobación | Cambiar/borrar decisión humana previa | Rechazo |
| AUDIT-01 | Integridad | Alterar prefijo del historial, falsificar/omitir recibo o cambiar owner | Rechazo o error confirmado; no falso éxito |
| FAIL-01 | Fallo parcial | Forzar error después de una escritura dentro de la misma transacción | Rollback íntegro |
| TEST-01 | Higiene | Validar sin efectos fuera de DB/contendor temporal | No cambia red, producción, staging, usuarios ni credenciales |

**Evidencia requerida por prueba:** timestamp local, versión exacta PostgreSQL 17, commit Git de la migración, hashes SHA-256, SQLSTATE, filas/objetos afectados, resultado esperado vs observado y estado cleanup. Evitar datos personales, URL de Auth y tokens en logs. Una condición desconocida es BLOCKED/NOT_VERIFIED, no PASS.

## Consideraciones adicionales de FanView y NSFW

Decisiones recuperadas de memoria del proyecto:
- Raxi HQ debe permitir campañas con fotografías de nivel privado/NSFW adecuadas a su plataforma, manteniendo a Raxi como adulta y con controles de contenido no explícito y revisión humana.
- Debe distinguir destinos públicos, teaser, FanView Feed y FanView Chat; jamás interpretar una aprobación para un canal como permiso para cualquier otro.
- Selección explícita de modelo/personaje por campaña y generación; aislamiento de identidad, referencias, biblioteca de assets y permisos.
- No publicación, gasto ni generación con proveedor externo sin autorización humana; no ejecución nocturna desatendida.

**Brecha de contrato:** la migración candidata inspeccionada no define un modelo de autorizaciones NSFW por destino ni un mecanismo dedicado de moderación/edad/consentimiento. No añadir una simple marca `nsfw=true` o una categoría genérica: eso no demostraría derechos de publicación ni seguridad. Diseñar un contrato posterior versionado para `contentLevel`, `destination`, `modelId`, `reviewStatus`, `approvedBy`, `approvedAt`, restricciones por plataforma, acceso y evidencia de autorización, manteniendo las decisiones no explícitas y el control humano. **No declarado implementado.**

## Dependencias y gate de ejecución

1. Inspección de Docker PG17 existente en Windows. Confirmar si el contenedor de PR #39 contiene una base **descartable**, si posee esquemas necesarios de Supabase Auth, si hay un baseline fiable y si existen todavía divergencias de catálogo.
2. Aislar nueva base/contendor sin puertos publicados, sin volúmenes de producción ni Supabase; no reutilizar un contenedor de QA con trabajo que deba conservarse.
3. Ejecutar la matriz contra la base efímera; registrar resultados y descartar todo estado del ensayo al finalizar.
4. No promover SQL a `migrations/` como desplegable ni habilitar Edge `campaign-command` mientras exista un FAIL/BLOCKED.
5. Runtime supervisado Stage A/B se ensaya aparte, sin proveedores.

## Estado inicial real

Solo están verificadas las inspecciones de catálogo **remotas de solo lectura** documentadas en `docs/issue49-contracts-migration-preflight.md`. La presente matriz todavía **no se ejecutó** contra el Docker del usuario. No se acredita compatibilidad PG17, aislamiento de tenants ni idempotencia hasta ver la evidencia.
