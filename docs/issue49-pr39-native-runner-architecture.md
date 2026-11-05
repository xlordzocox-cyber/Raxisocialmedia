# Issue #49 — PG17 T0/T1: diseño de ejecutor nativo aislado (NO IMPLEMENTADO)

**Estado:** especificación de diseño, sin ruta ejecutable nativa ni aprobación para Docker o SQL. **PR #50 permanece draft.**  
**Fuente de hipótesis:** `docs/issue49-pr39-pg17-ddl-reconstruction-study.md`; protocolo `docs/issue49-pr39-native-t0-t1-test-protocol.md`.

## Objetivo preciso

Probar en PostgreSQL **17.11 exacto** si la variante T1 del `CHECK` sobre `public.raxi_workspaces.slug` reproduce el `conbin` y catálogo canónico de su origen después de ciclo `pg_dump -Fc` / `pg_restore`. T0, con `BETWEEN`, es control; no es suficiente demostrar igualdad de resultados sobre un conjunto finito de `slug`.

## Arquitectura de componentes (propuesta, separada del preflight)

1. **Attestation/read-only preflight.** Ejecutar primero `makeT0T1Plan` + `assertPlanIsBlocked(plan, source)` en un módulo separado; huella de manifiesto y las siete fuentes coincidentes; versión de manifiesto 1 y flags hospedadas deshabilitadas. No conceder permiso por aprobar el preflight.
2. **Consentimiento independiente.** El runner nativo no debe poder construirse o activarse por una flag añadida a `scripts/issue49-pr39-t0t1-offline-executor.mjs`. Separar programa, ruta, revisión, SHA y autorización. La autorización exige alcance limitado: cuatro contenedores PostgreSQL17.11 efímeros solo locales, microesquemas sintéticos, sin datos reales.
3. **Daemon local y digest OCI.** Reutilizar `selectPr39LocalDockerHost` del PR39, más inspección real `docker context inspect` y `docker info` antes de cualquier operación, forzando `--host` cerrado en todas las llamadas. Rechazar `DOCKER_HOST`, `DOCKER_CONTEXT`, TLS, endpoints remotos, fallback y socket desconocido. El socket local no equivale a atestación criptográfica del daemon. La imagen fijada por `image ID sha256` y versión exacta 17.11, sin descarga automática.
4. **Aislamiento del ciclo.** Crear por nombre aleatorio y registrar ID completo de cuatro contenedores nuevos, separados T0.origen/T0.destino/T1.origen/T1.destino. `--network none`, sin `-p`, sin bind mounts, sin volúmenes compartidos, sin secrets; establecer usuario/base SQL sintéticos. Nunca utilizar ni eliminar contenedores preexistentes. Una imagen PostgreSQL oficial puede declarar `VOLUME /var/lib/postgresql/data`; detectar y tratar cualquier volumen anónimo creado en lugar de prometer ausencia total de volúmenes.
5. **Microesquema y restauración.** Crear solamente tabla sintética con `slug text NOT NULL CHECK(...)` y, si se requiere, nombres explícitos controlados; una sola transacción por inicialización. Comparar `pg_constraint.conbin`, `pg_get_constraintdef`, metadatos de columnas/constraint y resto del microcatálogo origen vs restauración, con verificador estricto. Guardar archive en memoria o pipe acotado; no escribir backups privados ni SQL a disco. Verificar retorno/estado de `pg_dump` y `pg_restore`; un fallo parcial implica STOP.
6. **Evidencia y decisión.** Reportar solamente identidades del build, SHA de DDL/archivo, hash de `conbin` sin valores de filas, conteos de diferencias y códigos de salida. Si T0 difiere y T1 coincide: `T1_MICROSCHEMA_CANDIDATE_ONLY`; no permitir `allowCatalogPass=true` ni cambiar SQL real. Si ambos difieren: `T1_NOT_CONFIRMED`. Si ambos coinciden: `NOT_REPRODUCED`. Cualquier otra discrepancia o contexto no atestado: `INCONCLUSIVE`. En los cuatro casos `NO_GO_HOSTED_MIGRATION`.
7. **Limpieza fail-closed.** Mantener IDs de contenedores, y de volúmenes anónimos si aparecen, identificados como creados por este ensayo. `finally` intenta detener y retirar exclusivamente esos IDs exactos (con validación de labels/control de propiedad) e informa restos sin eliminaciones globales. Si `cleanup` falla, estado `INCONCLUSIVE/RESOURCE_REMAINS`; nunca presentarlo como PASS. No usar `docker system prune` ni `docker volume prune`.

## Pruebas negativas antes de autorizar ejecución

- Endpoint remoto por `DOCKER_HOST`, contexto alternativo o Docker TLS; socket simbólico/no verificado, variables manipuladas.
- Digest de imagen mutable o versión PG no exacta; plataforma o arquitectura inesperada; cambio en el nombre de volumen creado implícitamente.
- Parámetros Docker con red/puerto/bind mount/privileged no admitidos; contenedor existente con nombre colisionado o ID cambiado entre consultas.
- SQL distinto de los dos microesquemas fijados, tabla extra, expresión `CHECK` faltante, flags de constraint desiguales; archivo SQL externo arbitrario.
- Fallos en `pg_dump`, `pg_restore`, digest, captura SQL, catálogo, aislamiento, temporizadores, limpieza parcial; cada fallo impide aceptar el ensayo.
- Falsificación del reporte como `PASS`, intercambio de hashes, pérdida de diferencia de cualquier objeto canónico, bypass de revisión, firma o consentimiento.
- Prueba que **no invoca Docker** si no hay autorización, aun si un daemon está disponible localmente.

## Gates para concluir

- Primero cerrar los P2 independientes del preflight (fingerprints exactos y `formatVersion=1`); ejecutar pruebas negativas y verificar rereview de Codex en SHA exacto.
- Implementar runner nativo **solo en un incremento distinto** y someterlo a tests simulados/negativos y revisión independiente. No confundir preparación del diseño con permiso de ejecución.
- Autorizar explícitamente el ensayo local y ejecutar con testigo del operador. No usar Supabase alojado ni alterar las siete fuentes SQL fijadas.
- Si T1 funciona en microesquema, requerir una prueba posterior distinta del catálogo completo/RLS/ACL antes de plantear una migración nueva.

**Invariantes:** `decision=BLOCKED; semanticEquivalence=NOT_VERIFIED; allowCatalogPass=false; NO_GO_HOSTED_MIGRATION`.
