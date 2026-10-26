# PR #21 — preparación segura de staging, sin ejecutar B2

Main verificado: `b56b26567bc97078fa58ef16385b851d890d6408`. PR #19 y #20 integrados. Se continúa desde los cambios locales recuperados en `feature/raxi-hq-staging-b2-preparation`; no se descartó material ni se tocaron las diez eliminaciones de imágenes del checkout original.

## Identidad y autoridad

Destino fijado en código y manifiesto:

| Campo | Valor |
| --- | --- |
| Proyecto | raxi-hq-staging |
| Ref | zvhxjindgyvtasstfjut |
| Organización | qpjzdqkvjzgqwvismeku |
| Región | us-east-2 |
| PostgreSQL requerido | 17 |
| Producción prohibida | jrkefsylpfriiqefcmzq |

Estado inicial de staging aportado por el usuario: ACTIVE_HEALTHY, cero migraciones y cero tablas públicas Raxi. Se registra `USER_CONFIRMED_NOT_REQUERIED`, sin inventar fecha de lectura ni created_at. No hubo consultas SQL, Management API, Auth, RPC o Storage alojadas en esta entrega.

Una etiqueta o variable de entorno no prueba aislamiento. El guard B2 exige ahora el ref/API exactos además de las defensas previas de URL de PostgreSQL, TLS, rechazo de producción, consentimiento y archivo de aprobación con hash. La comprobación futura de Management exige ID, nombre, organización, región y estado de la respuesta autenticada, no datos suministrados por el navegador. La versión PG y el esquema se comprobarían por la conexión SQL autorizada. La fecha created_at seguirá necesitando confirmación para la aprobación del runner; no se deduce de este manifiesto.

El runner carga el manifiesto del repositorio sin ruta alternativa desde env, verifica su huella canónica, las siete fuentes SQL y el catálogo candidato, y liga la aprobación externa a esa misma huella. El manifiesto actual fuerza un rechazo **antes de cualquier conexión alojada**, incluso con flags y aprobación futura compatibles: ejecución no autorizada, versión consolidada no asignada y PG17 pendiente. No se añadieron credenciales ni configuración local para desbloquearlo.

## Artefactos y comprobación offline

- `supabase/staging/raxi-hq-staging.manifest.json`: proyecto, base, estado inicial informado, siete fuentes/huellas y autorizaciones false.
- `supabase/staging/raxi-hq-staging.expected-schema.json`: catálogo candidato del fixture local, nunca snapshot remoto.
- `apps/raxi-hq/scripts/staging-manifest.mjs`: validación de hashes/identidad/esquema; lecturas de catálogo sin DDL.
- `apps/raxi-hq/scripts/verify-staging-preparation.mjs`: comprobación offline, sin proveedor, SQL o red.
- [Propuesta consolidada](../supabase/proposals/staging_b2_migration_plan.md): orden 4 bases + runtime/A/B, exclusión de campañas, permisos y dependencias.

Desde apps/raxi-hq, ejecutar únicamente `node scripts/verify-staging-preparation.mjs` para comprobar el paquete offline. Debe indicar siete fuentes, executionReady:false, PENDING_PG17_REVIEW, remoteAccess:false y sqlApplied:false. La comparación acepta solo diferencias de finales CRLF/LF en SQL y formato/orden de claves JSON; no acepta cambios semánticos. Un cambio revisado del paquete requiere actualizar conjuntamente manifiesto, pin de código y evidencias; regenerar hashes por sí solo no es una aprobación.

Las pruebas usan copias de metadatos y PGlite locales. Rechazan proyecto/organización/región incorrectos, producción, manifiestos o fuentes alterados, versiones/orden distintos, campos adicionales, autorización caducada (incluido el límite exacto), configuración incompleta y esquema inesperado. Verifican el snapshot contra el catálogo de un fixture y detectan una columna añadida. El lector SQL captura el manifiesto antes de await para que una mutación externa no altere el paquete medido.

## PostgreSQL 17 frente a 18

El entorno instalado de PGlite informa PG18. El chequeo local no encontró psql/pg_ctl/postgres en PATH, un servicio/proceso postgres activo ni psql en la ruta estándar de PG17. Eso no demuestra que no pueda existir otra instalación, pero no se identificó un entorno PG17 disponible y autorizado para este ensayo. No se instalaron binarios ni se iniciaron servicios, contenedores o servidores.

