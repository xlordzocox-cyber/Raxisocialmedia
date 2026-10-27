# Issue #22 — evidencia local y bloqueos PG17/CLI

Fecha: 26-10-2026. Base `271f33d294b5dcdf7b36f6abae31baeb962d3820`, merge PR #21 verificado en origin/main. Rama `feature/raxi-hq-pg17-candidate`. Se usa la alternativa explícita del [Issue #22](https://github.com/xlordzocox-cyber/Raxisocialmedia/issues/22): preparar casos/candidato y documentar BLOCKED cuando no existe PG17 autorizado, sin fabricar resultados.

## Resultado y límites

**Validación nativa PostgreSQL 17: BLOCKED / NO EJECUTADA.** No se encontraron psql/pg_ctl/postgres/Supabase CLI en PATH, servicio/proceso postgres ni psql en la ruta estándar PG17. No apareció Supabase CLI en la caché existente comprobada. Docker CLI está instalado, pero no se acreditó un motor PG17 autorizado ni backend/Desktop activo en el chequeo. No se ejecutó Docker ni se instalaron motores/CLI, imágenes o servicios.

**Generación de versión por Supabase CLI: BLOCKED / NO EJECUTADA.** Se preparó un artefacto SQL candidato, fuera de migrations/, reproducible por ensamblador offline y marcado NOT A CLI MIGRATION. cliMigrationVersion sigue null, sin timestamp inventado. El flujo CLI futuro se documenta con verificación de ayuda instalada y directorio offline autorizado; no se suplanta su procedencia.

El catálogo previo sigue siendo PG18. El manifiesto conserva executionReady:false, PENDING_PG17_REVIEW y todas las authorizations:false; candidato executionAuthorized:false. El Issue conserva pendiente la aceptación nativa PG17/CLI. No se declara B2 completada.

## Validaciones ejecutadas

Desde apps/raxi-hq:

| Comando / inspección | Resultado |
| --- | --- |
| npm ci --ignore-scripts --no-audit | PASS; 166 dependencias del lockfile; sin cambios en dependencias |
| Regresiones pg17Candidate.test.ts incluidas en la suite | **10/10 PASS en el entorno local disponible**, no PG17 |
| NODE_OPTIONS=--max-old-space-size=512 npm test -- --serial | **607/607 PASS**, 0 fallos/cancelaciones/omisiones; 145011 ms |
| npm run build / npm run typecheck | PASS |
| node --test tests/stagingSafety.test.mjs | **1/1 PASS**, sin conexión alojada |
| Total suite completa + guard | **608/608 PASS**; las enfocadas ya están incluidas |
| node scripts/verify-staging-preparation.mjs | PASS offline; siete fuentes, flags bloqueados y candidato válido |
| node scripts/consolidate-runtime-candidate.mjs --check | PASS offline; versión null, PG17 BLOCKED, sqlExecuted:false |
| npm audit --json | **0 vulnerabilidades** |
| Diff y secretos staged | PASS; sin temporales, env o credenciales incorporados |

Las pruebas nuevas rechazan candidato/payload alterado, GRANT cambiado, orden incorrecto, fuentes adicionales, versión no autorizada y manifiesto manipulado. El candidato completo compila bajo una transacción **PGlite PG18** y conserva catálogo/grants; authenticated no puede ejecutar la RPC privilegiada. Un segundo intento de DDL falla sin alterar el esquema original. Una división por cero al final de la transacción revierte todo runtime/A/B y preserva las cuatro bases.

Las regresiones anteriores de proyecto/manifiesto/autorización, idempotencia, dos actores fixture, journal P2 manipulado, revocación, reservas, fallos de persistencia, recuperación y oficina siguen dentro de las 607. Los actores/Auth son dobles locales; no hay sesiones Supabase auténticas, PIDs de conexiones nativas PG17 ni contención física acreditada. No se elevan pruebas PG18 a PG17 por inferencia.

## Integridad del paquete

