# Laboratorio nativo PostgreSQL 17 de Raxi HQ

Este incremento valida las siete fuentes revisadas en PostgreSQL 17.11 real,
exclusivamente en el laboratorio Docker ya creado y autorizado. No es B2,
Supabase local completo, autenticación alojada ni permiso de despliegue.

## Destino e integridad

Base de código: main `1b7ab1e3240285f803d8c78b8f6420ee86cca1bf`.
Se reutilizan `loadPreparationManifest`, `verifySqlSources`, `inspectRaxiSchema`,
`localSupervisedRepository` y las RPC existentes. No se añade runtime ni ledger.
El manifiesto de staging y sus autorizaciones permanecen intactos.

El ejecutor fija nombre `raxi-pg17-validation`, base `raxi_validation`, usuario
`raxi_local`, ID Docker
`18e930e0f9b68de168b8b97415d73bece0f1c7a6f38def2d4749251097185235`,
imagen local `sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe`
y tag `postgres:17`. Exige contenedor activo, no pausado/reiniciando/privilegiado,
red única `raxi-pg17-isolated` con `Internal=true`, ID de red coincidente,
cero puertos publicados y un único mount `tmpfs` en `/var/lib/postgresql/data`.
La inspección selecciona campos sin leer `Config.Env`.

Antes de cada conexión se inspecciona Docker; `exec` utiliza el ID inmutable.
Dentro de cada conexión se confirma versión `170011`, base, usuario, directorio
y socket Unix (`inet_server_addr() IS NULL`) antes de aceptar SQL del ensayo.
El puerto de cada repositorio serializa sus consultas en una conexión verificada;
no reintenta una consulta fallida. El siguiente comando puede abrir otra conexión.
Los puertos se cierran al terminar cada caso. Los ensayos simultáneos crean
puertos/sesiones diferentes; no confunden esa serialización local con concurrencia.
No se acepta URL, host, contraseña, nombre alternativo ni credencial Supabase.
No se leen ni transmiten credenciales del contenedor. Si se reemplaza el
laboratorio, sus IDs requieren nueva revisión, no una variable de bypass.
Docker Desktop y su operador administrativo son parte de la frontera confiable;
el guard no protege frente a un administrador que manipule Docker durante una prueba.

## Bootstrap y aplicación

`supabase/tests/pg17-bootstrap.sql` crea únicamente roles NOLOGIN `anon`,
`authenticated`, `service_role` (BYPASSRLS como el fixture existente), esquemas
Auth/Storage, `auth.users`, `auth.sessions`, `auth.uid`, `auth.jwt`, buckets y
objetos mínimos. Los claims son GUC sintéticos, **sin validación JWT**.
No implementa GoTrue, Storage API, PostgREST, Edge ni identidad de producción.
`raxi_local` es el administrador del ensayo; cambiar a un rol con `SET ROLE`
permite verificar grants y RLS, no simula un login real.

Las siete fuentes se leen por lista explícita y SHA-256 LF del manifiesto:
las cuatro bases `20261019030541`, `20261019030659`, `20261019030808`,
`20261019231655`, seguidas de `agent_runtime`, A y B. Se excluye la quinta
migración de campañas. No se altera ninguna fuente, versión ni historial
de migraciones. No hacen falta extensiones descargadas: `gen_random_uuid` y
SHA-256 utilizados están disponibles en este servidor.

Bootstrap y siete fuentes se ejecutan en una sola transacción con
`psql -X -w`, `ON_ERROR_STOP`, timeout de sentencia/lock y parada ante errores.
La instalación exige ausencia de relaciones en public/auth/storage y rechaza
un laboratorio ya poblado: nunca hace DROP, reset, truncate ni reaplica DDL.
Las pruebas sí intentan escrituras prohibidas y una división por cero dentro
de transacciones controladas, esperando el error correspondiente.

## Reproducción

Desde `apps/raxi-hq`, después de instalar reproduciblemente las dependencias
existentes y **solo con el laboratorio autorizado ya activo**:

```powershell
npm ci --ignore-scripts --no-audit
node scripts/validate-native-pg17.mjs --install-and-test
```

La segunda opción verifica el catálogo de una instalación existente y ejecuta
solo pruebas sobre nuevos workspaces sintéticos, sin reaplicar las fuentes:

```powershell
node scripts/validate-native-pg17.mjs --test-existing
```

