# Issue #49 — Contrato nativo PG17 T0/T1: incremento de seguridad **offline**

**Fecha:** 2026-11-05. **Estado:** código de contrato y regresiones publicados; **ningún ejecutor Docker/SQL fue implementado ni autorizado**.  
**Ámbito:** PR #50 en borrador, evidencia de la divergencia `public.raxi_workspaces.raxi_workspaces_slug_check`.

## Archivos nuevos

- `scripts/issue49-pr39-native-trial-contract.mjs`: módulo **puro**. Consume la validación estricta del preflight y el selector de endpoint Docker local del PR39; valida datos hipotéticos del futuro experimento, construye un blueprint de cuatro roles T0/T1, coteja identidades/aislamiento a partir de observaciones sintéticas y clasifica comparaciones de catálogo **sin autorizar nada**.
- `scripts/test-issue49-pr39-native-trial-contract.mjs`: fixtures sintéticos con 12 casos de daemon/imagen, 7 casos de plan/autorización/huellas, 23 casos de identidad/aislamiento/blueprint y 5 casos de catálogo/limpieza, total previsto **47 negativas**. Solo utiliza Node, archivos SQL/manifest existentes **en lectura** y objetos simulados.

## Propiedades y límites de confianza

1. **Endpoint:** se reutiliza `selectPr39LocalDockerHost`. Se rechazan TCP/SSH, TLS, contextos no admitidos y override de Docker en las entradas. La inspección suministrada por el caller está marcada `CALLER_SUPPLIED_NOT_ATTESTED`; NO prueba la identidad física del daemon.
2. **Imagen:** se exige `sha256` de 64 hex, metadatos declarados `PostgreSQL 17.11`, Linux amd64, sin fallback ni referencia mutable. Es una estructura **ficticia entregada al verificador**, no evidencia de haber inspeccionado una imagen real.
3. **Blueprint:** cuatro roles inmutables T0_SOURCE, T0_RESTORED, T1_SOURCE, T1_RESTORED; nombres y labels atados a sesión de 24 hex; imagen común, `network=none`, sin puertos, privilegios, bind mounts ni reutilización de contenedores. SHA de DDL de cada rol vinculado al preflight fijado con `assertPlanIsBlocked(plan,source)`.
4. **Observaciones:** cuatro contenedores sintéticos, IDs completos distintos, roles, nombres, labels y SHA coincidentes, sin red ni puertos/privilegios/montajes, y registro de volumen anónimo si existiera. Se declara `CALLER_SUPPLIED_NOT_DOCKER_ATTESTED`; ninguna función ejecuta inspecciones de Docker ni limpiezas reales.
5. **Resultados:** compara SHA de `conbin`, catálogo y build por pareja T0/T1 para clasificar: `T1_MICROSCHEMA_CANDIDATE_ONLY`, `T1_NOT_CONFIRMED`, `NOT_REPRODUCED` o `INCONCLUSIVE`. Se requiere `cleanup='COMPLETE'`, pero ese estado **también es sintético**, no una prueba de recursos efectivamente eliminados.
6. **Fail-closed:** todos los retornos preservan `decision=BLOCKED`, `allowCatalogPass=false`, `NO_GO_HOSTED_MIGRATION`; no existe función que active migraciones o cree contenedores. La futura implementación real requerirá pruebas específicas sobre sus subprocesses y salida de Docker/PG17, además de autorización independiente.

## Revisión del código realizada

Los dos archivos se recuperaron desde GitHub. El análisis sintáctico V8, sin ejecutar imports, pasó para ambas fuentes después de corregir un corchete ausente en una negativa de bind mount. Un smoke-test aislado del módulo con selector de daemon y preflight simulados verificó cuatro roles, un retorno `BLOCKED`, 6/6 manipulaciones de observación rechazadas, y la clasificación sintética T1 candidata que **sigue sin autorizar migración**. Estos resultados NO sustituyen ejecutar la batería completa sobre Node.js real con las dependencias reales.

## QA Windows seguro pendiente (sin Docker ni SQL)

Los scripts del contrato importan también `scripts/pr39-local-docker-guard.mjs` y `scripts/issue49-pr39-t0t1-offline-executor.mjs`. Para ejecutar la prueba desde un checkout `RaxiHQ-Oficina` sin cambiar `main`, obtener los **cuatro** archivos de la revisión fijada a una misma carpeta temporal. Ejecutar `node --check` para los cuatro y luego `node <ruta-temporal>/test-issue49-pr39-native-trial-contract.mjs` desde la raíz del repositorio.

