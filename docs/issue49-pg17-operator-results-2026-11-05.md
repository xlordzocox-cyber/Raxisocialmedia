# Resultados del operador — laboratorio PG17 (2026-11-05)

Estado: **PARCIALMENTE VALIDADO / NO-GO DESPLIEGUE**.

Laboratorio aislado: PostgreSQL 17.11, contenedor `raxi-pg17-campaign-qa` sin red ni puertos publicados; cuatro migraciones base y candidata de campañas aplicadas **solo localmente**. Se confirmaron 18 tablas `raxi_*`, `campaign_version` tipo `bigint`, y las dos RPC `raxi_campaign_snapshot` y `raxi_campaign_commit` con `SECURITY INVOKER`.

## Evidencia entregada por el operador

- `issue49_pg17_campaign_rls_negative.sql`: PASS GRANTS, PASS SEC-02, `p_actor` falsificado ignorado, cross-tenant denegado `42501`. Final `ROLLBACK`.
- `issue49_pg17_campaign_cas_approval_negative.sql`: PASS CAS-NEG (`40001`), OWNER-NEG (`42501`), APPR-NEG UPDATE/DELETE (`23514`). Final `ROLLBACK`.
- `issue49_pg17_campaign_idempotency_positive.sql`: PASS IDEMP-POS, IDEMP-REPLAY, IDEMP-CONFLICT (`23505`), CAS-POST (`40001`). Final `ROLLBACK`.
- `scripts/issue49-pg17-race.ps1` (commit probado `107934db3666e337e14accde7bdc8379b5e4cce0`): dos sesiones PostgreSQL independientes. PASS RACE WINNER (COMMIT versión 1); PASS RACE LOSER (espera y `40001`); PASS RACE VERIFY (un incremento, una auditoría, un recibo, una transición); PASS CONCURRENCY; CLEANUP PASS con cero filas sintéticas restantes. Una ejecución anterior falló por un marcador de apertura PL/pgSQL mal formado en el verificador, corregido antes de repetir.

El entorno `auth`/`storage` es un **fixture local**, no Supabase Auth real. Esta evidencia es la salida compartida por el operador; no representa una ejecución independiente de CI.

## Strategy: primer intento fallido (fixture)

El operador ejecutó `issue49_pg17_strategy_history_negative.sql` sobre el laboratorio y el `INSERT` inicial de entregables en estrategias ya `IN_REVIEW` / `APPROVED` fue rechazado por el trigger `raxi_protect_deliverable_history` con `historical deliverables are immutable`. **No es una falla demostrada del trigger, sino un fixture inválido**. La transacción no se confirmó; limpieza aún debe verificarse con lectura antes del reintento. Se corrigió la preparación: insertar revisiones y entregables en `DRAFT`, luego transicionar a `IN_REVIEW` y finalmente `APPROVED` / `CHANGES_REQUESTED`. Commit `ffc71e1359964eadd6eae38bd29e315c96ecaf1b`. La quinta batería se repitió sobre el commit `da2782bef98656e563cb0600a774904209e79c95` y el operador confirmó seis avisos PASS: DRAFT editable, IN_REVIEW contenido inmutable, sin regresión a DRAFT, historial APPROVED/CHANGES_REQUESTED, entregables congelados e identidad inmutable y aprobación única/inmutable. Final `ROLLBACK`, código SQL sin error. **PASS local para restricciones SQL**, todavía no para el flujo RPC completo.

## Strategy RPC: sexta batería PASS

El operador ejecutó `supabase/tests/issue49_pg17_strategy_rpc_flow.sql`, commit `8e854642d43b821e258c1499f8a4c79943708072`, en PostgreSQL17 aislado. Se observaron siete avisos PASS: SAVE (borrador+entregable), SUBMIT, rechazo de alteración de entregable enviado, rechazo de APPROVE sin `confirmed=true`, APPROVE con registro de auditoría/aprobación, replay idempotente, rechazo de mutación tras APPROVED. Final `ROLLBACK`; código SQL sin errores. Es evidencia de validación del *flag* de confirmación, no de autenticación real de un humano.

## Gates pendientes

- Strategy y deliverables: tablas y flujo RPC SAVE/SUBMIT/APPROVE PASS local; falta REQUEST_STRATEGY_CHANGES y START_STRATEGY_REVISION para completar el recorrido.
- Compatibilidad/atestación estructural PG17 del incidente PR #39.
- JWT, Auth, RLS e integración de Edge en un entorno Supabase real autorizado.
- Revisión independiente, pruebas automatizadas de integración y restricciones FanView/NSFW por canal.

No se autorizó SQL remoto, despliegue, proveedores de pago ni integración del PR #50.