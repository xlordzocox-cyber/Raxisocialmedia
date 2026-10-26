# PR #21 — evidencia de preparación B2

Fecha: 26 de octubre de 2026. Main y merge PR #20 verificados en `b56b26567bc97078fa58ef16385b851d890d6408`; PR #19 integrado en `55eecc4ef7a6e6eb748c61ea1c1e2b30c4657247`. Rama aislada `feature/raxi-hq-staging-b2-preparation`. Se recuperaron los archivos modificados y nuevos existentes, sin descartes ni reinicio de la implementación.

## Resultados locales finales

Desde apps/raxi-hq:

| Comando / inspección | Resultado |
| --- | --- |
| npm ci --ignore-scripts --no-audit | PASS recuperado; 166 paquetes; lockfile intacto |
| Pruebas enfocadas stagingPreparation.test.ts | **22/22 PASS** |
| NODE_OPTIONS=--max-old-space-size=512 npm test -- --serial | **597/597 PASS**, 0 fallos/cancelaciones/omisiones; 223755 ms |
| npm run build | PASS; chequeo de artefacto de campañas, TypeScript servidor/frontend y Vite |
| npm run typecheck | PASS |
| node --test tests/stagingSafety.test.mjs | **1/1 PASS**, sin conexión remota |
| Total suite completa + guard | **598/598 PASS**; no sumar nuevamente las enfocadas |
| node scripts/verify-staging-preparation.mjs | PASS; siete fuentes, executionReady:false, PENDING_PG17_REVIEW, sin red/SQL |
| npm audit --json | **0 vulnerabilidades** |
| Diff / revisión staged de secretos | PASS; sin credenciales, env, auxiliares o logs incorporados |

Las 22 pruebas nuevas comprueban manifiesto/SQL/snapshot ligados a SHA-256; diez alteraciones del manifiesto; huellas incorrectas, CRLF/LF y snapshot previo a await; seis identidades de proyecto incompatibles; esquema vacío sintético frente a drift; orden consolidado contra SQL local y columna inesperada; configuración/autorización inválidas y frontera exacta de vencimiento.

El SQL solo se carga dentro de fixtures PGlite locales. La prueba de catálogo usa las cuatro bases y concatena runtime/A/B en memoria; no escribe una migración ni cambia el historial alojado. Las demás regresiones de Auth/journal/recibos/oficina de #19/#20 permanecen en la suite. No se ejecutó B2, no se creó usuario alojado y no se invocó proveedor REAL.

## Integridad y destino

Manifiesto canónico SHA-256: `872378b984779365f3bd0106a13191edfddf99978e3faa8b0c6eb76f6d919ce4`.

Catálogo candidato SHA-256: `c16ad9f612decf6af2aaf3a75219b3b09732070a0e09c9b32531ec3a3b94df90`.

| Fuente en orden | SHA-256 con finales LF |
| --- | --- |
| 20261019030541 private_core | e0f0a828b5d4f31960f2153ad910bb84a399a449754db8761057e91047cd7ba0 |
| 20261019030659 fk_indexes | 2967d26201b0e335edec509e5cb40cc0808e3c422ff5eceeff1251b3ae43cf49 |
| 20261019030808 workspace_onboarding | 67472da139bbe3146f6e21ff8f1a5992a41a73fe80fd52800a9448ef15d3e375 |
| 20261019231655 real_idea_write | 89d9db4a1fa22eef45d34f279dbb10fd5feada5b495dab12eedfbbc4b66188ec |
| agent_runtime.sql | 36114c12797976ebfc0afdf94ca59c6a0c3dd11b184efdc5c83803b4eeefcb8c |
| supervised_host_stage_a.sql | 7f6de9365a6e85492b3e8e18b929f5caecfb3a01791d1326b34686e436c6ef3d |
| supervised_host_stage_b.sql | 59595546fdf1302342df0691fd5c3c7645d2a521861221ca11ae05b184bcb689 |

Se fija zvhxjindgyvtasstfjut / qpjzdqkvjzgqwvismeku / us-east-2, nombre raxi-hq-staging. Producción jrkefsylpfriiqefcmzq se rechaza antes de conectar; otros proyectos también quedan fuera de la allowlist. No se acepta una etiqueta/env como prueba suficiente: una autorización futura deberá estar ligada al manifiesto revisado y contrastarse con metadatos autenticados, endpoints y catálogo SQL. El manifiesto actual no concede esa autorización.

