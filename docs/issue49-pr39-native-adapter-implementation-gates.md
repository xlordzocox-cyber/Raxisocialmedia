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
