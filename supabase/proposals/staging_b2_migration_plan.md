# Propuesta consolidada para staging B2 — NO APLICAR

Base revisada: `b56b26567bc97078fa58ef16385b851d890d6408`, merge de PR #20 con el correctivo de revocación. No hay SQL nuevo aplicable ni entradas añadidas a migrations/. Esta propuesta consolida el orden y las fuentes; no duplica su DDL ni contiene un ejecutor.

Destino único: raxi-hq-staging, `zvhxjindgyvtasstfjut`, organización `qpjzdqkvjzgqwvismeku`, us-east-2, PostgreSQL 17. Producción `jrkefsylpfriiqefcmzq` queda prohibida. El estado cero migraciones/cero tablas Raxi procede de confirmación del usuario; este PR no lo consultó remotamente ni lo cambió.

## Paquete propuesto

El manifiesto [raxi-hq-staging.manifest.json](../staging/raxi-hq-staging.manifest.json) contiene siete SHA-256 de fuentes, orden, versiones base y exclusiones. Se normalizan solo CRLF a LF antes del hash SQL; no se normaliza otro contenido. Su objeto JSON canónico está fijado en el verificador con SHA-256 `872378b984779365f3bd0106a13191edfddf99978e3faa8b0c6eb76f6d919ce4`. Reordenar claves/formatear JSON no cambia significado; cambiar campos, orden de pasos, fuente o versión requiere nueva revisión de código y huella.

| Paso | Versión / fuente | Dependencias y revisión |
| --- | --- | --- |
| 1 | 20261019030541 — raxi_hq_v09_private_core.sql | Auth/Storage/roles nativos de Supabase; núcleo RLS y relaciones por workspace |
| 2 | 20261019030659 — raxi_hq_v09_fk_indexes.sql | Núcleo del paso 1; índices de FK |
| 3 | 20261019030808 — raxi_hq_v09_workspace_onboarding.sql | Workspace del paso 1; permisos de inserción sujetos a RLS |
| 4 | 20261019231655 — raxi_hq_real_idea_write.sql | Núcleo/onboarding; funciones de ideas existentes. No importa ideas ni llama a su Edge |
| 5a | proposals/agent_runtime.sql | Cuatro bases; políticas, runs, leases, reservas y eventos |
| 5b | proposals/supervised_host_stage_a.sql | Runtime; aprobaciones independientes, versiones y journal con P2 íntegro |
| 5c | proposals/supervised_host_stage_b.sql | A; identidad alojada, auth.sessions/not_after y auth.users/is_anonymous, solo simulación |

5a→5b→5c formarán **una futura migración consolidada**, cuya versión permanece `null`: NO ASIGNADA/NO AUTORIZADA. No se inventa una marca temporal ni se registra una migración aplicada. Después de revisión y autorización se generaría el archivo mediante la CLI aprobada y se fijaría su versión y contenido en otro cambio revisable. Las referencias de funciones PL/pgSQL entre runtime/A se resuelven al usarlas: no se debe habilitar ninguna ejecución con el grupo a medio instalar.

La quinta migración existente `20261020234358_raxi_hq_campaign_strategy_pending_review.sql` no forma parte del paquete: campañas es otro incremento y no es dependencia de runtime. **No ejecutar un db push genérico contra este repositorio**, porque podría incluirla. El futuro procedimiento deberá usar un paquete aislado con las cuatro bases y la consolidación expresamente aprobada, nunca el enlace/credenciales de producción.

`verifySqlSources` devuelve las fuentes verificadas en memoria. La prueba local concatena únicamente 5a/5b/5c después de las bases del fixture, sin escribir una migración, copiar filas o acceder a Supabase. Para una aplicación futura se propone una transacción completa por el grupo consolidado y verificación antes/después; el comportamiento concreto de la CLI y de la recuperación deberá probarse cuando se autorice. No hay garantía alojada de atomicidad acreditada por esta entrega.

## Esquema y permisos esperados

El catálogo candidato [expected-schema.json](../staging/raxi-hq-staging.expected-schema.json) procede de un fixture PostgreSQL 18/PGlite: 20 tablas Raxi con RLS y 23 funciones Raxi, todas invoker. Cada tabla/relación incluye huella de columnas/tipos/defaults, constraints, índices, triggers, RLS, políticas y grants relevantes. Las funciones ligan firma, definición, search_path, SECURITY DEFINER/INVOKER y grants. Se registran superuser/bypassrls de anon/authenticated/service_role. No contiene filas, cuentas, tokens ni propietarios de datos. Las definiciones se hashean; no se guardan conversaciones ni respuestas de agentes.

No se considera un catálogo validado de PG17. `schemaCompatibility.status=PENDING_PG17_REVIEW`, `executionReady=false`, todas las autorizaciones false y versión consolidada null mantienen B2 bloqueada. El campo null de expectedReadyMigrationVersions es un bloqueo, nunca una versión aceptable en el historial remoto. Una revisión futura deberá reconciliar PG17 y los esquemas nativos Auth/Storage, generar/revisar las huellas correctas y registrar la versión consolidada antes de cambiar ese estado.

| Actor | Frontera conservada |
| --- | --- |
| anon/PUBLIC | Sin nuevas capacidades de escritura supervisada; revisar EXECUTE efectivo y helpers de trigger |
| authenticated | Lecturas por propietario bajo RLS; sin RPC de escritura supervisada ni tokens de lease |
| service_role | Capacidad administrativa de servidor, bypass RLS; RPC allowlist y comprobaciones explícitas de sesión/propietario. No credencial del navegador |
| postgres/admin | Aplicación futura revisada, respaldo e inyección de fallos de ensayo; nunca identidad del host |

No se añade SECURITY DEFINER, proveedor, worker, coordinador ni ledger. No se modifican las siete fuentes SQL revisadas. El snapshot no constituye auditoría exhaustiva de Auth/Storage, membresías de roles, secuencias/tipos adicionales, privilegios por defecto o configuración GoTrue; son aceptaciones pendientes en PG17/B2. El estado EMPTY exige ninguna tabla/vista/relación foránea pública inesperada además de cero relaciones/funciones Raxi inspeccionadas, y versiones exactas: si una extensión aporta objetos adicionales, detenerse y revisar su procedencia, sin ignorarlos silenciosamente.

## Autorizaciones separadas

Este PR autoriza solo preparación local. Aplicar el paquete, aprovisionar cuentas y ejecutar B2 requieren revisiones separadas. No configurar una política REAL ni registrar openai/Aria durante esos ensayos: el host B1 conserva simulatedProvider y liveEnabled:false. Ni una migración aplicada ni una cotización autorizarían por sí solas IA facturable.

Respaldo, restauración, límites PG17 y operación: [procedimiento de preparación](../../docs/RAXI_HQ_STAGING_B2_PREPARATION.md).
