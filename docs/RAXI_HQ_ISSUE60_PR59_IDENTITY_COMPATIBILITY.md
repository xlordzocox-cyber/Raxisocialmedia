# Issue #60 · Preflight de identidad Stage B en staging (PR #67)

**Estado:** candidato SQL y laboratorio efímero, **NO** aplicado a Supabase. No autoriza publicar ni ejecutar agentes.

## Evidencia directa del proyecto staging (14 nov 2026)

- Proyecto `raxi-hq-staging` `zvhxjindgyvtasstfjut`; PostgreSQL 17.11, ACTIVE_HEALTHY.
- Inventario: 7 migraciones registradas: core v0.9 ×4, campaign strategy ×1, PR59 identidad + solicitudes supervisadas ×2.
- `raxi_agent_profiles`, `raxi_agent_tasks`, `raxi_agent_events`: 0 filas cada una. Tablas `raxi_agent_runs`, `raxi_runtime_policies` inexistentes, RPCs `raxi_runtime_*` inexistentes.
- **Conflicto confirmado:** `raxi_supervised_host_identity(jsonb)` ya existe por PR59, SECURITY INVOKER, `md5(pg_get_functiondef(...))=00412a774d012f21ce0e9be5a58da5f1`. La propuesta original `supervised_host_stage_b.sql` usa `CREATE FUNCTION` para la misma firma.
- La función actual exige `projectRef` **igual exactamente** a `zvhxjindgyvtasstfjut`, además de sesión/actor/workspace y vigencia. Reemplazarla por una versión genérica de longitud de projectRef debilitaría el límite.

## Adaptación propuesta

- `issue60_stage_b_staging_identity_compatible.candidate.sql` conserva todos los demás contratos Stage B, **sin borrar ni reemplazar** esa función.
- Exige identidad previa con propietario `SECURITY INVOKER`, EXECUTE para `service_role` y rechazo de `anon`/`authenticated`. Exige referencia al proyecto staging.
- En laboratorio PG17, se crea una función **sintética** con la misma firma (no copia de datos ni credenciales) y se comprueba su definición byte a byte antes/después de aplicar la candidata. También se prueba que `raxi_supervised_host_command` queda restringido a `service_role`.
- Luego pasa las negativas existentes de recibos únicos, política revocada, lease expirado y rollback.
- **Límite del ensayo:** no prueba el cuerpo real de Auth ni JWT alojado. El catálogo del proyecto auténtico solo se leyó sin escribir.

## Orden de ejecución futuro, sujeto a revisión

1. Cotejar catálogo y migraciones reales con el manifest. No editar los blobs pinneados de `agent_runtime.sql`, Stage A o Stage B.
2. Construir un paquete aprobado atómico para **staging** con `agent_runtime`, Stage A, Stage B compatible y el add-on `issue60_runtime_dispatch_receipt.sql`. No dejar `GRANT ALL` de `service_role` expuesto transitoriamente.
3. Validar Auth/JWT/RLS y denegación de workspace ajeno. Verificar mismo cuerpo de `raxi_supervised_host_identity` antes/después; auditar funciones y privilegios.
4. Con host deshabilitado/proveedores desconectados, la oficina REAL todavía tendrá 0 agentes hasta una tarea **autorizada** con evento verificado.
5. Una primera tarea de Director IA requiere autorización separada de proveedor/modelo, límites económicos, ejecución manual y detención. Investigador solo con transición real y auditada.

**Advertencia:** el manifest de preparación versionado sigue `executionReady=false` y `authorizations.applySql=false`. Este PR no modifica esas banderas ni ejecuta migraciones.
