# Raxi HQ · Issue #49 — recibo de migración de esquema en staging

**Estado real: APLICADA ÚNICAMENTE EN STAGING.** El cambio se autorizó en la conversación el 14 de noviembre de 2026 (zona horaria de Monterrey); Supabase registró versión UTC `20261115040235`.

## Registro comprobado

| Campo | Valor |
|---|---|
| Entorno | `raxi-hq-staging` |
| Supabase project ref | `zvhxjindgyvtasstfjut` |
| PostgreSQL | `17.11.0.003`, región `us-east-2` |
| Nombre de migración | `raxi_hq_issue49_director_real_gate_schema_only` |
| Versión Supabase | `20261115040235` |
| Fuente aprobada | `supabase/proposals/issue49_director_real_sql.candidate.sql` |
| Blob Git SHA-1 de esa fuente | `54d83071f4e549b7d34bc91c6dd358f8d0b27e72` |
| Código de partida | `main` en `7aedea08c2d2e08bbbd54bcabdf5e3c4bd0a3e27`, PRs #74, #75, #76 integrados |
| Recibo de la operación | `mcp__Supabase__apply_migration` retornó `success:true` |
| Copia versionada en repositorio | `supabase/migrations/20261115040235_raxi_hq_issue49_director_real_gate_schema_only.sql`; **bytes exactamente iguales** a la fuente aprobada (mismo blob Git) |

La copia versionada se incorporó **después** de la operación para registrar el mismo cambio del servidor en GitHub, no para volver a ejecutarlo. El pipeline nativo PostgreSQL 17 ahora difiere exclusivamente esa migración hasta instalar primero las migraciones históricas PR59/Issue60 que ya estaban registradas en staging; falla si aparece una migración posterior sin revisar el orden de reconstrucción. Se comprueba identidad exacta entre propuesta y copia antes de ensayar DDL.

## Preflight y postflight hospedados

El preflight de `supabase/proposals/issue49_director_staging_preflight.review.sql` **terminó sin errores**, y las consultas explícitas inmediatamente anteriores confirmaron PostgreSQL 17, identidad y ruta simulada existentes, tabla real ausente, tareas/ejecuciones/eventos/políticas y aprobaciones TASK todas en cero.

Después de aplicar la migración, `supabase/proposals/issue49_director_staging_postflight.review.sql` **terminó sin errores**. Una consulta independiente de solo lectura confirmó:

- `raxi_director_real_pilots` existe, RLS habilitado; **0 filas**.
- Índice `raxi_director_real_one_lifetime` válido, único **solo sobre workspace_id**; una autorización por workspace de por vida, inclusive revocada.
- Trigger de protección habilitado por fila para INSERT/UPDATE, función correcta, sin condiciones `WHEN` ni `UPDATE OF` restringido.
- `anon` y `authenticated` **sin TRUNCATE**; `service_role` sin DELETE y con INSERT; controles adicionales en el postflight exhaustivo.
- `raxi_supervised_prepare` original sigue instalado.
- 0 tareas de agentes, 0 runs, 0 eventos, 0 políticas runtime, 0 aprobaciones TASK; ningún efecto real.

Supabase `list_migrations` confirmó la versión `20261115040235` y el nombre exacto. No se activaron rutas HTTP, host, IA, workers, modelos, publicaciones ni operaciones de producción.

## Recuperación controlada

No ejecutar automáticamente `issue49_director_staging_empty_undo.review.sql`. El archivo fue probado en contenedor PG17 y **solo permite** deshacer un esquema vacío sin tareas, aprobaciones TASK, políticas ni piloto de ninguna provenance. Cualquier evidencia histórica exige conservación, investigación y otro plan de recuperación. El undo puede eliminar estructura pero **no borra ni revierte por sí mismo el historial `supabase_migrations.schema_migrations`**, que debe conciliarse por separado.

No consta que exista una copia física/PITR dedicada creada inmediatamente antes de esta migración; por eso no se afirma recuperación total garantizada. La instalación es estrictamente aditiva y no modifica las tablas preexistentes.

## Límites vigentes

- **No hay Director ejecutando tareas**; la tabla vacía es infraestructura, no un agente operativo.
- El inspector de PR74 solo efectúa preflight: `executionEnabled:false`.
- El nuevo ledger necesita host protegido, identidad validada server-side, limitador de solicitudes persistente, autorización humana con clic comprobable y recepción de eventos.
- Para el primer `runOne` real se requiere autorización **separada** del modelo, proveedor, cotización oficial fresca y presupuesto máximo. No activar Investigador automático, agenda nocturna, publicación ni DEMO/MOCK removal.
- La revisión GitHub de esta **copia de recibo y CI** no equivale a una ejecución nueva de SQL alojado.

**Issue #49 permanece abierto** hasta un recibo persistente de ejecución auténtica del Director IA.
