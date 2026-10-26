# B1 — evidencia preparatoria local

Fecha: 26 de octubre de 2026. Base main `55eecc4ef7a6e6eb748c61ea1c1e2b30c4657247`. Rama aislada `feature/raxi-hq-supervised-host-stage-b1`. Las diez eliminaciones JPEG del checkout original se conservan fuera de esta rama.

## Resultados

Desde apps/raxi-hq:

| Comando / inspección | Resultado |
| --- | --- |
| npm ci --ignore-scripts --no-audit | PASS; 166 paquetes; lockfile sin cambios |
| NODE_OPTIONS=--max-old-space-size=512 npm test -- --serial | **552/552 PASS**, 0 fallos/canceladas/omitidas; 169924 ms |
| Pruebas nuevas B1 incluidas | **10 PASS**; no sumar otra vez |
| npm run build | PASS; comprobación Edge preexistente, TS servidor/frontend y Vite |
| npm run typecheck | PASS |
| node --test tests/stagingSafety.test.mjs | **1/1 PASS**; solo guard local |
| Total | **553/553 PASS** |
| npm audit --json | **0 vulnerabilidades** |
| git diff --check | PASS |
| Escaneo de secretos staged | PASS; diez archivos, sin credenciales, env o temporales |

El runner existente añade una opción --serial que limita únicamente concurrencia de archivos, conservando todos sus entrypoints. El script B2 se deja externo al bundle del test para conservar import.meta.url y probar su importación real inerte. Ningún test ejecuta el camino alojado del runner.

Logs ignorados en .validation; no se incorporan temporales ni credenciales:

| Archivo | SHA-256 |
| --- | --- |
| b1-final-tests.log | e8ff5acda2e9a076193d4882c127ebd2b7ba8b87717c7517168e5bb97ffa5421 |
| b1-final-build.log | 6f5d1887c24262c7cdfd01b054eb09db52020a78fe38739a61c50b913beaf4bd |
| b1-final-typecheck.log | bbe04f6e49318f343e677d30ecba84d350ae7a6da455c741dd6ac3032ba7eb72 |
| b1-final-guard.log | f74a298581eed3f017e6fc35253f76317d6458c5b4dcf22f3e831f0a76a15051 |
| b1-audit.json | de3ed797396926da2095388a1a7b5798ea3bfd58fef3098cf052238a431ff691 |

## Qué se comprobó

- Tokens ausentes/inválidos, claims anónimos/caducados/futuros/de otro proyecto, identidad diferente y autoridad inyectada se rechazan usando **dobles locales de Auth**, no JWT firmados.
- La RPC propuesta consulta filas locales equivalentes a auth.sessions/auth.users; sesión eliminada o vencida y workspace ajeno rechazan sin nuevo efecto.
- Idempotencia de preparación/aprobación/ejecución, límites de presupuesto, aprobación revocada/caducada y scope diferente; sin automatizar Investigador.
- Revalidación antes de dispatch. Tras revocación se permite conservar ACK/finish de una admisión anterior; se deniega claim nuevo.
- Commit final confirmado con cuerpo perdido: reapertura en disco y conciliación FOUND sin repetir proveedor. Fallo anterior al commit final: incertidumbre conservada, recibo ACK preservado y MISSING no autoriza retry.
- Alteración del digest produce CONFLICT en la RPC de conciliación; journal no admite DELETE. Las regresiones completas del P2 de A (comando alterado, digests ausentes, confirmaciones modificadas, UPDATE/DELETE/TRUNCATE y reinicio) siguen en las 552.
- Host Request/Response cerrado, liveEnabled:false, solo simulatedProvider, cero fetch en el flujo local y sin lease_token en respuesta.
- Guard B2 rechaza ausencia de autorización, producción, configuración incompleta, metadatos incompatibles o manifiesto vencido; cero llamadas de red en esas pruebas.

## Revisión de seguridad

Revisión manual de entradas, límites de confianza, RPC allowlist, grants, search_path, digests, política y transición de recibos; auditoría npm y patrones de secretos. No es una ejecución del servicio Codex Security ni certificación alojada.

`node scripts/security-scan.mjs` devolvió código 1 por **una coincidencia clasificada** en el bundle preexistente: literal de campo SDK `access_token:"access_token"`. Es un identificador, no un token. No se modificó el detector ni se añadió una excepción para ocultarlo. El bundle index-CwjaT4br.js tiene el mismo SHA-256 que el build anterior de A: `73099878784636917540b0a68404d3536815e61ca4ce106d9e4b416a6e3fa79f`. No hay credencial nueva en frontend ni cambios de dependencias. La inspección staged separada cubre además server/proposals/docs y excluye temporales.

Las funciones B son INVOKER con search_path vacío. service_role sigue siendo infraestructura confiable que omite RLS; las comprobaciones de sesión/propietario no convierten su credencial en un rol aislado por usuario. La propuesta añade lecturas por columna de sesiones para el servidor, nunca para el navegador. La matriz y bloqueos están en [diseño B](../../../docs/RAXI_HQ_SUPERVISED_HOST_STAGE_B.md).

## Límites y prohibiciones conservadas

No hubo solicitudes a Supabase alojado, Management API, OpenAI, Aria u otros proveedores durante B1. Las operaciones remotas de entrega se limitan a Git/GitHub. No se crearon proyectos/usuarios reales, migraciones, endpoints, workers, infraestructura o nuevas credenciales; no hubo despliegue ni merge. Los SQL se ejecutaron exclusivamente dentro de fixtures PGlite locales. Guardian, la oficina y el observador histórico permanecen sin cambios.

B2 sigue bloqueada: proyecto aislado y coste autorizados, inventario real de Auth/esquema/grants, firmas y revocación auténticas, dos conexiones físicas con contención, rollback/caídas/restauración y aprobación SQL. El runner preparado acredita solo un subconjunto y declara fullB2MatrixComplete:false. C sigue bloqueada por captura de recibos antes del primer commit y por todos los controles/costes reales pendientes.
