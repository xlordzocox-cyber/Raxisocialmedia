# Raxi HQ · Gate de instalación del runtime en Supabase STAGING (Issue #60)

**Estado:** PAQUETE PREPARADO Y PROBADO EN POSTGRESQL 17 AISLADO. **NO APLICADO** EN SUPABASE. No autoriza agentes, publicación, costos ni producción.

## 1. Identidad del destino y fuentes

- Destino permitido: proyecto Supabase `raxi-hq-staging`, ref `zvhxjindgyvtasstfjut`, PostgreSQL 17.
- Prohibido: producción, un proyecto alterno, habilitar proveedores, host, Edge pública, flags, publicar contenido.
- Archivo transaccional para revisión: `supabase/proposals/issue60_staging_runtime_apply_migration_review_only.sql`, blob Git `27c3527342b312bf21b7a35b27d5f0f9aa14cfda`.
- Fuente exacta y orden dentro del archivo:
  1. `agent_runtime.sql` blob `6893f5c9eda6ff61b024173605a1da9a880e0b3e`.
  2. `supervised_host_stage_a.sql` blob `f6c0372d1cfc94ca45c267c641f835971d442b7c`.
  3. `issue60_stage_b_staging_identity_compatible.candidate.sql` blob `38ff3e81a87e3fb9b0066a8743af09fedf072130`.
  4. `issue60_runtime_dispatch_receipt.sql` blob `b0c4d13bdc5da73f867432c62de614c7f84dfa55`.
- La función instalada previamente por PR59 `public.raxi_supervised_host_identity(jsonb)` **NO se reemplaza**. Su SHA-256 de `pg_get_functiondef` debe ser exactamente `a99f644a5b4506d9db3fe426435bf4fefba30839592eea6ebdad4fee059a0fbf`. Un cambio benigno o malicioso exige revisar el paquete de nuevo: NO omitir el guard.
- Migraciones alojadas verificadas por lectura de `supabase_migrations.schema_migrations`:
  - `20261107222603` `raxi_hq_v09_private_core`
  - `20261107222904` `raxi_hq_v09_fk_indexes`
  - `20261108001113` `raxi_hq_v09_workspace_onboarding`
  - `20261108001444` `raxi_hq_real_idea_write`
  - `20261108003836` `raxi_hq_campaign_strategy_pending_review`
  - `20261111003526` `raxi_hq_pr59_supervised_staging_identity`
  - `20261111003603` `raxi_hq_pr59_supervised_campaign_requests`

## 2. Prueba nativa YA ejecutada

