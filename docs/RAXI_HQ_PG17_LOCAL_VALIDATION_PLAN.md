# Issue #22 — candidato consolidado y validación PG17 bloqueada

Base: main `271f33d294b5dcdf7b36f6abae31baeb962d3820`, merge de PR #21. El Issue #22 ocupa ese número en GitHub; el PR asociado recibirá otro número de la secuencia compartida. Esta entrega usa la alternativa explícita del issue para ausencia de PG17 autorizado: paquete candidato, pruebas locales disponibles y plan reproducible, **sin fabricar PASS PG17 ni ejecutar B2**.

## Inventario local comprobado

El 26-10-2026 no se encontraron psql, pg_ctl, postgres o Supabase CLI en PATH; tampoco un servicio/proceso postgres ni psql en la ruta estándar PG17 comprobada. La búsqueda del ejecutable Supabase en la caché npm existente tampoco lo encontró. Docker CLI está instalado, pero no se observó un backend/Desktop activo en el chequeo de procesos. Su presencia no acredita un PG17 autorizado. No se ejecutaron comandos Docker, no se descargaron imágenes y no se instalaron/arrancaron servidores, contenedores o servicios.

No se proporcionó una conexión PG17 local autorizada. No se buscaron contraseñas ni se sondearon puertos o bases desconocidas. Estos chequeos no prueban la inexistencia de cualquier instalación en el equipo; prueban que no se identificó un motor autorizado/disponible para este ensayo.

| Capacidad | Estado |
| --- | --- |
| Cuatro bases + runtime/A/B, hashes y exclusión de campañas | VERIFICADO OFFLINE |
| Candidato reproducible y transacciones del fixture | VERIFICADO EN PGLITE PG18, no PG17 |
| PostgreSQL 17 nativo y conexiones físicas | BLOQUEADO, no disponible/autorizado |
| Generación de versión con Supabase CLI | BLOQUEADA, CLI no disponible |
| Catálogo PG17 | PENDIENTE; el candidato de catálogo sigue siendo PG18 |
| SQL alojado / B2 / proveedores reales | PROHIBIDOS, no ejecutados |

## Candidato y procedencia

`supabase/candidates/supervised_runtime_b2.candidate.sql` es un artefacto de revisión generado offline a partir de las tres propuestas runtime → A → B. No está en migrations/, no tiene una marca temporal inventada y no lo produjo Supabase CLI. El manifiesto conserva cliMigrationVersion:null, executionReady:false y todas las authorizations:false. No hay una migración nueva aplicable.

