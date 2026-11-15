# Raxi HQ · Issue #49 — paquete de preparación para migración de staging (NO APPLY)

**Estado:** propuesta de revisión; no autorizada ni ejecutada en Supabase. Rama basada en `main` después del squash-merge PR #74 (`67330350a59d9dab190d7db442ddd252604ef27f`) y PR #75 (`47ae14be7c0e313923b8e95ad7ee2d1b8098b3cc`). El cierre de esos PR no es autorización para SQL remoto, host o proveedores.

**Objetivo:** validar en PostgreSQL17 que la propuesta SQL del primer Director se puede instalar y retirar de un **esquema completamente vacío**, sin permitir borrado de tareas ni concesiones previas. Este paquete reúne controles operativos, **no** crea una migración automática.

## Alcance real

- `server/agent-runtime/firstRealDirectorPilot.ts` ya está en `main`, pero solo hace **preflight**, siempre `executionEnabled:false`; no invoca `runOne`.
- `supabase/proposals/issue49_director_real_sql.candidate.sql` es la DDL candidata del PR #75, **no existe en `supabase/migrations/`**. Prepara solamente una tarea `WAITING_APPROVAL` y una aprobación humana separada con reserva persistida cuando un host confiable la invoque. No hay despacho ni publicación.
- La nueva tabla tiene **UNIQUE(workspace_id) permanente**, incluso `REVOKED`; queda permitido un solo piloto por workspace, una vez en su vida. Ninguna reserva anterior se reutiliza.
- Se mantiene el flujo simulado actual separado. Una prueba positiva con datos sintéticos NO acredita permisos reales de una sesión Supabase alojada.

## Archivos de revisión

| Archivo | Propósito |
|---|---|
| `supabase/proposals/issue49_director_staging_preflight.review.sql` | Comprobación estrictamente de lectura de PostgreSQL17, dependencias, rutas existentes y ausencia de tareas/políticas/tabla candidata |
| `supabase/proposals/issue49_director_real_sql.candidate.sql` | DDL candidata revisada; **nunca se ejecuta remoto por este PR** |
| `supabase/proposals/issue49_director_staging_postflight.review.sql` | Comprobación de lectura de RLS, ACL, función, trigger, índice y tabla sin datos **después** de instalar esquema, sujeto a autorización específica |
| `supabase/proposals/issue49_director_staging_empty_undo.review.sql` | Deshacer **solo esquema vacío** y sin evidencias de tarea/aprobación; aborta con `ISSUE49_ROLLBACK_NO_GO` si existe registro histórico |
| `.github/workflows/raxi-hq-issue49-director-pg17.yml` | Ensayo automatizado nativo en contenedores PG17 `--network none`, sin host externo ni secretos |

## Procedimiento y puertas de autorización

**Puerta A — Antes de plantear SQL remoto (permitido en lectura):**

1. Confirmar GitHub `main` en el SHA exacto aprobado y ausencia de cambios de contrato inesperados.
2. Inspeccionar por SELECT staging `zvhxjindgyvtasstfjut` (sin datos personales) con `issue49_director_staging_preflight.review.sql`. Cualquier `NO_GO` detiene el avance. No asumir que una instantánea histórica sigue vigente.
3. Comprobar esquema, grants, triggers, políticas y la fuente Auth contra el catálogo alojado; documentar discrepancias. El test del laboratorio compara **seis tablas core** con una referencia histórica: NO equivale al catálogo completo Auth/Storage ni a un E2E real.
4. Exigir CI integral del código combinado `main`, CI PostgreSQL17 con backends independientes, revisión independiente sobre el SHA definitivo y ausencia de observaciones P1/P2 abiertas.

**Puerta B — Aplicación a staging (NO autorizada todavía):**