El baseline cero migraciones/cero tablas procede del usuario y no fue reconsultado. No se registró una fecha de observación inventada. La quinta migración de campañas se revisó y se excluyó del paquete por ser independiente. No se modifican las cuatro bases ni runtime/A/B; sus huellas se comprobaron offline. La versión de una futura consolidación runtime/A/B es null (sin asignar), por lo que READY no puede aceptarse.

## Bloqueo PG17

El fixture informa **PostgreSQL 18**, con 20 tablas Raxi protegidas por RLS y 23 funciones Raxi invoker. No es evidencia de PG17 alojado. No se encontraron psql/pg_ctl/postgres en PATH, servicio/proceso postgres ni psql en la ruta estándar PG17 comprobada. No se instalaron binarios ni se iniciaron contenedores o servicios para resolverlo.

`schemaCompatibility=PENDING_PG17_REVIEW`, executionReady:false y permisos false mantienen B2 bloqueada. La validación sintética EMPTY de PG17 solo prueba el validador; no acredita un motor PG17. Corresponde una autorización futura para un entorno PG17 y revisión del catálogo y de Auth/Storage/default grants antes de cambiar el pin. No se presenta la aceptación local como B2 completada.

## Revisión de seguridad

Revisión manual del guard/pins, orden de validación previo a credenciales/red, copia antes de await, hashes de fuentes y catálogo, lectura de metadatos, ausencia de DDL remoto y mantenimiento del proveedor simulado; patrones de secretos y npm audit. No se ejecutó el servicio Codex Security ni se certifica el staging alojado.

El detector general `node scripts/security-scan.mjs` sigue devolviendo código 1 por una coincidencia clasificada del literal SDK `access_token:"access_token"` en el bundle index-CwjaT4br.js. Su SHA-256 permanece `73099878784636917540b0a68404d3536815e61ca4ce106d9e4b416a6e3fa79f`, idéntico al build anterior; no es una credencial ni un cambio de frontend. No se modifica el detector para ocultarlo. La inspección staged cubre también manifiestos, propuesta y documentación.

No se accedió a Supabase/Management API/Storage/Auth alojados ni a producción. Las operaciones remotas de entrega son solo Git/GitHub. No hubo SQL remoto, migraciones aplicadas, proyectos/usuarios creados, despliegues, worker, servicios facturables, IA/Aria ni merge. Guardian, OfficeScene, AgentMotion, RuntimeOfficeStore e histórico #18 están intactos. Las diez eliminaciones JPEG del checkout original se conservaron fuera del PR.

## Evidencias reproducibles

Logs ignorados en apps/raxi-hq/.validation, sin credenciales:

| Log | SHA-256 |
| --- | --- |
| pr21-final-tests.log | 0b18f63e1470008873e87e0354224021fb444bfc89457059be92ac1a2b2342fe |
| pr21-final-build.log | 5dda0e73ea1d5ac539afb940a1175af10b9f00b6db5c078ac45348e11abae025 |
| pr21-final-typecheck.log | bbe04f6e49318f343e677d30ecba84d350ae7a6da455c741dd6ac3032ba7eb72 |
| pr21-final-guard.log | ad5b49a5c6a6aeda6ef548ddc067c0e19bddd0755666ca6aafaa259d20080d57 |
| pr21-audit.json | de3ed797396926da2095388a1a7b5798ea3bfd58fef3098cf052238a431ff691 |
| pr21-offline-check.log | b319ad6b55368a80c7b498191205696392c7565dccddaff3da1a4370b96e37ce |

Orden de aplicación propuesto y exclusiones: [plan consolidado](../../../supabase/proposals/staging_b2_migration_plan.md). Respaldo, verificación, reversión, riesgos y autorizaciones pendientes: [procedimiento](../../../docs/RAXI_HQ_STAGING_B2_PREPARATION.md). No hay un entorno cambiado que revertir en esta entrega; cualquier futura restauración/infraestructura requiere autorización independiente.
