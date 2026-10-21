# Raxi HQ v1.0 — campañas y Strategy persistentes

## Estado de entrega

Código y propuesta de migración para revisión. **No aplicado ni desplegado en producción.** Main base: `01b7783410ec5e73e813e7c191274bcdddcdf831`. Rama: `feature/raxi-hq-v1.0-campaign-strategy-persistence`.

La capacidad se detecta mediante la lectura autenticada de `raxi_campaign_snapshot`. Si no existe, HQ conserva REAL/DEMO y el Centro de Ideas actual, muestra el despliegue pendiente y no habilita decisiones nuevas. No hay un repositorio de demostración como fallback. Las fotografías, Aria, publicación y ejecutores no forman parte de este servicio.

## Contratos e interfaz

Se reutilizan `CampaignRecord`, `CampaignSession`, `CampaignStrategyRevision`, `StrategyDeliverable` y sus validadores/reductor. La procedencia `REAL` complementa las existentes; los IDs externos `IDEA-REAL-…`, `CAMPAIGN-…` y `STRATEGY-ITEM-…` se mantienen junto a UUID internos por workspace. Los UUID no sustituyen las referencias editoriales.

El Centro de Ideas sigue usando tarjetas, métricas y detalle originales. Las decisiones de revisión/aprobación/handoff capturan el ID y `updatedAt` esperado y exigen confirmación humana. `OperationsInbox`, `CampaignBriefForm`, `CampaignWorkspace`, `StrategyStudio` y `StrategyForm` se reutilizan, añadiendo callbacks asíncronos y confirmación canónica. No se sustituyen por formularios administrativos. En REAL no se muestra el panel Aria; las etapas no persistidas siguen deshabilitadas.

## Propuesta SQL mínima

Único archivo nuevo: `supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql`, generado con la CLI y **pendiente de aprobación**. Las cuatro migraciones previas permanecen intactas.

- `raxi_workspaces.campaign_version`: versión monotónica para compare-and-swap y detección de decisiones obsoletas entre pestañas.
- `raxi_campaigns`: admitir procedencia REAL y unicidad por idea de origen/workspace, conservando FK y RLS.
- `raxi_audit_events`: unicidad de operación de campaña/workspace.
- `raxi_strategy_revisions`, `raxi_strategy_deliverables`, `raxi_approvals`: protección de historial mediante triggers y una aprobación de Strategy por revisión. No se crean tablas duplicadas.
- `raxi_campaign_snapshot`: lectura invoker autenticada. Ignora cualquier actor proporcionado por un navegador y deriva `auth.uid()`; únicamente `service_role` puede indicar el actor verificado por el servidor. Rechaza cuentas anónimas y workspace ajeno.
- `raxi_campaign_commit`: invoker reservado a `service_role`. Bloquea el workspace, comprueba propiedad, busca el recibo antes de comprobar la versión, valida relaciones/transiciones y confirma todos los efectos en una transacción.

Se reutilizan `raxi_ideas`, `raxi_idea_handoffs`, `raxi_campaigns`, `raxi_strategy_revisions`, `raxi_strategy_deliverables`, `raxi_approvals` y `raxi_audit_events`. No se amplían escrituras autenticadas directas sobre tablas operativas.

## Escritura, versiones y aprobación

`campaign-command` valida JWT con Auth `getUser(token)`, rechaza usuarios anónimos, limita bytes y campos, recupera el estado canónico y ejecuta los contratos editoriales en servidor. El navegador envía un comando, nunca una proyección, actor, timestamp o aprobación preparada. El dominio del servidor se genera desde los mismos contratos mediante `npm run build:campaign-function`; build/tests comprueban que el bundle versionado está actualizado. No contiene dependencias de Node ni credenciales.

La identidad humana real se conserva en `actor_user_id` / `approved_by`, derivados del JWT. La etiqueta editorial heredada `LUIS` del contrato no concede permisos. `raxi_approvals.subject_id` referencia la revisión concreta y `context.snapshot` conserva su contenido completo y comando. El SQL usa IDs internos para las relaciones y conserva IDs externos en los payloads. No se infiere autorización Aria ni publicación de una Strategy aprobada.

Las revisiones aprobadas o con cambios solicitados son inmutables. El contenido enviado a revisión no puede editarse; las decisiones de revisión modifican solo estado y metadatos autorizados. Los entregables dejan de ser editables al salir de DRAFT. Abrir otra revisión crea otra fila y no hereda aprobación. Las ediciones del DRAFT vigente se registran como comandos auditados; no reescriben una revisión histórica.

Cada operación tiene `operationId` estable y versión esperada. Repetir el mismo comando devuelve el estado canónico y no duplica campaña, entregables ni aprobación. Reutilizar la clave con otro contenido o una versión obsoleta se rechaza. Si se pierde HTTP, el store conserva el comando; una lectura lo confirma únicamente mediante su recibo exacto. Una lectura completa con versión mayor y sin recibo demuestra que el CAS antiguo ya no puede aplicarse, y permite al usuario revisar de nuevo; no se reenvía automáticamente una decisión sobre datos nuevos.

`AuthStore` posee también el store de campañas durante la sesión verificada. REAL/DEMO y remounts visuales no lo invalidan. Al cerrar sesión/cambiar de cuenta se retira el store, se vacía su exposición y sus respuestas tardías se ignoran. No se promete cancelar una petición ya enviada. El comando incierto se conserva en memoria de esa sesión, sin guardar tokens ni un diario privado en el navegador.

