# Meta A — secuencia verificable de regresiones, SQL negativo, PG17 y staging

**Estado: QA LOCAL VALIDADO; STAGING NO AUTORIZADO / NO DESPLEGADO.**
**Rama:** `audit/meta-a-campaign-approval-negatives`. Meta A separada de PR #50, que conserva sus propios P2.

## Evidencia final de QA local (2026-11-06/07)

- **SHA validado:** `0315c8de0a5181a0ab40c9a3a5d7e1ce55e4b945` para `npm run typecheck` PASS, `node scripts/test.mjs --serial` **886/886 PASS** (0 FAIL, 0 skipped), `npm run build` PASS (592 módulos), y `node scripts/security-scan.mjs` **165 archivos / 0 hallazgos**. Ejecutado sobre detached worktree Windows pinneado; archivos versionados intactos. Evidencia del operador en conversación de QA y registro GitHub PR #53; estos comandos no demuestran autenticación Supabase real.
- **Dependencias:** `npm audit --json --audit-level=moderate --ignore-scripts` reportó **0 critical/high/moderate/low** y exit 0 en SHA `9ac9c0fc553d7e3b831a84bb093e5fb0eda69034`. Los posteriores cambios fueron solamente archivos de pruebas; `package.json`/`package-lock.json` sin modificar. No atribuir un nuevo `npm audit` al SHA actual.
- **Fallo histórico de recursos, no ocultado:** `npm test` con concurrencia predeterminada en SHA `9ac9c0f` produjo 836/838 con dos procesos Node `Fatal process out of memory: Zone` (sin aserción negativa acreditada). La repetición secuencial sobre `9ac9c0f` pasó 886/886 y build PASS. Se conserva el riesgo de OOM en máquinas con recursos limitados; preferir `--serial` como configuración de QA local.
- **PostgreSQL 17 nativo:** SHA `9ac9c0fc553d7e3b831a84bb093e5fb0eda69034`, laboratorio aislado `raxi_campaign_qa`, versión 17.11, contenedor de identidad fijada, sin red/puertos/montajes, test de dos conexiones reales con espera de bloqueo de fila. Resultado: stale CAS `40001` tras commit del ganador, cero auditoría/aprobación fabricada, limpieza 0 usuarios/workspaces, bloqueo exclusivo liberado. **Alcance limitado a actualización de versión frente a una RPC obsoleta; no dos RPC válidas simultáneas.** Evidencia GitHub PR #53 comentario 6699389476. Los cambios posteriores no alteraron el harness ni SQL.
- **Revisión externa:** Codex sobre SHA `9ac9c0f` completó 0 nuevos hallazgos, con 11/11 hilos históricos resueltos documentalmente. Nueva revisión independiente **PENDIENTE para HEAD de documentación**. Estos documentos de actualización cambian SHA y, por lo tanto, NO representan un nuevo PASS de la suite en su propio commit.
- **Permisos:** `executionReady:false`, `goDecision:NO_GO_HOSTED_CHANGES`, `authorization.*:false` permanecen inalterados. JWT/Auth/RLS alojados, revocación real, staging E2E, SQL/Edge deploy y proveedores reales NO probados ni autorizados.

## 1. QA completo sobre SHA exacto

- Confirmar `FETCH_HEAD` de esta rama contra HEAD documentado antes de ejecutar.
- En worktree temporal aislado, usando dependencias *ya instaladas*, ejecutar desde `apps/raxi-hq`:
  1. `npm run typecheck`
  2. `node scripts/test.mjs --serial` (incluye `metaACampaignSecurity.test.ts`; evita los OOM observados con concurrencia predeterminada)
  3. `npm run build`
  4. `git diff --check` contra base; inspección de paquetes y de secretos; no ejecutar scripts de integración remota.
- Registrar los conteos exactos; marcar FAIL si cualquiera falla. La suite completa pasó en Windows 886/886 sobre SHA `0315c8de0a5181a0ab40c9a3a5d7e1ce55e4b945`; **no extrapolar** automáticamente a futuras revisiones.
- **No** activar `npm run dev` para esta validación ni aceptar datos simulados como LIVE.

## 2. Pruebas negativas de SQL

