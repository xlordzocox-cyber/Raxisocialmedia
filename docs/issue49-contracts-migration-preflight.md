# Issue #49 · Contratos y migraciones: preflight verificado (2026-11-05)

> **Estado: AUDITORÍA, NO APTO PARA DESPLIEGUE.** No autoriza SQL remoto de escritura, deploy de Edge Functions, runtime hosted, proveedores ni gastos.

## Fuentes y alcance

- Código auditado: `main` tras PR #48, y archivos `supabase/migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql`, `supabase/proposals/agent_runtime.sql`, `supabase/proposals/supervised_host_stage_a.sql`, `supabase/proposals/supervised_host_stage_b.sql`, `supabase/functions/campaign-command/{index,handler}.ts`, `apps/raxi-hq/src/persistence/realCampaignStore.ts`, `apps/raxi-hq/src/runtime/RuntimeOfficePanel.tsx`.
- Fuente remota **solo lectura**: Supabase `raxi-hq` (`jrkefsylpfriiqefcmzq`), consultas de `pg_catalog`, `information_schema` y `supabase_migrations.schema_migrations`; inventario de Edge Functions.
- Propuestas de runtime **no** incluidas en las migraciones actuales; Stage B1 prevé staging aislado, no producción.
- El manifiesto `supabase/staging/raxi-hq-staging.manifest.json` registra `executionReady: false`, permisos `applySql/runB2/deploy/realProviders: false` y excluye expresamente la migración pendiente de campañas.

## Inventario remoto observado

| Componente | Resultado |
|---|---|
| Proyecto `raxi-hq` | ACTIVE_HEALTHY, PostgreSQL 17 |
| Historial migraciones | 20261019030541, 20261019030659, 20261019030808, 20261019231655 |
| Tablas `public.raxi_*` | 18, RLS habilitado en las 18; las políticas **no han pasado aún QA de aislamiento** |
| RPCs `public.raxi_*` | `raxi_create_manual_idea`, `raxi_create_workspace`, `raxi_get_workspace`, `raxi_list_manual_ideas` |
| `raxi_campaign_snapshot`, `raxi_campaign_commit`, `raxi_runtime_office` | Ausentes de `public` |
| `raxi_workspaces.campaign_version` | Ausente |
| Edge Functions listadas | Solo `create-real-idea` activa; `campaign-command` ausente |

**Alcance de la conclusión:** se inspeccionó `public`, no se afirma ausencia universal en todos los esquemas. Presencia de RLS no demuestra por sí sola que sus reglas bloqueen accesos cruzados.

## Contrato de campañas propuesto

### Lectura — `raxi_campaign_snapshot(p_workspace uuid,p_actor uuid default null)`

- El cliente `RealCampaignStore.read` usa RPC con `p_workspace`; el servidor `campaign-command` requiere lectura con `p_actor` validado.
- La propuesta SQL es `SECURITY INVOKER`; resuelve propietario con `auth.uid()` salvo cuando el rol de ejecución es `service_role`.
- Retorno esperado: `workspaceId`, `ownerId`, `version`, `serverTime`, `ideas[]`, `handoffs[]`, `session` con campañas/estrategias/decisiones/auditoría y `receipts[]`.
- Criterios: rechazo anónimo, autorización de propietario por workspace, no filtración entre usuarios, tipos/orden canónicos, lectura estable ante concurrencia, límites de respuesta.

### Escritura — Edge `campaign-command` y RPC `raxi_campaign_commit`