Una captura confirmada de idea invalida explícitamente el snapshot de campañas mediante `synchronizeIdea(savedId)`, incluso en READY. Las lecturas se serializan: si la confirmación llega durante una lectura anterior, se descarta esa respuesta para efectos de confirmación y se realiza una lectura posterior; varios avisos se agrupan. Si hay una escritura activa, la lectura espera su terminación. La sincronización no sustituye ni elimina comandos pendientes ni cambia sus claves. Un error de lectura mantiene el bloqueo hasta recuperar estado canónico. La interfaz exige además que las ideas visibles coincidan en ID, versión y estado con las recuperadas por campañas antes de ofrecer transiciones. No copia las tarjetas a ese snapshot. El último aviso se conserva en el store de sesión para evitar lecturas duplicadas por remount o Strict Mode. Véase la [regresión P1](../output/reports/raxi-hq-v10/P1_CAMPAIGN_SNAPSHOT_SYNC.md).

## Revisión y activación

Antes de autorizar: revisar SQL y diff, resultados de pruebas, inventario remoto y política de acceso; verificar que no hay campañas duplicadas por idea ni datos históricos incompatibles. Las validaciones usan una base PostgreSQL aislada con PGlite y roles Auth simulados; no sustituyen la aceptación remota posterior al despliegue autorizado ni prueban contención entre conexiones físicas independientes.

Tras aprobación expresa: aplicar exclusivamente la quinta migración pendiente con el procedimiento acordado, ejecutar advisors y pruebas de roles/rollback, desplegar `campaign-command` y probar el flujo con una **idea de aceptación distinta** de la primera idea real. Antes y después comparar la primera idea y su auditoría. No ejecutar reset, seeds, reconstrucciones Aria ni reimportar las cuatro migraciones existentes. No aplicar automáticamente este documento.

Este incremento conserva los límites pequeños de los contratos actuales (100 campañas, revisiones y auditoría acotadas; máximo 1000 recibos de comandos por workspace en esta versión). La paginación/proyección incremental es una evolución separada antes de ampliar esos límites.

Fototeca: [plan separado](RAXI_HQ_V10_FOTOTECA_PLAN.md). Ejecución de agentes: [plan separado](RAXI_HQ_V10_AGENTS_PLAN.md). Evidencias: `output/reports/raxi-hq-v10/VALIDATION.md`.

## Procedimiento propuesto de despliegue y recuperación

Este procedimiento requiere revisión y autorización; no se ejecutó sobre Supabase remoto en este incremento.

1. Confirmar proyecto, inventario y respaldo recuperable del esquema/datos. Comparar las cuatro versiones remotas con las cuatro migraciones históricas del repositorio; comprobar las constraints y roles que utiliza la quinta. Buscar duplicados de `(workspace_id, source_idea_id)` y revisiones/entregables incompatibles con los nuevos triggers antes del DDL. No marcar una migración como aplicada para ocultar diferencias.
2. Repetir las pruebas locales con las cinco migraciones, revisar permisos de las dos RPC y el bundle generado (`npm run build:campaign-function`, seguido de build/tests). Antes de activar para usuarios, validar también el entorno Supabase de ensayo con Auth real, la plataforma Edge y dos conexiones independientes compitiendo por el mismo workspace.
3. Aplicar únicamente `20261020234358_raxi_hq_campaign_strategy_pending_review.sql` mediante el flujo de migraciones revisado, dentro de una transacción. El archivo depende del esquema de las cuatro versiones existentes, de `auth.uid()`, `auth.jwt()` y de los roles de Supabase. No contiene seeds ni cambios de datos editoriales de la primera idea. Si falla cualquier sentencia, hacer rollback de esa transacción y conservar el diagnóstico sin credenciales; corregir la propuesta antes de reintentar. No ejecutar reset ni duplicar versiones.
4. Desplegar `campaign-command` con JWT obligatorio y secretos administrados exclusivamente por el servidor. Verificar también `getUser`, rechazo anónimo/propietario ajeno, CAS, respuesta perdida y replay contra PostgreSQL. El navegador nunca recibe la credencial privilegiada. La lectura RPC detecta disponibilidad del esquema; un fallo de despliegue Edge debe resolverse antes de autorizar el uso, pues la disponibilidad de lectura por sí sola no prueba el transporte de escritura.
5. Publicar el frontend solo después de esa aceptación. Probar con una nueva idea de aceptación autorizada; comparar antes/después la primera idea y toda su auditoría. Conservar recibos, versiones y evidencia de la operación.

Si el despliegue de la función falla después del DDL, mantener o restaurar el frontend anterior, sin habilitar los nuevos comandos; no generar datos de prueba en producción para diagnosticarlo. Si ya existen escrituras válidas, preferir una migración correctiva hacia delante y una versión compatible de la función. No eliminar columnas, recibos, aprobaciones ni triggers de historial para volver atrás. Una restauración desde respaldo exige una decisión explícita y reconciliación de las escrituras posteriores; no forma parte de este PR. Los errores de una operación se revierten atómicamente; el cliente conserva el comando incierto y consulta su recibo antes de reintentarlo.