El catálogo local PG18 no se renombra como PG17. Está explícitamente ligado al hash del manifiesto como candidato, con su versión real. B2 permanece bloqueada hasta una validación PG17 autorizada y revisión de diferencias en catálogos, grants y Auth/Storage. El inspector depende de representaciones pg_get_* y configuración de search_path: diferencias legítimas también deben detenerse para revisión, no normalizarse o aceptarse a ciegas. PG17 y el historial de migraciones exacto se validarán juntos; un rótulo PG17 no sustituye la consulta real.

## Procedimiento futuro — requiere autorización, NO ejecutado

1. Revisar y aprobar el paquete, permisos y coste existente de staging; verificar identidad con metadatos autenticados. Nunca enlazar producción ni reutilizar sus credenciales.
2. Autorizar una inspección de solo lectura del staging vacío: historial, relaciones públicas/funciones, PG17, Auth/Storage, roles/grants/default privileges y estado. Comparar con el baseline; detenerse ante cualquier diferencia.
3. Obtener respaldo protegido del entorno staging antes de cualquier cambio. Documentar esquema, extensiones, roles/grants, versiones, hash y fecha. Usar una ubicación privada con acceso/retención revisados; nunca Git ni una copia de usuarios/filas de producción.
4. Cuando exista un PG17 autorizado, validar el SQL y compatibilidad, revisar/registrar su catálogo y actualizar el manifiesto mediante PR. Crear la versión consolidada con la CLI aprobada, todavía fuera de cualquier aplicación automática. No ejecutar db push genérico que incluya la quinta migración de campañas.
5. Tras una autorización independiente de DDL, aplicar solo el paquete revisado en staging, comprobar transacciones/rollback e inventario antes/después y registrar los hashes efectivamente aplicados. Detener ante drift o aplicación parcial; no marcar READY por contar funciones únicamente.
6. Autorizar por separado las dos cuentas/workspaces y política exclusivamente simulada. No copiar usuarios ni claves de producción. Revocación conservará el procedimiento P2 de #20: logout sin error, sesión SQL ausente, JWT vigente y rechazo específico; una caída no cuenta como aceptación.
7. Solo después de revisión del manifiesto READY/PG17, versión asignada y autorización de B2, ejecutar el opt-in. Mantener un único coordinador, journal, reserva e intento. El runner sigue declarando aceptación parcial, no B2 completa ni IA REAL.

## Respaldo y reversión

La reversión actual es de código: no se ha cambiado staging. Retirar el paquete/guard de una composición futura no exige rollback de producción. No hay servicio que apagar ni credenciales que rotar por este PR.

Para DDL autorizado posteriormente: confirmar backup y restauración verificables antes de aplicar; después de un fallo detener nuevas admisiones, preservar journal, auditoría, reservas y comandos inciertos, y contrastar inventario/recibos. No usar DROP automático ni desactivar triggers para forzar aceptación. Restaurar solo en un entorno aislado autorizado y verificar invariantes y versiones antes de reanudar. Si restaurar requiere otro proyecto o recursos, pedir autorización previa; no crearlos para probar por iniciativa del runner.

Los backups de la base no incluyen los archivos originales de Storage y pueden excluir contraseñas de roles personalizados. Cualquier archivo staging requeriría respaldo separado; este ensayo no crea ni importa fotografías. No se asume que el plan de la cuenta incluya backups/PITR ni se contratan extras. [Documentación oficial de respaldo](https://supabase.com/docs/guides/platform/backups).

## Riesgos y estado

| Prioridad | Pendiente / control |
| --- | --- |
| P1 | Compatibilidad PG17 no demostrada; flag, hash y versión pendiente bloquean ejecución |
| P1 | Autorización de preparación no concede DDL, cuentas o ejecución; todas esas capacidades siguen false |
| P2 | Catálogo local no audita exhaustivamente Auth/Storage, membresías, secuencias/tipos adicionales, default grants o GoTrue; revisión B2 pendiente |
| P2 | Huellas son integridad, no firma frente a quien puede modificar simultáneamente código y manifiesto; revisión humana del PR necesaria |
| P2 | No se reconsultó el staging; baseline informado no es prueba de estado actual |
| P3 | Captura de catálogo depende de versión/search_path; diferencias legítimas también hacen fallar el guard y requieren revisión |

No se modifica Guardian, OfficeScene, AgentMotion, RuntimeOfficeStore ni HISTORICAL_REPLAY. No se registra proveedor REAL, no se ejecuta IA, no se publican contenidos y no se modifica producción. La pérdida de recibos antes del primer commit sigue bloqueando C, fuera del alcance de este PR.

Resultado esperado de PR #21: **preparación local verificable, B2 NO COMPLETADA y SIN AUTORIZAR**. Evidencia final: [validación PR21](../output/reports/raxi-hq-runtime/STAGING_B2_PREPARATION_VALIDATION.md).
