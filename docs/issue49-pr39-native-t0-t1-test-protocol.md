# Issue #49 — Protocolo del ensayo nativo T0/T1 en PG17 (PREPARACIÓN, NO EJECUTAR)

**Fecha:** 2026-11-05. **Estado:** propuesta de laboratorio, pendiente de autorización específica y revisión del ejecutor.  
**Prohibido:** producción/staging, SQL remoto, crear cuentas reales, proveedores, despliegue, editar las siete migraciones fijadas, `--run-local` del PR39 sin revisión del alcance o modificar el comparador.

## Objetivo

Comprobar si reescribir exclusivamente el `CHECK` sintético de `slug` de:

- T0: `length(slug) BETWEEN 2 AND 64 AND slug ~ '^[a-z0-9-]+$'`
- T1: `length(slug) >= 2 AND length(slug) <= 64 AND slug ~ '^[a-z0-9-]+$'`

produce **la misma huella de catálogo antes y después de `pg_dump -Fc` y `pg_restore`** en PostgreSQL 17.11, sin excepciones ni normalización de `AND`.

La herramienta offline `scripts/issue49-pr39-ddl-offline-scenarios.mjs` pasó en Windows para T0/T1, pero **no ejecuta PostgreSQL**.

## Diseño mínimo recomendado

1. Congelar los SHA de rama, manifiesto y migración; fijar por digest la imagen PG17.11 que ya se usó y su plataforma. No asumir que la etiqueta mutable `postgres:17` identifica esa imagen. Verificar Docker Desktop local y que las variables `DOCKER_HOST`, `DOCKER_CONTEXT` y otras alternativas remotas no permitan seleccionar un daemon no aprobado; reutilizar el control endurecido del PR39.
2. Con autorización explícita, crear **dos contenedores efímeros exclusivos por variante** (origen y destino T0; origen y destino T1), `--network none`, sin `-p`, sin bind mounts ni volúmenes persistentes, bases y datos sintéticos, nombres únicos; prohibir reutilizar o tocar `raxi-pg17-campaign-qa` o `raxi-pg17-validation`.
3. Para evitar complejidad innecesaria, comenzar con un **microesquema sintético** `public.raxi_workspaces` que incluya exclusivamente la columna `slug` y el `CHECK` objetivo. No sustituye el posterior ensayo del catálogo integral. Usar el mismo SQL para crear ambas variantes salvo la expresión del `CHECK`; registrar hashes y nombre/atributos exactos. Si el nombre del CHECK difiere, STOP.
4. Crear en origen y restaurar a destino por `pg_dump -Fc --schema=public --no-owner` y `pg_restore --single-transaction --exit-on-error --no-owner`, con esquema destino vacío, sin importar SQL de terceros. Capturar `pg_constraint.conbin::text` y `pg_get_constraintdef` **en memoria** junto con hashes; no publicar definiciones ni `conbin` en logs. Registrar también nombre, contype, convalidated, conislocal, connoinherit, coninhcount, atributos `slug`, version/locale/encoding.
5. Comparar estrictamente `conbin`, metadatos y definición canónica dentro de cada pareja T0 y T1 (sin excepción); rechazar si aparecen objetos o diferencias inesperadas. Si T1 es idéntica, ampliar en un ensayo **separado, nuevamente revisado** al esquema integral y pruebas RLS/ACL/aislamiento. Si T1 diverge, NO continuar hacia una modificación del DDL.
6. Incluir negativos: T0 como control de reproducibilidad de la discrepancia (no asumir FAIL, observar), cambio del patrón regex, inversión de límites, falta de CHECK, collation diferente y fallo de limpieza. No relajar las comprobaciones ni normalizar árboles.
7. Registrar únicamente salidas de estado, hashes completos de campos/artefactos, identidades de imagen/compilación y códigos de salida. La limpieza de contenedores por ID exacto va en `finally`; si falla, detenerse sin intentar borrar recursos desconocidos.

## Criterios de decisión

- **T0 diferente, T1 idéntico:** evidencia inicial a favor de T1 en microesquema, pero **NO** autorización para cambiar migraciones ni aprobar restauración integral.
- **T0 y T1 diferentes:** descartar T1 como solución directa; conservar `FAIL` e investigar otra vía.
- **T0 y T1 idénticos:** el microesquema no reproduce el defecto; se necesita ajustar el fixture de forma controlada antes de extrapolar al esquema real.
- **Metadatos/build difieren, error de herramienta, salida incompleta o aislamiento dudoso:** `STOP / INCONCLUSIVE`.

**Gates finales:** independiente de los resultados del microesquema, antes de cualquier cambio a SQL real se exige ensayo de catálogo completo, revisión Codex en HEAD exacto, autorización de nueva migración y QA Auth/RLS. `NO_GO_HOSTED_MIGRATION` permanece hasta otras aprobaciones y validaciones ajenas al CHECK.

## Autorización futura necesaria

Solicitar consentimiento específico para *crear y limpiar cuatro contenedores locales PostgreSQL 17.11 sin red ni puertos publicados*, ejecutar solamente SQL sintético local y guardar hashes no sensibles. No ejecutar el procedimiento por el hecho de existir este documento; no hay todavía ejecutor revisado ni autorización de esta etapa.
