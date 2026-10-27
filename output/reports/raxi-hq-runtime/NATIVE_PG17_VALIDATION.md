# Validación nativa local PG17 — evidencia

Base: main `1b7ab1e3240285f803d8c78b8f6420ee86cca1bf`, posterior al PR #23.
Rama: `feature/raxi-hq-native-pg17`. Las siete fuentes permanecen sin cambios.
Fecha local de validación: 27 de octubre de 2026.

## Alcance comprobado

Se aplicaron bootstrap sintético y cuatro migraciones base → runtime → A → B
en una sola transacción en el laboratorio autorizado, PostgreSQL **17.11**
(`server_version_num=170011`). No se ejecutó la quinta migración de campañas.
No se ejecutó B2 ni SQL Supabase alojado. Cero llamadas a proveedores.

Destino y aislamiento constan en `NATIVE_PG17_RESULT.json`: ID Docker e imagen
fijados, base `raxi_validation`, socket Unix, red interna sin puertos publicados
y datos tmpfs. No hubo instalaciones, descargas de imágenes, contenedores nuevos,
reinicios, eliminación del laboratorio, usuarios alojados ni despliegues.

La primera comparación del catálogo se detuvo sin continuar pruebas porque el
pin anterior era PG18. Se investigaron las diferencias: NOT NULL en pg_constraint
y orden por colación de índices; definiciones equivalentes conservando attnotnull.
Las funciones y roles coinciden sin normalización. Se añadió un baseline PG17
local separado, sin modificar el manifiesto ni sus flags de preparación.

## Evidencia automatizada

| Comando (desde apps/raxi-hq) | Resultado final |
| --- | --- |
| `npm ci --ignore-scripts --no-audit` | PASS, 166 paquetes del lockfile; lock sin cambios |
| `npm test -- --serial` (`NODE_OPTIONS=--max-old-space-size=512`) | **626/626 PASS**, 0 fallos/cancelados/omitidos, 227474.5214 ms |
| `node scripts/validate-native-pg17.mjs --test-existing` | **12/12 PASS PG17**, 0 fallos/cancelados/omitidos, 381145.5784 ms |
| `node --test tests/stagingSafety.test.mjs` | **1/1 PASS** |
| `npm run build` / `npm run typecheck` | PASS / PASS |
| `npm audit --json` | **0 vulnerabilidades** |
| `node scripts/verify-staging-preparation.mjs` | PASS offline, siete huellas; B2 bloqueado |
| `node scripts/consolidate-runtime-candidate.mjs --check` | PASS offline, candidato original intacto |
| `git diff --cached --check` / revisión de secretos staged | PASS / PASS |

**639 pruebas finales aprobadas** entre tres suites; no se suman la primera pasada
nativa (10 casos) ni repeticiones de pruebas. El guard puro de 19 casos ya está
incluido en las 626 pruebas generales. No se ejecutó un escaneo de seguridad remoto.
Comandos reproducibles en `docs/RAXI_HQ_NATIVE_PG17_LAB.md`.

En la pasada final, backend **2325** esperó un lock del **2318**, observado por
otra conexión mediante `pg_blocking_pids`. Aprobaciones simultáneas reservaron
10 una sola vez y claims simultáneos produjeron un único run. La pérdida de
respuesta se inyectó *después* de confirmar finish en SQL; nuevos clientes
conciliaron el mismo journal y el replay no creó otro efecto.

Comprobación adicional del transporte: dos consultas reutilizaron PID 1930;
tras el error SQLSTATE 22012, el comando posterior abrió PID 1946, sin repetir
la consulta fallida. La confirmación de este smoke no se cuenta como suite nueva.

Huellas SHA-256 de logs locales ignorados (`apps/raxi-hq/.validation`):

| Archivo | SHA-256 |
| --- | --- |
| native-pg17-tests.log | `ff4db5f56a1543dee456741210b56d1ecc4e6e5a04f759af28e06dcd8ec8253f` |
| native-final-suite.log | `4dfbc24aea22fd6c3c5f7040fa1959d944688a6c9d47cc925b76c1c4449b88ad` |
| native-build.log | `85e814cd38cb3565c9d271bac8c1c40169004359cc687f736dfa8fec994693b8` |
| native-typecheck.log | `236189c12f0a4a176be02a7e6dae4a48b84cf0bc7b101374891c5d1457577ede` |
| native-audit.json | `83caee5c10ebcd17b4f03033e931c580647bb06d817417bd39e2460292c2deea` |
| native-staging-guard.log | `1963f73416d4c2e15abe5163272031d38e7931f43ad94c75fdd940050a7b4dac` |
| native-port-smoke.log | `8adf7a42bfd07ad9dedc657ca3eaa781716e4fbf899a51702b502e8cde436e33` |

La prueba de concurrencia observa `pg_blocking_pids` y `wait_event_type=Lock`
entre backends distintos. Los escenarios prueban idempotencia, ownership/RLS,
sesiones sintéticas, reserva única, revocación/caducidad, modificación a REAL,
reconexión/confirmación perdida, P2 del journal y rollback transaccional.
No hay salto automático Director → Investigador. Dispatch conserva CLAIMED.
Los eventos de prueba son MOCK/UNVERIFIED; ningún avatar recibe estos fixtures.

## Auditoría de seguridad

Revisión manual del diff y límites: los módulos no conectan al importarse;
el comando nativo requiere opt-in y destino fijo; no hay URL/host configurable,
API Auth, cliente remoto, proveedor ni ciclo de vida Docker. Se excluyen Env,
SQL/argumentos completos y tokens de lease del error registrado. El puerto no
repite una consulta al fallar; un comando posterior puede reconectar. Las sesiones
se cierran al terminar cada prueba. Las pruebas puras de guards no invocan Docker.

El escáner general conserva un falso positivo preexistente en
`dist/assets/index-CwjaT4br.js:17`: el literal SDK `access_token:"access_token"`.
No se añadió allowlist ni se ocultó su exit 1. Auditoría npm y revisión de secretos
del contenido staged se reportan por separado; no se afirma un escaneo remoto
formal de Codex Security ni se ejecutó uno contra proveedores.

## Límites y bloqueos

- Auth/JWT, revocación alojada, PostgREST, Storage API y Edge no están validados.
  auth.uid/auth.jwt/auth.sessions son estructuras sintéticas locales.
- La recuperación usa nuevos repositorios/procesos/conexiones, no reinicio del
  servidor ni contenedor. tmpfs no sustituye un respaldo durable alojado.
- El administrador local puede desactivar triggers para inyección controlada;
  los roles de ejecución no pueden. La amenaza no incluye un Docker admin hostil.
- La referencia PG17 es específica del catálogo/colación del laboratorio.
  Cambios legítimos requieren revisión, no actualización automática del pin.
- B2 sigue bloqueado: manifiesto habilitante, referencia alojada PG17, versión CLI,
  autorización humana y pruebas Auth alojadas pendientes. No se declara B2 completa.
- Guardian, el observador histórico, OpenGym y las diez eliminaciones JPEG de
  otros checkouts no forman parte del diff. El laboratorio se conserva para revisión.

Reversión y recuperación sin DROP automático: ver el runbook enlazado arriba.
