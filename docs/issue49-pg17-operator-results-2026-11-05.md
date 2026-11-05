# Resultados del operador — laboratorio PG17 (2026-11-05)

Estado: **PARCIALMENTE VALIDADO / NO-GO DESPLIEGUE**.

Laboratorio aislado: PostgreSQL 17.11, contenedor `raxi-pg17-campaign-qa` sin red ni puertos publicados; cuatro migraciones base y candidata de campañas aplicadas **solo localmente**. Se confirmaron 18 tablas `raxi_*`, `campaign_version` tipo `bigint`, y las dos RPC `raxi_campaign_snapshot` y `raxi_campaign_commit` con `SECURITY INVOKER`.

## Evidencia entregada por el operador

- `issue49_pg17_campaign_rls_negative.sql`: PASS GRANTS, PASS SEC-02, `p_actor` falsificado ignorado, cross-tenant denegado `42501`. Final `ROLLBACK`.
- `issue49_pg17_campaign_cas_approval_negative.sql`: PASS CAS-NEG (`40001`), OWNER-NEG (`42501`), APPR-NEG UPDATE/DELETE (`23514`). Final `ROLLBACK`.
- `issue49_pg17_campaign_idempotency_positive.sql`: PASS IDEMP-POS, IDEMP-REPLAY, IDEMP-CONFLICT (`23505`), CAS-POST (`40001`). Final `ROLLBACK`.
- `scripts/issue49-pg17-race.ps1` (commit probado `107934db3666e337e14accde7bdc8379b5e4cce0`): dos sesiones PostgreSQL independientes. PASS RACE WINNER (COMMIT versión 1); PASS RACE LOSER (espera y `40001`); PASS RACE VERIFY (un incremento, una auditoría, un recibo, una transición); PASS CONCURRENCY; CLEANUP PASS con cero filas sintéticas restantes. Una ejecución anterior falló por un marcador de apertura PL/pgSQL mal formado en el verificador, corregido antes de repetir.

El entorno `auth`/`storage` es un **fixture local**, no Supabase Auth real. Esta evidencia es la salida compartida por el operador; no representa una ejecución independiente de CI.

## Gates pendientes

- Strategy y deliverables: transiciones, historial inmutable, comprobaciones de aprobación por el flujo completo.
- Compatibilidad/atestación estructural PG17 del incidente PR #39.
- JWT, Auth, RLS e integración de Edge en un entorno Supabase real autorizado.
- Revisión independiente, pruebas automatizadas de integración y restricciones FanView/NSFW por canal.

No se autorizó SQL remoto, despliegue, proveedores de pago ni integración del PR #50.