- Handler valida Bearer JWT vía `getUser`, rechaza anónimos, limita body a 100 KB, usa `validateCampaignOperation` y `applyCampaignOperation`.
- `campaign-command` usa servidor `service_role` para lectura/commit: requiere asegurar que ninguna entrada no autenticada o con `p_actor` forjado llegue a RPC privilegiada.
- SQL propuesto: bloqueo del workspace, control de versión `campaign_version`, ID único de operación, recibos, restricciones de transiciones, auditoría, historial de estrategia y aprobaciones inmutables.
- Debe validarse que la proyección `p_next` enviada por la capa cliente/Edge no pueda escribir información ajena, saltar revisiones o falsificar decisiones/fechas incluso frente a entradas directas privilegiadas malformadas.
- Debe verificarse la definición exacta de constraints y triggers en PostgreSQL 17, más el comportamiento de `SECURITY INVOKER`/GRANTs/RLS. No asumir equivalencia semántica del comparador de constraints sin evidencia PG17 reproducible.

### Dependencias antes de ensayo

1. Confirmar que los cuatro archivos baseline coinciden con el historial remoto; jamás reaplicar baseline a producción.
2. Revisar colisión de nombres, constraint `raxi_campaigns_provenance_check`, indexes/triggers existentes, estado y procedencia de datos.
3. Conciliar `campaign_version` faltante con default/índice/operaciones concurrentes.
4. Preparar prueba offline en PostgreSQL 17 con migración de campañas **solo candidata**, rollback y fixtures sintéticos; recopilar SHA-256, versión motor, inventario antes/después y resultados negativos.
5. Revisar con especial atención `raxi_workspaces_slug_check`, objeto involucrado en los ensayos históricos PR #39; el PR aparece fusionado pero ese hecho no certifica por sí solo el resultado de la última reproducción.
6. Solo después plantear permiso independiente para SQL en staging y publicación Edge; producción no entra en este paso.

## Contrato runtime (ruta separada)

- `RuntimeOfficePanel` realiza `rpc('raxi_runtime_office',{p_workspace})` cada 5 s; esta RPC no existe en la base inspeccionada. La interfaz muestra indisponibilidad y mantiene deshabilitada la solicitud de investigación.
- `agent_runtime.sql`: propuesta con políticas/budgets, `raxi_agent_runs`, claims/leases, eventos, recibos. **No instalado en producción**.
- `supervised_host_stage_a.sql`: contrato de supervisión/fixture local y journal; la simulación debe permanecer etiquetada.
- `supervised_host_stage_b.sql`: propuesta de entrada privilegiada `raxi_supervised_host_command`, sesiones `auth.sessions`, propietario y binding a staging. No es una autorización de despliegue.
- No hay puente LIVE conectado por defecto al `HQStore` visual: se inicializa con `disconnectedLiveSource`. Ninguna animación debe representar actividad no confirmada.
- Verificar aislamiento por workspace, estado de sesión/revocación, identidad de ejecución, aprobación humana, prohibición de doble cobro/reintento, ledger inmutable y fail-closed ante caída del proveedor.
- **No crear ni habilitar proveedores reales, costes, SQL Stage B ni jobs operativos** hasta QA y autorización separada.

## Gates de aceptación (sin falsos PASS)

- [ ] Auditoría estructural PG17 reproducible y compatibilidad constraints/funciones: PASS con evidencia adjunta.
- [ ] Migración candidata de campaña probada offline en DB aislada; todos los ensayos negativos PASS.
- [ ] Pruebas de tenant cruzado, invocación anon/authenticated/service_role y funciones `SECURITY INVOKER` verificadas.
- [ ] CAS, idempotencia, consistencia cliente-servidor y recibos recuperables verificados.
- [ ] Diff de esquema sin cambios fuera del alcance; `git diff --check`, tests, typecheck, build, auditoría de dependencias y revisión independiente.
- [ ] Runtime tratado en PR aparte; pruebas supervisadas y SQL stage B con autorización posterior.
- [ ] Despliegue o merge **solo** con autorización posterior. Campus DEMO/MOCK queda para la última etapa, no se modifica aquí.

## Estado al cerrar esta auditoría

Este archivo documenta **evidencia confirmada y gates pendientes**, no declara lista una migración. Ningún SQL de escritura, deploy, creación de usuarios, proveedor ni publicación fue ejecutado.
