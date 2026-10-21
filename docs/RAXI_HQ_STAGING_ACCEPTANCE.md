# Ensayo aislado de campañas — propuesta, no ejecutado

No se ha creado proyecto ni autorizado coste. Producción `jrkefsylpfriiqefcmzq` tiene cuatro migraciones; la quinta y `campaign-command` siguen pendientes. Este PR no aplica DDL ni despliega funciones.

## Preparación después de autorización

Crear un proyecto Supabase de ensayo con referencia distinta, presupuesto y fecha de eliminación acordados. No copiar usuarios, tokens ni filas de producción. Configurar dos cuentas Auth de prueba confirmadas y políticas del esquema versionado. Revisar y aplicar las cinco migraciones en orden solo allí, desplegar `create-real-idea` y `campaign-command` con JWT obligatorio y secretos exclusivos del proyecto de ensayo. Verificar que el esquema real coincide antes de probar. Mantener registro de versiones, hashes y resultados de advisors. No reutilizar `.temp` ni el enlace CLI de producción: usar un checkout/directorio de CLI aislado y `--project-ref` explícito.

Configurar únicamente en el entorno del proceso (no repositorio/logs): `RAXI_STAGING_REF`, `RAXI_STAGING_URL`, `RAXI_STAGING_PUBLISHABLE_KEY`, `RAXI_STAGING_DATABASE_URL` (conexión PostgreSQL directa al host del proyecto, puerto 5432 y TLS validado), `RAXI_STAGING_EMAIL_A/B`, `RAXI_STAGING_PASSWORD_A/B`. Autorizar el ensayo mediante `RAXI_STAGING_ACK=RUN_ISOLATED_STAGING_ACCEPTANCE`. No compartir contraseñas ni imprimir URLs de conexión. Si no hay conectividad IPv6 directa, resolverla antes del ensayo o revisar explícitamente soporte de session pooler; el runner actual rechaza poolers.

Desde `apps/raxi-hq`, tras revisión/autorización: `node scripts/staging-acceptance.mjs --run`. El runner valida los dos endpoints antes de cualquier red; rechaza la referencia de producción, endpoints ajenos y ausencia de consentimiento. No crea proyectos, aplica migraciones ni despliega. Deja fixtures identificados en ensayo para revisión; no borra datos automáticamente.

## Qué verifica el runner preparado

- Auth real: login por contraseña y consulta `getUser`, usuarios distintos no anónimos, logout/login y persistencia.
- RLS: lectura directa vacía desde otra cuenta y RPC ajena rechazada aunque falsifique el actor; petición sin JWT no escribe.
- Idea y transición por API real; repetición exacta conserva recibo y versión, clave con contenido distinto recibe conflicto.
- Tres conexiones PostgreSQL físicas con PIDs distintos. Una bloquea el workspace y otra espera realmente un lock (`pg_stat_activity`) antes de competir con el mismo comando; queda una sola operación.
- Commit dentro de transacción externa seguido de ROLLBACK, sin avanzar versión ni dejar recibo. La suite PGlite existente cubre además fallo de constraint a mitad de commit con revisiones/entregables.
- Descartar el cuerpo HTTP y recuperar el recibo canónico. Esto reproduce pérdida de respuesta desde el cliente, sin afirmar que se ha cortado una conexión real.

Complementar en ensayo con el recorrido completo de Campaign Workspace/Strategy (guardar, revisar, aprobar, nueva revisión, historial), fallo de constraint a mitad del commit alojado y kill de conexión durante COMMIT: resolver resultado incierto por recibo antes de reintentar. La suite local de 321 pruebas y PGlite no acredita Auth alojado, despliegue Edge ni concurrencia física. El runner alojado permanece **sin ejecutar** hasta autorizar el proyecto y sus fixtures.

## Recuperación y evidencia

Registrar resultados sin tokens, contraseñas ni datos de producción. Si falla DDL, rollback transaccional y corregir propuesta; no reparar historial falsamente. Si falla Edge, mantener frontend anterior/deshabilitado. No quitar triggers ni borrar historial para resolver un fallo. Exportar inventario/backup antes de ensayar recuperación y comprobar restauración en otra base aislada. Detener aceptación ante diferencias de permisos, duplicados o costes no autorizados.

## Verificación de main

Fast-forward seguro a `43b1ec3213c52b74ad0006c4499790533815bf40`, sin cambios previos ni commits no integrados. La lectura remota comparó primera idea, auditoría de creación, conteos y cuatro migraciones con la evidencia previa: sin diferencias. Se detectó un falso rechazo del bundle por CRLF tras checkout de Windows; el verificador ahora normaliza solo finales de línea y sigue rechazando diferencias reales de código. Build, typecheck y las 321 pruebas se repiten con esa corrección. No se alteró el bundle ni el SQL existente.