[GitHub Actions #43624838323](https://github.com/xlordzocox-cyber/Raxisocialmedia/actions/runs/43624838323) PASS: en contenedor PostgreSQL17 aislado, se instalaron los 5 esquemas históricos del repositorio y los 2 SQL PR59 en el orden del staging. Luego se instaló la **versión apta para el gestor de migraciones** de 61 KB, con transacción EXTERNA del ensayo y comprobaciones preflight/postflight y se ejecutaron las pruebas negativas de Issue60.

Resultados confirmados en GitHub Actions: rollback atómico de datos de QA, acceso owner/anon/foreign, único recibo de despacho real y su auditoría, rechazo de cambios directos a lease/proveedor y tres rechazos de reemplazos débiles de la identidad. El ensayo **no crea ni valida sesiones reales Supabase Auth alojadas**.

## 3. Preflight hospedado: SOLO LECTURA

Volver a ejecutar inmediatamente antes de aprobar cualquier instalación:
```sql
SELECT version,name
FROM supabase_migrations.schema_migrations ORDER BY version;
SELECT encode(sha256(convert_to(
  pg_get_functiondef('public.raxi_supervised_host_identity(jsonb)'::regprocedure),
  'UTF8')),'hex' AS existing_pr59_sha256;
SELECT to_regclass('public.raxi_agent_runs') AS runs,
       to_regclass('public.raxi_runtime_policies') AS policies,
       to_regprocedure('public.raxi_runtime_office(uuid)') AS office_rpc;
SELECT count(*) AS agent_profiles FROM public.raxi_agent_profiles;
SELECT count(*) AS tasks FROM public.raxi_agent_tasks;
SELECT count(*) AS events FROM public.raxi_agent_events;
```
Esperado antes de instalar: siete versiones exactamente iguales; hash fijo; las tres referencias del runtime nulas; 0 perfiles/tareas/eventos en este staging de prueba. Si cualquiera cambia, **detener sin SQL remoto**.

Confirmar manualmente que el proyecto y el SHA aprobados son los mismos, la capacidad de recuperación es adecuada y no hay procesos de aplicación activos. No equiparar el rollback de transacción con un respaldo del proyecto.

## 4. Ejecución futura (requiere autorización expresa sobre este archivo exacto)

1. Confirmar el destino STAGING exacto y el archivo `27c3527342b312bf21b7a35b27d5f0f9aa14cfda` sin cambios ni sustituciones.
2. Instalar el único SQL `issue60_staging_runtime_atomic_review_only.sql` como **una única migración**. Contiene `SET LOCAL`, preflight, los cuatro SQL y postflight, **sin `BEGIN` ni `COMMIT` embebidos**. El gestor de migraciones Supabase maneja el límite transaccional y registra la versión. El archivo de laboratorio antiguo que contenía `BEGIN/COMMIT` fue **eliminado de la rama** para evitar un uso accidental. Su historial queda en GitHub, pero NO es apto para `apply_migration`. No ejecutar por fragmentos.
3. El preflight rechaza: versión PG distinta, identidad PR59 distinta, privilegios incorrectos, tablas RPC runtime ya existentes o constraint de aprobaciones inesperada.
4. El postflight rechaza: cambio de identidad PR59, RLS ausente, permisos indebidos, RPC de lectura/host con ACL no permitida o trigger de recibos ausente.
5. **No habilitar host ni proveedores en esta etapa.** Los registros continuarán en 0. No generar perfiles ficticios para renderizar personajes.

## 5. Postflight alojado

Revisar primero: `public.raxi_agent_runs` y `public.raxi_runtime_policies` existen con RLS; `raxi_runtime_office(uuid)` tiene EXECUTE solo `authenticated` (no `anon`); `raxi_runtime_claim` y `raxi_supervised_host_command` solo `service_role`; mismo SHA256 PR59; trigger `raxi_runtime_dispatch_receipt` presente.

Después, para afirmar seguridad operativa se necesita **un JWT real de Supabase** y comprobar: sesión no anónima propietaria de workspace puede consultar `raxi_runtime_office`, usuario ajeno/anon no puede, sesión revocada rechazada donde el contrato la exija, y respuesta del workspace ajeno bloqueada. Las pruebas SQL con `set role` no sustituyen un E2E de JWT firmado y revocación.

## 6. Reversión y control del riesgo

- **Antes de la confirmación de la migración por Supabase:** un error SQL debe revertir la transacción externa del gestor. El laboratorio inyecta un fallo deliberado después de crear objetos parciales y verifica que desaparecen. [GitHub Actions #43625771857](https://github.com/xlordzocox-cyber/Raxisocialmedia/actions/runs/43625771857) PASS. No incluir `BEGIN`/`COMMIT` en el cuerpo de la migración.
- **Después de COMMIT:** NO borrar o truncar automáticamente tablas, auditoría ni recibos. Deshabilitar ejecución/ingress (que permanecen deshabilitados desde el principio); inspeccionar estado y planear migración correctiva que preserve evidencias. Una reversión destructiva exige revisión y autorización específica.
- No cambiar `VITE_RAXI_SUPERVISED_REQUESTS_ENABLED=false` de Preview ni flags privados. `service_role` NUNCA en frontend.
- Siguiente gate tras SQL y JWT: host supervisado **desactivado**, luego consentimiento separado sobre tarea real, modelo/proveedor, presupuesto, horario y apagado. Un evento de despacho NO es confirmación de ejecución de proveedor.

**Regla de cierre:** hasta que todas estas puertas pasen, la oficina REAL debe seguir presentando 0 agentes verificados. DEMO permanece aparte.

## 7. Compatibilidad con el migrador — bloqueo resuelto en código, no validado hospedado

La [guía oficial de Supabase](https://supabase.com/kb/troubleshooting/partial-migrations-and-schema-inconsistencies-from-embedded-transactions) advierte que los archivos con `BEGIN`/`COMMIT` pueden interrumpir la atomicidad del gestor y dejar objetos parciales sin registrar versión. Por ello, la propuesta **para `apply_migration`** elimina dichos límites; se conserva el ensayo SQL original separado y marcado como solo laboratorio. `SET LOCAL` se ejecuta dentro de la transacción que abre el gestor. **Nunca usar `execute_sql` para instalar DDL**; cuando esté expresamente aprobado utilizar `apply_migration` y verificar el historial después.
