# Raxi HQ — paquete B2 offline con versión generada por Supabase CLI

**ESTADO: PLAN SOLAMENTE. SIN EJECUCIÓN AUTORIZADA EN STAGING.** Esta propuesta no instala CLI, no genera todavía versión ni presenta el SQL como migración lista. No permite `db push`, SQL alojado, Auth real, despliegue, proveedores, B2 ni merge automático.

## Base comprobada

- PR #24 integrado en main: `4664b7356317d2e5cabd2dbbacd5d887f043b6f9`. Siete fuentes verificadas y ensayo PostgreSQL 17 local.
- PR #25 en borrador, HEAD revisado `84f139d313410776e61d2301a96e67e6cb90c2ee`: 11 PASS y 2 BLOCK en staging read-only, Codex sin hallazgos.
- Staging autorizado exclusivamente para lecturas: `zvhxjindgyvtasstfjut`, PostgreSQL 17.11, cero migraciones y cero tablas públicas en el último inventario. Producción `jrkefsylpfriiqefcmzq` excluida.
- El manifiesto `supabase/staging/raxi-hq-staging.manifest.json` conserva `executionReady:false`, `candidate.cliMigrationVersion:null`, `authorizations.*:false`. No cambiar estos bloqueos sin revisión y autorización posteriores.

## Entradas exactas; ninguna fuente adicional

Cuatro bases, en este orden:

1. `supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql`
2. `supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql`
3. `supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql`
4. `supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql`

Después, una **única** consolidación de `agent_runtime.sql` → `supervised_host_stage_a.sql` → `supervised_host_stage_b.sql` desde `supabase/candidates/supervised_runtime_b2.candidate.sql`, candidato marcado como NO APLICAR y generado offline. Está fuera de `migrations/`. La migración independiente `20261020234358_raxi_hq_campaign_strategy_pending_review.sql` queda **estrictamente excluida**. Nunca ejecutar `supabase db push` genérico.

## Preparación CLI sin instalación ni red

La creación de una versión real de Supabase CLI requiere disponer de un binario local previamente revisado y su ejecución con aprobación específica. En el siguiente incremento:

1. Identificar repositorio/commit exacto, worktree limpio y las siete huellas LF mediante `node scripts/verify-staging-preparation.mjs` y `node scripts/consolidate-runtime-candidate.mjs --check` desde `apps/raxi-hq`; abortar si cualquiera falla.
2. Comprobar **sin instalar** `supabase --version`, `supabase --help`, `supabase migration --help`, `supabase migration new --help` y la opción global `--workdir` documentada por el binario instalado. Si CLI no existe, detenerse y presentar opciones sin instalar automáticamente.
3. Crear únicamente después de autorización un directorio **desechable fuera del repositorio, sin `.env`, credenciales, `supabase/config.toml` conectado, `project_id`, `access_token` o enlaces `supabase link`**. Verificar que la CLI puede generar `migration new supervised_runtime_b2` allí sin iniciar servicios, sin conexiones externas y sin escribir en el checkout aprobado; si no, detenerse.
4. Registrar la versión **que realmente emita la CLI** (jamás inventarla) y verificar que solo se generó un nuevo SQL en el directorio desechable; comparar la opción `--workdir` contra `--help` real.
5. Copiar a ese SQL únicamente el contenido del candidato verificado, luego volver a comprobar hashes del candidato, fuentes y archivo derivado. La cabecera `DO NOT APPLY` del candidato no es autorización ni debe eliminarse sin revisión.
6. Generar un registro de procedencia independiente: versión CLI, versión y hash del binario, commit base, hash LF de cada una de las siete fuentes, hash LF del candidato, hash LF del archivo generado, política de exclusión y constancia de **cero conexiones alojadas**. No marcar PG17 hosted Auth como validado.
7. Abrir un PR independiente con el archivo generado y mapeo revisado, **sin incluir la migración de campañas**, antes de mover un artefacto a un paquete aplicable. Mantener B2 prohibido.
8. La aplicación futura necesita autorización separada, snapshot del catálogo, respaldo/recuperación aprobados, plan atómico y verificación posterior. No se crean usuarios alojados ni se conceden GRANT de Auth anticipadamente.

## Preflight Auth: BLOCK esperado antes de la instalación

El PR #25 comprobó que `service_role` no tiene SELECT sobre las cinco columnas requeridas de `auth.sessions` y `auth.users`. El SQL propuesto en Stage B contiene GRANT por columna; no realizar GRANT ad hoc ni usar la falta de SELECT tabla-completa como condición de fallo posterior. Tras **una futura aplicación autorizada**, verificar `has_schema_privilege('service_role','auth','USAGE')` y las cinco `has_column_privilege(...,'SELECT')` exactas. Diferenciar el inventario previo de la aceptación posterior.

## Puertas de aceptación (todas independientes)

- Fuentes y candidato LF verificados, sin cambios ni dependencias no declaradas.
- Generación CLI auténtica y versión documentada; CLI no instalada ni ejecutada por este PR.
- Validación de alcance y atomicidad del paquete antes de cualquier migración.
- Seguridad: RLS, grants efectivos, ejecución de funciones (PUBLIC EXECUTE), identidad de sesión, JWT reales y límites de Auth/Storage evaluados por separado.
- Respaldo y reversión probados donde sea seguro y explícitamente autorizado.
- Autorización humana explícita posterior para **cada** una de: ejecución SQL alojada, creación de cuentas de prueba, Auth real, B2, proveedores y despliegue.

**No DONE:** versión CLI, SQL remoto, permisos Auth alojados, usuarios, Auth JWT real, B2, proveedores y despliegues.
