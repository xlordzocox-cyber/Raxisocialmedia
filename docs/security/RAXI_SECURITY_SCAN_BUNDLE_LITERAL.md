# Raxi HQ — Clasificación conservadora del falso positivo de OAuth en bundle

Base de trabajo: `eb3ef309fb5ec42c13393e465df14e9aaf656fe8`. Cambio independiente de PR #45 (proyección runtime), PR #46 (`qs`) y PR #39 (PG17). **No habilita ninguna credencial, permisos, proveedor, despliegue ni excepciones de seguridad generales.**

## Evidencia y diagnóstico

El usuario ejecutó el escáner de seguridad después del build en worktrees aislados de PR #45 y PR #46. Ambos reportaron una coincidencia de regla `assigned-credential` en `dist/assets/index-*.js`, línea 17. Diagnóstico local seguro: nombre `access_token`; longitud del match 27. Verificación adicional, sin exponer el valor, confirmó en ambos bundles: longitud de valor 12 y valor idéntico al nombre `access_token` (`True`). Por tanto, **estas coincidencias concretas no son credenciales ni secretos filtrados**. Esto no prueba que el escáner sea exhaustivo ni que ninguna otra parte del bundle contenga secretos.

## Cambio y alcance de la excepción

Se excluye únicamente en `dist/assets/*.js` el valor literal que coincide exactamente con el propio nombre del campo `access_token`, con asignación `:` o `=` y comillas coincidentes. La regla `assigned-credential` sigue activa en todos los otros casos, incluido un valor no idéntico en el mismo campo. No se excluyen otras rutas, reglas ni valores; no se ignora el directorio `dist` ni se desactiva el escáner.

Regresiones mediante `tests/securityScan.test.ts` (incluida en `npm test`): 
- El literal autocoincidente en un bundle `dist/assets/index-*.js` no es tratado como secreto.
- El mismo literal en código fuente **sí** es detectado.
- Un valor sintético distinto para el mismo campo en bundle **sí** es detectado.
- Una clave `password` sintética distinta en bundle **sí** es detectada.

Las pruebas usan directorios temporales, eliminados automáticamente, y valores sintéticos: ninguna credencial real.

## Verificación pendiente

Este incremento se creó por conector GitHub sin ejecutarse contra el entorno real del usuario. Ejecutar `npm test`, `npm run build`, `node scripts/security-scan.mjs`, `npm run typecheck`, staging guard, revisión de secretos, `git diff --check` y revisión independiente de Codex antes de proponer merge. Los PR #45 y #46 permanecerán con su escáner original hasta que este cambio se integre y se vuelvan a validar, o sus hallazgos se clasifiquen formalmente sin cambiar el baseline.

## Restricciones

No tocar PR #39, proveedores, Auth/RLS, SQL alojado, ejecutores ni despliegues. No hacer merge sin autorización explícita.