- Archivo de esta rama: `supabase/tests/meta_a_campaign_projection_negative.sql`, prueba preparada; requiere base vacía `raxi_campaign_qa` + PG17 + migraciones v0.9 + propuesta campaign_strategy pendiente; `BEGIN` / `ROLLBACK` y guard de nombre de BD, cero workspaces; no ejecutarlo sobre Supabase ni entorno compartido.
- Pruebas reutilizables en PR #50 (otra rama, **no** asumir que forman parte de PR #53): `supabase/tests/issue49_pg17_campaign_cas_approval_negative.sql` y `supabase/tests/issue49_pg17_campaign_rls_negative.sql`. Verificar SHA de cada archivo antes de importarlo a una batería separada. Evitar copias divergentes.
- Cobertura mínima: JSON de idea inexistente, actor ajeno, CAS obsoleto, inmutabilidad de decisión, bloqueo `anon/authenticated`, aislamiento owner A/B, recibo idempotente, rollback, concurrencia con conexiones independientes; parte de esta cobertura **no** está incluida en el nuevo archivo y debe probarse aparte.
- El guard que comprueba 0 workspaces significa que se requiere base nueva para **cada** ensayo; no ejecutar baterías consecutivas sobre una base persistida de datos.

## 3. PostgreSQL 17 local aislado

**Preflight primero: NO ejecutar la batería si falla cualquiera.**

1. Comprobar `docker version`, versión esperada de contenedor `postgres:17`, nombre de contenedor exclusivo, ausencia de port bindings, redes aisladas y volúmenes compartidos; el contenedor nunca debe apuntar a credenciales o hostname Supabase.
2. Aprobar un nombre único de base `raxi_campaign_qa` *solo si no existe*, crear en contenedor local desechable con `--network none` y `--tmpfs`; cargar stubs mínimos Auth/Storage locales y las cuatro migraciones base, luego la migración de campañas pendiente, sin modificar manifiesto de staging.
3. Comparar configuración, RLS y catálogo con PG17; ejecutar primero pruebas negativas, y confirmar PASS exactos y retorno 0.
4. Cerrar transacciones con `ROLLBACK`, verificar estado vacío, y eliminar únicamente los recursos con identificador exacto creados para el ensayo. Registrar IDs, comandos y exit codes de forma no sensible.

La simulación `PGlite` de `campaignDatabase.ts` **no acredita** PG17 remoto. No reutilizar contenedores o bases con datos existentes.

## 4. Staging — PREPARADO, NO DESPLEGADO

Proyecto `raxi-hq-staging` (ref `zvhxjindgyvtasstfjut`), separado de `raxi-hq` principal. Inventario read-only confirmado: PostgreSQL 17.11, **0 migraciones**, **0 Edge Functions** (no hay garantía de configuración Auth ni políticas). No copiar datos de producción.

El manifiesto existente `supabase/staging/raxi-hq-staging.manifest.json` mantiene `executionReady:false`, todas las autorizaciones en false y **excluye explícitamente** `20261020234358_raxi_hq_campaign_strategy_pending_review.sql`. No modificar ese manifiesto ni agregar silenciosamente la migración a su plan de runtime B2.

Plan mínimo propuesto, **pendiente de autorización específica**:

1. Inventario read-only nuevo: ref/organización/región, versión, esquema, migraciones, Edge, políticas y Auth, con hashes del código revisado.
2. Elaborar manifiesto **separado** Meta A para las cuatro migraciones v0.9 y la migración de campaña, con orden/digest exactos, rollback, alcance y recursos de prueba; no reciclar el plan B2 ni la configuración de producción.
3. Revisar dependencia `create-real-idea`, `campaign-command`, configuración `verify_jwt`, CORS, Auth/RLS, revocación de sesiones y seguridad de secretos server-side.
4. Pedir aprobación granular para desplegar en ese proyecto, migrar, desplegar funciones y crear usuarios sintéticos (cada capacidad es distinta). No hay aprobación implícita.
5. Probar dos usuarios de staging independientes: propietario, intruso, anónimo, estado de sesión, idea→aprobación→handoff→campaña→Strategy, recarga, fallos 401/403/409/503, idempotencia, auditoría y versionado; sin proveedores reales ni publicación.
6. Registrar resultados y solo después emitir recomendación GO/NO_GO para Meta A.

## Criterio de liberación

**No declarar Meta A operativa** hasta que regresiones completas, suite PG17 nativa, política Auth/RLS y E2E de staging con evidencia pasen. No merge ni deploy de PR #53 por este documento; PR #50 sigue independiente.