5. Solicitar al propietario **aprobación explícita distinta** para aplicar la DDL concreta, indicando SHA/archivo, entorno `zvhxjindgyvtasstfjut`, copia de seguridad/plan de recuperación, ventana, posible bloqueo DDL y plan de deshacer. Nunca producción, y nunca activar ruta/worker/proveedor en el mismo acto.
6. Tras la aprobación, aplicar mediante el método de migración Supabase previamente validado y transaccional cuando sea compatible. Registrar versión/hash, responsable y recibo de la operación. El archivo candidato no debe ejecutarse automáticamente al hacer merge.
7. Ejecutar `issue49_director_staging_postflight.review.sql` en lectura. Si falla, bloquear todo host; revisar rollback exclusivamente si no se creó ninguna tarea ni aprobación; **no borrar historia**. Un undo de esquema NO revierte por sí solo el ledger `supabase_migrations.schema_migrations`.

**Puerta C — Primer trabajo REAL (NO autorizada todavía):**

8. Implementar y auditar host Node con JWT/session verificados, identidad server-only, rate limiter persistente e interacción humana explícita. Segunda sesión de la **misma cuenta** para comprobar revocación sin cerrar la sesión principal. Sin insertar `service_role` en el navegador.
9. Conectar proyección SQL confiable con inspector PR #74 y futura **revalidación atómica** de permiso antes de `runOne`. Un resultado de preflight no es capacidad de despacho. Sin scheduler nocturno ni reintentos pagados automáticos.
10. Investigar/confirmar proveedor, modelo, precio y límites actuales desde fuentes oficiales; solicitar aprobación concreta de **una sola tarea de texto** (modelo, presupuesto máximo, expiración, apagado, resultado esperado). Cualquier recibo incierto se conserva y reconcilia; presupuesto SQL reservado no demuestra techo de factura externo.
11. Solo después de un recibo auténtico y persistente (`AGENT_EXECUTOR`, `VERIFIED`, `simulated=false`) conectar movimiento Pixi del Director; Investigador es otra fase, no auto-handoff.

## Validación automatizada sin efectos externos

El workflow de GitHub usa PostgreSQL 17 nativo en contenedores desechables aislados y ejecuta las migraciones históricas fijadas por SHA para catálogo/paridad. Adicionalmente:

- En la reconstrucción **vacía**: `preflight` → candidate DDL → `postflight` → `empty_undo` → constatar desaparición → `preflight` otra vez.
- En la fixture con tarea, aprobación y revocación: el intento `empty_undo` **debe ser rechazado**, preservando tabla y evidencia.
- Cualquier fallo de un paso bloquea el PR y no convierte el laboratorio en producción/staging.

**Frontera:** este paquete no contiene credenciales, conexión al proyecto alojado, despliegue, modelo IA activo ni operaciones SQL fuera de contenedores efímeros. No se retirará DEMO/MOCK de la UI por haberlo integrado.

## Auditoría negativa del contrato de revisión (P2)

La batería nativa `apps/raxi-hq/tests/pg17/issue49_director_staging_review_negative.sh` reproduce, en transacciones PostgreSQL17 desechadas, los ataques que el PR #76 debe detectar. Con tabla piloto todavía vacía, se intenta ejecutar `empty_undo` mientras hay **una tarea de otra provenance**, **una aprobación TASK de otro contexto** o **una política de runtime histórica**; todos deben retornar `ISSUE49_ROLLBACK_NO_GO` y restaurar la base. Tras instalar el esquema candidato, el `postflight` debe rechazar **un índice UNIQUE con nombre correcto pero columna errónea**, **un trigger deshabilitado**, **otro trigger con el mismo nombre y función incorrecta**, **un trigger FOR EACH STATEMENT**, **TRUNCATE para authenticated** y **DELETE para anon**.

El postflight exige índice único válido exactamente en `workspace_id` y trigger de fila activo conectado a `raxi_director_real_protect()`, además de denegar cualquier privilegio relevante de la tabla a los roles de navegador. Todos los falsos estados se ensayan en transacciones descartadas; no se cambia la instalación anfitriona. El undo debe conservar TODAS las tareas, políticas y aprobaciones TASK históricas, aunque su provenance no coincida con la del Director.

**Un resultado de CI sólo se marcará PASS al consultar el run final del SHA exacto**; estas instrucciones no prueban que la migración hospedada esté aprobada.
