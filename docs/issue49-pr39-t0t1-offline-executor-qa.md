# Issue #49 / PR #39 — ejecutor de preflight offline T0/T1 y QA adversarial

**2026-11-05.** Estado: **PREPARADO, NO EJECUTOR NATIVO**. Archivo principal: `scripts/issue49-pr39-t0t1-offline-executor.mjs`. Batería: `scripts/test-issue49-pr39-t0t1-offline-executor.mjs`.

## Propósito y alcance

Preparar un plan controlado para un **futuro** experimento sintético PostgreSQL 17.11 sobre `raxi_workspaces_slug_check`: comparación de T0 (`BETWEEN`) con T1 (comparaciones explícitas). El programa **solo lee** la migración y el manifiesto local, valida huellas y condiciones de seguridad, calcula hashes de dos microesquemas en memoria y muestra las etapas pendientes. **No genera archivos SQL, no ejecuta Docker ni PostgreSQL, no invoca red o proveedores, no escribe archivos y no incorpora rutas de ejecución nativa.** `--run-local`, `--native`, cualquier argumento y credenciales/variables de endpoint externas son errores, nunca alternativas.

Los microesquemas propuestos contienen solo `public.raxi_workspaces(slug text NOT NULL CHECK (...))`; son artefactos **hipotéticos**, no sustituyen las siete fuentes SQL ni el catálogo real. La prueba no modifica migraciones ni manifiesto; la diferencia T0/T1 conserva íntegra la expresión regular (incluido el ancla `$`). Un éxito del programa significa únicamente que el **preflight está preparado**, no que los catálogos de T0/T1 sean equivalentes.

## Controles incorporados

1. Inventario cerrado de **siete** entradas del manifiesto en orden fijo con path, clase y SHA-256 LF esperados; SHA-256 de la primera fuente recalculado desde bytes normalizados a LF. No se leen ni ejecutan las otras seis fuentes: sus huellas se cotejan exclusivamente contra el manifiesto.
2. `executionReady=false`, `schemaCompatibility.status=PENDING_PG17_REVIEW`, PostgreSQL 17 como objetivo, seis autorizaciones `false` y `candidate.executionAuthorized=false` con estado PG17/CLI bloqueado. Si el esquema del manifiesto varía, STOP.
3. Solo una aparición de la restricción T0, ninguna aparición previa de T1, transformación **en memoria** reversible y símbolo `$` conservado. Rechazo de bytes SQL añadidos, bounds/patrón alterados o CHECK duplicado.
4. Lista de variables de entorno prohibidas: todas las entradas Docker que pueden cambiar daemon, TLS o configuración; `PGHOST`, `PGHOSTADDR`, `PGSERVICE`, `PGPASSWORD`, `PGDATABASE`, `DATABASE_URL` y `SUPABASE_DB_URL`. No se leen sus valores ni se registran secretos. Los comandos normales de otros proyectos no se modifican.
5. Salida cerrada: dos hashes SHA-256 de microesquema, lista de etapas y `decision=BLOCKED`, `semanticEquivalence=NOT_VERIFIED`, `allowCatalogPass=false`, `NO_GO_HOSTED_MIGRATION`. No se guarda SQL ni se autoriza restauración.

## Batería adversarial

`scripts/test-issue49-pr39-t0t1-offline-executor.mjs` comprueba el caso base, fingerprints esperados de ambos microesquemas y rechazo de anomalías: todas las variables peligrosas, argumentos `--run-local`, `--native`, `--restore`, `--approve`, otras flags, autorizaciones activas, candidato habilitado, cambio de PostgreSQL, manipulación de cualquiera de las siete fuentes, orden o número de entradas del manifiesto, cambios del CHECK, expresión regular, bounds, ancla, SQL añadido, fuente ausente o duplicada, metadatos de autorización falsificados y falsos PASS en el plan devuelto. También invoca **solo Node.js** en subprocesos para confirmar que el modo normal devuelve estado bloqueado y que las flags nativas fallan. No hay prueba de Docker/SQL en esta fase.

### Resultado de revisión desde el conector

Los dos scripts se publicaron y recuperaron desde GitHub; ambas fuentes pasaron una comprobación de análisis sintáctico aislada con imports abstraídos. La lógica pura del ejecutor pasó **8/8 pruebas de humo simuladas** sobre fuente/manifiesto recuperados, incluido rechazo de intento de conexión externa, migración alterada y candidato activado. Estas comprobaciones utilizaron un sustituto de hash en un entorno JS aislado; **NO deben presentarse como una ejecución real de Node con SHA-256**, ni como PASS de la batería completa. Las pruebas oficiales de Node/Windows y la revisión independiente quedan pendientes.

