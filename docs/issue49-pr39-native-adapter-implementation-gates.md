# Issue #49 — Puerta de implementación del adaptador PG17

Estado: preparación documental sin ejecución y sin permisos nuevos.

## Contrato propuesto

El componente futuro debe consumir el preflight y el contrato sintético ya probados, sin convertir la preparación en autorización. Su objetivo es conectar, en un incremento independiente, evidencia de daemon local, versión de imagen PostgreSQL 17.11, cuatro identidades nuevas aisladas, comparación estricta de catálogo y limpieza verificable.

## Requisitos de aceptación

- Rechazar endpoints remotos, contextos Docker alternativos, imágenes mutables, versiones PG distintas y contenedores preexistentes.
- Cuatro roles separados T0 origen/restaurado y T1 origen/restaurado; sin red publicada ni montajes compartidos, y sin modo privilegiado.
- Registrar identificadores completos y validar pertenencia antes de cualquier limpieza; detectar volúmenes anónimos compartidos.
- Separar creación, captura de catálogo, restauración y limpieza por etapas revisables con errores cerrados.
- Ninguna salida sintética puede presentarse como resultado PostgreSQL real; toda evidencia debe identificar su procedencia.
- Un error en el catálogo, aislamiento o limpieza impide cualquier declaración de equivalencia.
- Mantener decision BLOCKED, allowCatalogPass false y NO_GO_HOSTED_MIGRATION.

## Bloqueos

Este documento no autoriza la ejecución, instalación o descarga de Docker, creación de contenedores, SQL, staging ni despliegues. La implementación del adaptador debe tener pruebas negativas y revisión independiente. La ejecución posterior requerirá autorización distinta.

## Evidencia disponible

Las 49 pruebas sintéticas pasaron en Windows sobre el commit f0ac98efceb36e0ddddfa28e2cfd867d1014dc73. Codex completó rereview sin hallazgos nuevos en ese commit. El hilo sobre volúmenes compartidos fue marcado resuelto. El experimento nativo real sigue sin realizarse.


## Incremento publicado: adaptador puramente offline

Se publicaron `scripts/issue49-pr39-adapter-offline.mjs` (commit `005729027905eb4b9c72cafb056d7a6417e4ed83`) y `scripts/test-issue49-pr39-adapter-offline.mjs` (commit `890611b9c49bd5903e561311db8035d361560306`). El adaptador valida el plan y la fuente a traves del preflight existente, consume el blueprint sintetico aprobado, propone ocho etapas descriptivas y cuatro roles, y mantiene `runtimeAvailable=false`, `executionAuthorized=false`, `cleanupAuthorized=false`, `allowCatalogPass=false`, `decision=BLOCKED`, `NO_GO_HOSTED_MIGRATION`. No implementa llamadas a Docker, SQL, sistema de archivos o red; la limpieza es una barrera de evidencia sintetica con lista de eliminaciones vacia, **no** una limpieza real.

La bateria de prueba del adaptador incluye **28 negativos previstos**: 16 de plan mutado, 5 de origen/huellas/permisos y 7 de identidad/aislamiento/almacenamiento compartido. Sintaxis de ambos archivos revisada mediante parser V8 aislado; un smoke test de funciones con dependencias simuladas verifico caso valido y **5/5 manipulaciones rechazadas**. **No** es PASS del suite Node real, ni resultado de PostgreSQL. Antes de cualquier ampliacion deben ejecutarse las 28 negativas en Windows y recibir revision Codex sobre el commit exacto. El contrato sintetico anterior contaba con 49 negativos PASS y Codex sin nuevos hallazgos en su propio commit.


## Incidente de QA — imagen cambiada aceptada (2026-11-05)

El operador ejecutó la batería de **28 negativas** en Windows sobre commit `469b0eb853ba55c21927fa039a96f8ee1ee66b40`. El caso positivo llegó a `PASS ISSUE49 ADAPTER OFFLINE`, pero la ejecución **FALLÓ** al intentar `changed image pin`: `AssertionError ERR_ASSERTION Missing expected exception`. La batería completa queda **FAIL**, no 28 PASS. La causa confirmada es que el adaptador admitía una huella diferente de imagen en `prerequisites.imageId` si mantenía formato SHA-256, dado que no contrastaba un pin independiente.