La base del paquete original de fuentes sigue siendo b56b265… (B1); `candidate.baseCommit` registra 271f33d… (preparación #21 integrada). Las siete fuentes no se modifican y conservan sus huellas anteriores. El nuevo pin incorpora el artefacto y su procedencia, sin atribuir una lectura alojada al baseline suministrado por el usuario.

Desde apps/raxi-hq:

```text
node scripts/verify-staging-preparation.mjs
node scripts/consolidate-runtime-candidate.mjs --check
```

Ambos son offline: sin conexión, SQL ejecutado, CLI, env o proveedor. La generación explícita `node scripts/consolidate-runtime-candidate.mjs --write-candidate` reconstruye únicamente el archivo fijo anterior, verificando manifiesto, orden y fuentes; no acepta rutas arbitrarias ni flags apply/run/db-url. La salida no autoriza aplicar el SQL. El escritor rechaza destinos enlazados fuera del repositorio y archivos simbólicos; un fallo/interrupción se detecta por hash antes de cualquier B2.

Manifiesto canónico actual: `a37c4285af09c428cfefc8a60e92defdc616d4029a25812e79f3403c7da5a44a`.

Candidato SHA-256(LF): `bc4ce83cfe5e64fc116dd5eb408254f1b0363b868d1a71b5378053435c3b0c15`.

El fichero no duplica una implementación autoritativa: las tres fuentes siguen siendo la fuente de verdad y el checker exige reproducción exacta. Reordenar fuentes, añadir campañas, asignar una versión o alterar un GRANT cambia el paquete y requiere revisión. El archivo solo contiene DDL existente; no lleva filas de producción, usuarios reales, seeds de políticas ni credenciales. Los defaults del runtime siguen enabled:false y simulated:true; ningún proveedor es registrado por SQL.

## Flujo CLI pendiente, no ejecutado

La documentación oficial de [Supabase migration new](https://supabase.com/docs/reference/cli/supabase-migration-new) describe creación de una migración vacía con versión generada por CLI. Aquí no existe esa CLI y no se instala mediante npx u otro fallback automático.

Tras autorización independiente y cuando haya un binario disponible:

1. Comprobar su versión y `supabase migration new --help`; verificar el flag global workdir con la ayuda instalada.
2. En un directorio offline desechable expresamente autorizado, sin link a proyecto ni credenciales alojadas, usar `supabase --workdir <directorio-aprobado> migration new supervised_runtime_b2`. No start, link, db push, migration up, reset o deploy.
3. Capturar la versión real creada y copiar allí el contenido candidato verificado. El candidato no incluye BEGIN/COMMIT propios: la transacción la controla el ejecutor aprobado. Registrar hash y versión del **archivo CLI derivado** en un registro separado y revisado; no cambiar retrospectivamente la procedencia OFFLINE del candidato original ni atribuirle generación CLI. Actualizar la versión consolidada/mapping del manifiesto como preparación mediante otro cambio revisado, dejando B2 y todas las authorizations false.
4. Revisar ese archivo/versionado en PR antes de moverlo a un paquete aplicable. No introducir la quinta migración de campañas ni duplicar las cuatro bases. Una versión generada tampoco autoriza SQL.

Esta secuencia es un plan, no evidencia de haber usado la CLI. El candidato actual permite revisar SQL sin falsear el requisito de versión generado por CLI.

## Plan reproducible PG17 — requiere un entorno autorizado existente

Precondición: motor PG17 dedicado y aislado ya disponible, base efímera local aprobada, sin datos personales ni acceso alojado. No asumir que una autorización de base permite crear roles globales en un cluster compartido: anon/authenticated/service_role y esquemas Auth/Storage fixture requieren un ámbito desechable y permisos explícitos. No reutilizar secretos de producción ni habilitar usuarios reales.

Antes de DDL, registrar por cada conexión autorizada las consultas de solo lectura: current_setting('server_version'), current_setting('server_version_num'), current_database(), inet_server_addr() y pg_backend_pid(). Exigir servidor 17 real, transporte local comprobado, nombre de base efímera acordado y ausencia de objetos/filas previos. Una versión del cliente o hostname localhost no prueban la versión ni el destino del servidor; rechazar túneles/proxies alojados y resultados ambiguos.

Abrir al menos dos conexiones físicas y un observador; capturar PIDs distintos y observar la espera real por lock mediante pg_stat_activity. Promise.all en PGlite no acredita esa propiedad. No mantener transacciones abiertas durante un proveedor; solo se permitirán adaptadores simulados. Todo resultado deberá etiquetarse NATIVE_PG17_SQL_ONLY, nunca Auth Supabase alojado.

Orden: bootstrap local expresamente aprobado de roles/schemas/funciones Auth fixture → cuatro bases en orden → candidato runtime/A/B en una transacción → catálogos e invariantes → casos adversariales → rollback/recuperación. No se usan las siete fuentes para registrar siete migraciones nuevas: la historia propuesta sigue cuatro bases y una futura consolidación. El bootstrap local es un doble de Auth/Storage, no una autenticación alojada ni autorización humana real.

Una vez autorizado el destino local, psql ofrece `-X`, `ON_ERROR_STOP=1` y `--single-transaction` para un fichero SQL. Revisar primero su ayuda/versiones y configuración protegida, sin poner contraseñas en comandos/logs. **No ejecutar estos pasos ahora**: no hay conexión autorizada. [Referencia PostgreSQL 17 psql](https://www.postgresql.org/docs/17/app-psql.html).

| Caso / criterio EARS | Verificación nativa pendiente |
| --- | --- |
| Cuando se instale el paquete completo, deberá conservar restricciones, FK por workspace e índices únicos | Catalogar tipos, RLS, grants, SECURITY INVOKER, search_path y triggers contra el paquete revisado; revisar diferencias PG18/17 |
| Si actor A consulta workspace B, deberá recibir denegación/filas vacías | Dos actores fixture sin PII; roles anon/authenticated, sin usar postgres para acreditar RLS |
| Si no hay aprobación o fue revocada/caducó, no deberá ejecutarse el simulado | Cero llamadas; aprobación propia por tarea y reserva independiente |
| Cuando dos conexiones preparen/aprueben/reclamen simultáneamente, solo deberá persistirse un efecto | PIDs distintos, lock observado, una tarea/reserva/run/evento por operación |
| Si una clave se repite con otro scope, deberá fallar sin alterar el original | Conflicto de idempotencia, rollback y claves pendientes intactas |
| Si se altera comando/digest/confirmación del journal, nunca deberá devolver FOUND | Inyección admin solo en fixture; validar P1901/CONFLICT y bloqueo UPDATE/DELETE/TRUNCATE del rol de aplicación |
| Si falla el último DDL o una escritura de journal, deberán revertirse sus cambios atómicos | Estado/evento/auditoría coherentes y cuatro bases intactas; registrar fallo, no reintentar proveedor |
| Si se pierde confirmación de commit o reinicia el cliente, deberá conciliar sin repetir el efecto | Mismos IDs/versiones/digests, recibo conservado, MISSING/CONFLICT/UNAVAILABLE distintos |
| Si vence lease o presupuesto, no deberá abrirse otra ejecución | UNKNOWN/BLOCKED y reserva conservada; cero llamadas nuevas |
| Cuando Director finalice, Investigador deberá requerir otra tarea/aprobación | No continuación automática; ningún evento simulado como REAL |

Los mocks de request.jwt.claims o auth.sessions probarían solo SQL, no firma de JWT, revocación instantánea o Auth alojado. Catálogo PG17, versión real y PIDs se guardarán solo tras observación auténtica; no fabricar fixtures etiquetados como evidencia nativa.

## Respaldo, recuperación y reversión

Antes de un ensayo nativo autorizado, inventariar y respaldar únicamente su entorno efímero (roles/permisos/esquema/versiones), con acceso y retención revisados. Nada se copia desde producción. Ante fallo, detener nuevas admisiones, hacer rollback de la transacción y comparar con el inventario previo; conservar journal, recibos, auditoría, reservas y operaciones inciertas. No ejecutar DROP automático, no borrar historial ni desactivar triggers para forzar un PASS.

La restauración deberá probarse en otro destino aislado autorizado; no crear infraestructura adicional sin permiso. La reversión de esta entrega es retirar el artefacto/composición offline, sin tocar servidores. Si una futura CLI genera una versión, no reparar historial ni hacer downgrade de un alojado como parte de la preparación.

Guardian automático permanece inactivo; su política y el histórico #18 no cambian. Oficina, UI, proveedores y datos de producción quedan intactos. B2 sigue NO COMPLETADA. El Issue #22 conserva pendiente su aceptación nativa PG17 y CLI aunque este incremento preparatorio se entregue para revisión.

Evidencia de la entrega: [validación Issue22](../output/reports/raxi-hq-runtime/ISSUE22_PG17_CANDIDATE_VALIDATION.md).