## Ejecución futura segura del preflight (sin Docker)

Desde un checkout local de Raxi HQ en Windows con el código actualizado, ejecutar:

```powershell
node --check scripts/issue49-pr39-t0t1-offline-executor.mjs
node --check scripts/test-issue49-pr39-t0t1-offline-executor.mjs
node scripts/test-issue49-pr39-t0t1-offline-executor.mjs
node scripts/issue49-pr39-t0t1-offline-executor.mjs
```

Si el checkout principal no contiene los scripts, copiarlos a **una carpeta temporal fuera del repositorio**, manteniendo ambos en el mismo directorio, sin cambiar main. Los archivos se ejecutan desde la raíz del checkout (`process.cwd()`) y usan las fuentes locales protegidas. **No omitir gates fallidos**. Ningún paso requiere Docker.

## Pendientes para un futuro ejecutor nativo

- Revisión independiente de preflight y negativos en commit exacto (Codex) y prueba real de Node en Windows.
- Diseño y revisión por separado de un runner con control de endpoint local verificable, imagen OCI fijada, cuatro contenedores de identidad única, sin red/puertos/montajes, mínimo SQL sintético, `pg_dump/restore` sin escrituras externas, comparación estricta de `conbin` y catálogo, captura de error y limpieza `finally` por IDs exactos.
- Autorización **separada y expresa** del ensayo de contenedores; esta aprobación solo cubre la preparación offline. No existe todavía una implementación autorizada de ejecución nativa.
- No tocar `raxi-pg17-campaign-qa`, `raxi-pg17-validation`, staging alojado, los siete SQL fijados, Auth real, proveedores ni deployments.

**Política permanente:** `BLOCKED / NOT_VERIFIED; allowCatalogPass=false; NO_GO_HOSTED_MIGRATION`.


## QA ejecutado por el operador (Windows, 2026-11-05)

Sobre commit `1fb0f2cfb94da18c7be3fdadc61fa479a4086409`, el operador verificó los dos scripts con `node --check` sin errores y ejecutó la batería adversarial y el preflight. La batería produjo `PASS ISSUE49 T0T1 OFFLINE NEGATIVES (53 rejected cases; no Docker/SQL/filesystem writes)` y la verificación exacta de fingerprints/regex. El preflight devolvió `PASS ISSUE49 T0T1 OFFLINE PREFLIGHT`, con hashes de microesquema T0 `32eaece08637b7bfa23886b659b0b662fe0ee59ebf4f22b1e698c1bb2dc08f07` y T1 `999e0bb2f3d02847fdc2814f848362c87d34174a59260961387fd5dc2fdfd7b1`. Los comandos no retornaron error y la política final fue `BLOCKED / NOT_VERIFIED; allowCatalogPass=false; NO_GO_HOSTED_MIGRATION`.

**Cierre acotado:** preflight offline y sus 53 rechazos PASS en Windows. La revisión Codex independiente, la construcción y revisión de cualquier runner nativo y el experimento PostgreSQL 17 siguen pendientes; el usuario no autorizó ejecutar Docker ni SQL con esta aprobación.


## Endurecimiento posterior y revisión independiente solicitada

La revisión propia detectó que `assertPlanIsBlocked` podía admitir campos extra o fingerprints de predicado falsificados porque validaba solamente el subconjunto de campos de bloqueo. Se modificó para exigir la forma cerrada de los 14 campos del plan, las tres propiedades de cada variante, huellas del predicado T0/T1, y las ocho etapas obligatorias con orden exacto, conservando todos los `false` y `NO_GO_HOSTED_MIGRATION`. Se añadieron siete regresiones negativas específicas de datos falsificados y falta de metadatos. Commits `a43cd0ebc6bf8f77efe1d9e834ef71a77d5e352c` y `af832c7ecbcd2144dbcf69f83560b8cc33a7ea2a`.

Los dos archivos pasan un análisis sintáctico aislado, pero **no se ha ejecutado aún la batería actualizada completa en Node/Windows**; los 53 negativos PASS corresponden al commit anterior `1fb0f2cfb94da18c7be3fdadc61fa479a4086409` y no se extrapolan. Codex fue solicitado mediante `@codex review` en el comentario GitHub `6668108336` sobre el SHA `af832c7ecbcd2144dbcf69f83560b8cc33a7ea2a`. Solicitud creada, **resultado independiente PENDIENTE**; no inventar una aprobación. Ningún runner nativo ni autorización de ejecución fue añadido.
