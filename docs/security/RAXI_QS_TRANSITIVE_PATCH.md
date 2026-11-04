# Raxi HQ — Correctivo mínimo de la dependencia transitiva qs

Estado: **PR separado para revisión; sin ejecución de paquetes ni despliegue por el asistente**. Base `eb3ef309fb5ec42c13393e465df14e9aaf656fe8`.

## Diagnóstico confirmado

El `apps/raxi-hq/package-lock.json` de `main` fijaba `node_modules/qs@6.16.0`. No es una dependencia directa declarada por Raxi HQ: la introduce `url@0.11.4`, que declara `qs:^6.12.3`. El paquete corregido `qs@6.16.1` satisface ese rango.

Advisory oficial: [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) — denegación de servicio moderada en `qs.stringify` con `arrayFormat:'comma'` y `toString` no invocable en valores controlados por entrada. Versiones afectadas hasta `6.16.0`; corregido en `6.16.1`. Release del mantenedor: [v6.16.1](https://github.com/ljharb/qs/releases/tag/v6.16.1).

## Cambio

Solo se modificó **una entrada de paquete** del lockfile: `node_modules/qs` pasa de `6.16.0` a `6.16.1`, actualizando URL de tarball e integridad SHA-512. Su integridad publicada fue contrastada con lockfiles públicos existentes; **debe verificarse mediante `npm ci` contra el registro oficial** antes de autorizar merge.

No se modifica `package.json`, otras dependencias, código ejecutable, scripts de build, SQL, runtime, permisos, PR #39, ni se ejecuta `npm audit fix --force`. La actualización es reproducible mediante el lockfile y la política de rangos de `url`.

## Validación requerida por Codex en un entorno autorizado

Desde `apps/raxi-hq` en la rama aislada:

```sh
npm ci --ignore-scripts
npm ls qs
npm audit --json
npm run typecheck
npm test
node --test tests/stagingSafety.test.mjs
npm run build
git diff --check origin/main...HEAD
```

Confirmar que `npm ls qs` muestra `6.16.1`, el advisory descrito desaparece y no aparecen alertas nuevas. Revisar cambios del lockfile y hashes contra registro npm. No se debe interpretar el código de salida de `npm audit` sin leer sus hallazgos.

**Limitación:** el asistente no pudo consultar el registro npm o instalar dependencias desde este entorno. Esta revisión fue estática y los resultados anteriores de QA no prueban el lockfile nuevo. La validación completa queda pendiente de ejecución independiente.

PR #39 permanece separado. No hacer merge ni desplegar sin autorización humana.