- Pin canónico del manifiesto #21 anterior: `872378b984779365f3bd0106a13191edfddf99978e3faa8b0c6eb76f6d919ce4`.
- Pin actual, incorporando candidato/procedencia: `a37c4285af09c428cfefc8a60e92defdc616d4029a25812e79f3403c7da5a44a`.
- Candidato SHA-256(LF): `bc4ce83cfe5e64fc116dd5eb408254f1b0363b868d1a71b5378053435c3b0c15`.
- Catálogo candidato PG18 sin cambios: `c16ad9f612decf6af2aaf3a75219b3b09732070a0e09c9b32531ec3a3b94df90`.

Las siete fuentes conservan exactamente sus hashes de #21 (cuatro bases + runtime/A/B), verificados antes del ensamblado. La quinta de campañas permanece excluida. El SQL candidato es un artefacto de revisión generado desde esas fuentes; no las reemplaza ni implementa otro runtime/ledger. Nuevas autorizaciones requieren revisión del pin y no se derivan del éxito del checker.

La única allowlist alojada futura sigue siendo zvhxjindgyvtasstfjut / qpjzdqkvjzgqwvismeku / us-east-2. Producción jrkefsylpfriiqefcmzq se mantiene prohibida. No hay conexión remota ni credencial necesaria para generar/comprobar este candidato.

## Seguridad y restricciones

Revisión manual de procedencia, flags CLI, ruta fija de salida, hashes/snapshots, ausencia de ejecución o red en herramientas offline y mantenimiento de controles existentes; npm audit y patrones staged. No es una ejecución del servicio Codex Security ni aprobación de PG17/alojado.

El detector general `node scripts/security-scan.mjs` conserva código 1 por el falso positivo conocido del literal de campo SDK `access_token:"access_token"` en index-CwjaT4br.js. No se modificó el detector. El bundle sigue con SHA-256 `73099878784636917540b0a68404d3536815e61ca4ce106d9e4b416a6e3fa79f`, idéntico al anterior. No se añadió ninguna credencial al navegador.

Sin SQL alojado, B2, usuarios alojados, despliegues, proveedores IA/Aria, nuevos recursos facturables o merge. No se modifican las fuentes SQL, Guardian, OfficeScene, AgentMotion, RuntimeOfficeStore o histórico #18. Las diez eliminaciones JPEG locales siguen fuera de esta rama/PR. Git/GitHub son las únicas operaciones remotas de entrega.

## Evidencias reproducibles

Logs ignorados en apps/raxi-hq/.validation:

| Log | SHA-256 |
| --- | --- |
| issue22-final-tests.log | 4a189495914e41d5e56618adf5ff4d03a16cd560c6f75136e792e25920c1877c |
| issue22-final-build.log | c4c3ea1e9c3c77629766ed755df8c9fee756aa519941a6d25756f635d02c7293 |
| issue22-final-typecheck.log | bbe04f6e49318f343e677d30ecba84d350ae7a6da455c741dd6ac3032ba7eb72 |
| issue22-final-guard.log | 7bc4fefbc3986234325ae3cf56728cc129a00b70aee9e59c1b1dfaeac9fdcb12 |
| issue22-audit.json | de3ed797396926da2095388a1a7b5798ea3bfd58fef3098cf052238a431ff691 |
| issue22-offline.log | bee3945983e1444507eb6512efc63e11a54091ee3a9d762eb254a6fceb44586e |
| issue22-candidate.log | 5c05e2b328c5fce6352dcc1da90d3b3b48b3fba299b5e37f3639c4d8aea0b710 |

Plan nativo pendiente, flujo CLI, matriz adversarial, respaldo, recuperación y reversión sin DROP automático: [plan PG17 local](../../../docs/RAXI_HQ_PG17_LOCAL_VALIDATION_PLAN.md). No se cierra el Issue #22 por estos PASS locales; corresponde revisión humana y autorización de un PG17/CLI disponible antes de la aceptación pendiente.