**Correctivo preparado:** `scripts/issue49-pr39-adapter-offline.mjs` commit `a058cc8822e25e420e6a31c65bf8ee0b410ed8f7`: `prepareOfflineNativeAdapter` y su verificador exigen el nuevo argumento **obligatorio** `expectedImageId`, una referencia SHA-256 separada de los metadatos mutables; rechazan valor faltante, forma incorrecta y discrepancia. El resultado offline registra esa referencia y la vuelve a verificar. Regresiones en `scripts/test-issue49-pr39-adapter-offline.mjs` commit `e4fe9916035c93c6e543c40f1c4c6b8406c552f5`: se mantiene `changed image pin` y se añaden ausencia, formato inválido, divergencia del pin independiente y falsificación del pin en la salida. **32 negativas esperadas**. El pin de la batería es un *fixture sintético*; no es una atestación de la imagen física Docker. En un runner futuro, el pin debe venir de una fuente externa confiable/fijada, no de copiar el mismo objeto mutable que se valida.

Los dos scripts pasan parsing V8 con imports abstraídos; prueba de humo aislada con dependencias simuladas rechazó **4/4** entradas manipuladas y una salida falsificada. **Todavía no se ha ejecutado la batería corregida completa en Node sobre Windows.** Mantener estado FAIL del commit anterior hasta repetir QA. No hubo Docker, SQL ni permisos de migración.


## QA de pin de imagen y correctivo adicional de arrays dispersos

El operador ejecutó el código `27e35b78166c8efab405f10b62defabd6a6b4935` desde Windows con SHA de `FETCH_HEAD` verificado; los cinco archivos pasaron `node --check`, el caso positivo pasó y se reportó `PASS ISSUE49 ADAPTER OFFLINE NEGATIVES (32 rejected synthetic cases; no Docker/SQL)` y `DESIGN_ONLY / BLOCKED / NO_GO_HOSTED_MIGRATION`. El incidente anterior de `changed image pin` queda reproducido como fallo histórico y corregido en ese commit. Esta es la evidencia real de QA de esas 32 negativas, sin Docker/SQL.

La revisión Codex de la versión anterior `469b0eb8` identificó un segundo P2: arrays dispersos en `roles`, `stages` y `resourceNames` superaban `Array.prototype.some` al omitir huecos. El correctivo `c31ce6c6acae74dbe5976342cac5204199c4f672` valida cada índice con `Object.hasOwn` y compara los valores exactos. El test `567c70d0a93748d264fa9da7e26abd459f62356e` agrega seis negativas: arrays completamente dispersos y eliminación de un elemento de cada una de las tres colecciones. Esperadas **38 negativas** en total. Ambos archivos pasan análisis sintáctico V8 aislado y seis manipulaciones sintéticas se rechazaron; la batería real de Node en Windows de este último commit **todavía está pendiente**. Los dos hilos P2 nuevos no se considerarán resueltos hasta QA actualizado y rereview de Codex. Continúa `NO_GO_HOSTED_MIGRATION`.


## QA de la batería 38/38 ejecutada por operador

En Windows, el operador verificó `FETCH_HEAD` contra el commit exacto `7b2a5f37765cdd37bfcf66fe79aaebd88db68b48`, ejecutó `node --check` sobre los cinco archivos de dependencia y obtuvo `PASS ISSUE49 ADAPTER OFFLINE: 4 roles, closed stages and no cleanup execution`, `PASS ISSUE49 ADAPTER OFFLINE NEGATIVES (38 rejected synthetic cases; no Docker/SQL)` y `ISSUE49 ADAPTER STATUS: DESIGN_ONLY / BLOCKED / NO_GO_HOSTED_MIGRATION`, seguido de `PASS REAL: ADAPTADOR T0/T1 - 38 NEGATIVAS`. **QA Node/Windows de la batería actualizada: PASS (38 casos).** La palabra `REAL` de la última línea es el marcador del script del operador para QA Node real, **no** una prueba nativa Docker/PostgreSQL. No hubo ejecución Docker/SQL ni atestación de la imagen física.

GitHub confirma la revisión anterior Codex de `27e35b78166c8efab405f10b62defabd6a6b4935` con respuesta sin problemas importantes; la nueva revisión solicitada sobre `7b2a5f37765cdd37bfcf66fe79aaebd88db68b48` aún constaba `running` al consultar. Los hilos P2 del pin de imagen y de arrays dispersos continúan sin resolver administrativamente hasta obtener rereview concluyente para ese SHA. No autorizar merge ni ejecución.