No iniciar contenedores ni servidores para ejecutar estos comandos. El script
no instala, crea, detiene, reinicia ni elimina recursos Docker. La suite normal
`npm test -- --serial` incluye únicamente los guards puros; no toca el laboratorio.
La suite nativa se compila separadamente y se detiene tras la primera prueba
fallida, sin emitir más SQL de pruebas. Una sesión SQL fallida cierra la conexión,
permitiendo rollback de su transacción; no reintenta efectos automáticamente.

## Diferencia comprobada PG17 / PG18

La primera comprobación se detuvo por diferencia de catálogo, después del commit
correcto de las siete fuentes. Comparación detallada local de ambos motores:

- PG18 representa NOT NULL también en `pg_constraint`; PG17 mantiene `attnotnull`.
- La colación puede ordenar de forma distinta el agregado textual de índices.
- Tras excluir únicamente esas entradas NOT NULL redundantes y ordenar índices,
  las 20 definiciones completas de tablas coinciden (incluido `attnotnull`, RLS,
  grants, políticas, triggers, claves, tipos y defaults).
- Las huellas de todas las funciones, roles y relaciones ajenas coinciden sin
  normalización. No hubo modificación SQL para hacerlas coincidir.

Se guarda una referencia **local PG17** separada en
`supabase/tests/pg17.expected-schema.json`, digest canónico
`d7983def867201cb307b92906b97db9876765852a1f0d96cd8fdf2b81efd7c5e`.
El ejecutor verifica tanto esa referencia fijada como el catálogo observado.
El pin PG18/hosted del manifiesto no se cambia ni se afirma equivalencia alojada.
Los campos históricos `PENDING_PG17_REVIEW` / `BLOCKED_NOT_AVAILABLE` del paquete
anterior no son el resultado de esta ejecución: su evidencia actual es el informe
nativo separado. Adaptar una futura referencia alojada PG17, asignar la versión
CLI y revisar el manifiesto habilitante siguen siendo bloqueos independientes de B2.

## Cobertura y límites

Pruebas nativas: permisos INVOKER/search_path/grants y RLS; dos actores;
sesión sintética ausente/caducada y workspace ajeno; idempotencia/payload;
dos conexiones físicas con PIDs diferentes y `pg_blocking_pids` observando
espera real de lock en workspace; aprobaciones simultáneas y claim único;
presupuesto/revocación/cambio a REAL; confirmación perdida después de commit;
reconexión con nuevo repositorio; journal P2 (comando, digest y confirmación);
UPDATE/DELETE/TRUNCATE/relabel prohibidos, sin bloquear eventos ajenos;
rollback de aprobación, reserva y auditoría; tarea del Investigador separada.

No se registra ningún proveedor: todos los resultados de prueba son fixtures
SIMULATED/MOCK/UNVERIFIED y las llamadas al proveedor son cero. El despacho
permanece CLAIMED hasta ack sintético. No se modifica ni alimenta la oficina.
La recuperación demostrada es tras pérdida de respuesta y reconexión de clientes,
no tras reinicio del contenedor/servidor. Un reinicio del contenedor puede perder
el contenido tmpfs; no se ejecuta para evitar destruir evidencia.

El script escribe resumen sin datos/leases en `.validation/native-pg17-result.json`;
TAP contiene nombres de pruebas y PIDs, no conversaciones ni tokens. Conservar
logs/digests revisados fuera de secretos. La bandeja de recibos y el ensayo Auth
alojado siguen pendientes. El resultado no activa flags de staging ni B2.

## Recuperación y reversión

Ante error, detenerse y conservar logs y estado local; no resetear ni eliminar
el laboratorio automáticamente. Si falla la instalación, su transacción se
revierte al cerrar psql; verificar manualmente el catálogo antes de otra acción.
La inyección de corrupción del journal usa únicamente el administrador local
en transacciones que reactivan el trigger; se restaura el payload original
después de verificar el rechazo. Si esa prueba falla, inspección humana antes
de continuar (el runner no oculta/restaura silenciosamente un fallo).

Los fixtures quedan en el laboratorio para inspección; cualquier limpieza o
recreación requiere autorización separada. Revertir este PR elimina únicamente
harness, fixtures y documentación del repositorio, sin efectos remotos ni DROP.
Guardian y el observador histórico no cambian. B2 requiere revisión y autorización
independientes, cuentas de ensayo reales y verificación alojada futura.

Referencias consultadas: [psql PG17](https://www.postgresql.org/docs/17/app-psql.html)
y [Docker inspect](https://docs.docker.com/reference/cli/docker/inspect/).
La representación NOT NULL difiere en los catálogos oficiales de
[PG17](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) y
[PG18](https://www.postgresql.org/docs/18/catalog-pg-constraint.html).
