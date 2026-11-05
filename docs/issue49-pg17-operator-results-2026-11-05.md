# Resultados del operador, 2026-11-05

Estado: PARCIALMENTE VALIDADO. NO APTO PARA DESPLIEGUE.

Laboratorio: PostgreSQL 17.11, `raxi-pg17-campaign-qa` aislado sin red ni puertos. Cuatro migraciones base y candidata de campañas aplicadas solo localmente. 18 tablas `raxi_*`; `campaign_version` bigint; RPC `raxi_campaign_snapshot` y `raxi_campaign_commit` SECURITY INVOKER.

Pruebas reportadas por el operador (todas con `ROLLBACK`):

- `issue49_pg17_campaign_rls_negative.sql`: PASS GRANTS y aislamiento A/B; `p_actor` falsificado ignorado; SQLSTATE 42501.
- `issue49_pg17_campaign_cas_approval_negative.sql`: PASS CAS-NEG, OWNER-NEG y APPR-NEG (UPDATE y DELETE).
- `issue49_pg17_campaign_idempotency_positive.sql`: PASS IDEMP-POS, IDEMP-REPLAY, IDEMP-CONFLICT y CAS-POST; commit ensayado `a2ef33b55d422c3790d29ed12a858e11f833087a`.

Las funciones auth/storage del laboratorio son stubs, no Supabase real. Todavía NO se verificaron concurrencia efectiva de dos conexiones, integridad de Strategy/deliverables, reconciliación estructural PR39, JWT/RLS reales de Supabase, Edge desplegada, revisión independiente ni contratos de distribución FanView/NSFW. El PR sigue en borrador. No se autorizó despliegue ni SQL remoto.