Resultado esperado: `PASS ISSUE49 NATIVE DESIGN NEGATIVES (47 rejected synthetic cases; no Docker/SQL/network)` y `DESIGN_ONLY / BLOCKED / NO_GO_HOSTED_MIGRATION`. Si no coincide, registrar FAIL y detenerse. Un eventual PASS es del **contrato sintético**, no de un runner PostgreSQL 17 real.

## Puertas adicionales

- Ejecutar las 47 negativas oficiales en Windows sobre SHA fijado; corregir hallazgos, revisión Codex independiente al SHA de código final y reejecución si cambia el código.
- En una siguiente autorización **solo de implementación**, escribir un adaptador Docker/psql que consuma el contrato pero esté separado del módulo offline, con prohibición de invocación por defecto, pinning de imagen real, IDs de recursos, tiempo límite, `finally` y captura acotada. Someterlo a negativas antes de autorizar ejecución.
- Solicitar otra autorización expresa y específica **para ejecutar** cuatro contenedores locales con datos sintéticos. Nunca asumir autorización por crear el contrato.
- En ningún caso habilitar Supabase alojado, SQL remoto, Auth real, proveedores, despliegues, merges ni normalización permisiva del catálogo.

**Política sin cambios:** `BLOCKED / NOT_VERIFIED; allowCatalogPass=false; NO_GO_HOSTED_MIGRATION`.


## QA del operador y corrección del hallazgo P2 Codex

El operador ejecutó en Windows el contrato publicado en commit `06659b4cbcc23fafc82632cb9019841d029cec8f`: sintaxis de cuatro archivos PASS, contrato sintético PASS y `PASS ISSUE49 NATIVE DESIGN NEGATIVES (47 rejected synthetic cases; no Docker/SQL/network)`. El estado final fue `DESIGN_ONLY / BLOCKED / NO_GO_HOSTED_MIGRATION`.

La revisión Codex de ese commit detectó **un nuevo P2** en el contrato: `inspectSyntheticContainerSet` permitía que varios roles compartieran la misma cadena SHA de volumen anónimo, a pesar de `sharedVolumes=false` (hilo `PRRT_kwDOVIWc5s60QYhJ`). El resultado de 47 negativas **no cubría esa situación**. Correctivo en `scripts/issue49-pr39-native-trial-contract.mjs`, commit `23bd31bd31132e1be58aa1812dad8624d5915e21`: `volumeIds` global y rechazo de cualquier volumen repetido entre roles. Regresiones en `scripts/test-issue49-pr39-native-trial-contract.mjs`, commit `3c56a67a4bb61738170fdd3e2022a3159d0abeb6`: volumen compartido entre origen/restauración y compartido entre los cuatro roles; total esperado **49 negativas**.

Verificación parcial: los archivos corregidos pasan comprobación de sintaxis aislada V8 y dos pruebas de humo con dependencias simuladas rechazaron ambos casos de volumen compartido manteniendo `BLOCKED`. **La batería de 49 negativas aún no se ha ejecutado con Node real en Windows, ni se ha obtenido dictamen independiente de los correctivos.** Mantener P2 abierto hasta ambos controles; no activar Docker, SQL ni migraciones.


## QA del correctivo de volúmenes en Windows (2026-11-05)

El operador ejecutó el contrato actualizado y sus pruebas sintéticas desde `FETCH_HEAD` fijado a `f0ac98efceb36e0ddddfa28e2cfd867d1014dc73`. El análisis `node --check` de los cuatro archivos pasó; se obtuvo `PASS ISSUE49 NATIVE DESIGN: four owned isolated synthetic role specs; outcomes never authorize migration` y `PASS ISSUE49 NATIVE DESIGN NEGATIVES (49 rejected synthetic cases; no Docker/SQL/network)`, seguido de `ISSUE49 STATUS: DESIGN_ONLY / BLOCKED / NO_GO_HOSTED_MIGRATION`; código de salida cero. **QA offline del correctivo P2: PASS.**

El 2026-11-05 la segunda revisión Codex fue solicitada mediante comentario `6668490303`; al consultar GitHub tras la ejecución, el hilo del P2 `PRRT_kwDOVIWc5s60QYhJ` seguía `is_resolved=false` y no había aún dictamen nuevo. **No cerrarlo antes de revisar la segunda respuesta.** Esto no representa prueba nativa de PostgreSQL ni permiso para Docker, SQL o Supabase.
