# Raxi HQ · Issue #49 — Preautenticación distribuida del Director (propuesta, no desplegada)

**Estado:** código, SQL candidato y pruebas PostgreSQL 17. **No se ha aplicado el SQL nuevo en Supabase ni se ha publicado una ruta Vercel.** La oficina todavía no ejecuta agentes IA.

## 1. Resolución de la procedencia de la cuota histórica

La cuota `raxi_supervised_request_rate_admit(jsonb,text)` y la tabla `raxi_supervised_request_rate_counters` **sí están instaladas en staging**, pero una revisión anterior del PR #78 solo había buscado las dos migraciones recientes y no las fuentes históricas.

Al examinar **todas** las filas de `supabase_migrations.schema_migrations`, se confirmó que ambas están en la migración **`20261111003603_raxi_hq_pr59_supervised_campaign_requests`**. La única sentencia de esa versión tiene **14,276 bytes** y SHA-256 `a45ea5c6ebbd0fbd06c5889b69d89780c2de6b2a76a198220b0f9aaba481b0d2`. Es idéntica al archivo `supabase/proposals/supervised_campaign_requests.sql` del commit histórico PR #59 `e4d617e85875d99d5c06908dad2ef1a46b02cd5d`.

Se guardó una copia **bit a bit idéntica** bajo `supabase/history/20261111003603_raxi_hq_pr59_supervised_campaign_requests.applied.sql`, fuera de `supabase/migrations/` para que ninguna herramienta la interprete como una nueva operación. El blob Git SHA es `ce3e15caca3614d0881e6371585d65ada4e46044`. El workflow PG17 compara esa copia con el commit histórico fijado, la instala **solo en una base desechable** y verifica la función resultante con el SHA-256 del catálogo de staging `57b94e50e622acb3c6dee7e41707993b1f0d0a2087d358627e2a455d817e67b7`, además de RLS y ACL.

**Resultado de investigación:** no hace falta una migración nueva para «crear» la cuota histórica ya instalada. Su reconstrucción es reproducible desde la fuente histórica recuperada. Para despliegues nuevos, todavía se requiere el proceso de aplicación ordenada de todas las migraciones PR59/Issue60; este documento no autoriza cambiar el ledger hospedado.

## 2. Nuevo control antes del JWT

`supabase/proposals/issue49_director_preauth_gate.candidate.sql` es **candidato** para la siguiente autorización de migración, no una migración registrada ni ejecutada. Crea:

- Tabla efímera `raxi_director_preauth_counters` con RLS; ningún permiso al navegador, y solo `service_role` puede consultar y actualizar a través de la RPC permitida.
- RPC `raxi_director_preauth_admit(text)`, `SECURITY INVOKER`, `search_path=''`, solo `service_role` y `READ COMMITTED`.
- Un candado global **60 solicitudes admitidas/minuto** para el único endpoint del Director, y un máximo por origen confiable pseudonimizado **8/minuto**. El contador global se bloquea antes del contador del cliente. Se calcula el minuto con el reloj PostgreSQL *después* del lock y se conservan los contadores al negar.
- Borrado **acotado** (máximo ocho registros de cliente inactivos por solicitud admitida) tras dos horas de inactividad; ninguna cron ni tarea nocturna. La tabla es de cuotas efímeras, **no** un ledger de aprobaciones.
- No almacena IPs, identificadores en claro, JWT, emails ni secretos. El Node autorizado calcula HMAC-SHA256 estable con clave privada de servidor y `rateKey` generado desde una frontera de red **confiable**. Se rechaza el identificador si procede de `X-Forwarded-For` u otras cabeceras no autenticadas.

`apps/raxi-hq/server/stagingDirectorSqlPreauth.ts` implementa ese puerto HMAC-SHA256; `createUnpublishedDirectorNodeGateWithSqlPreauth` conecta concretamente esa cuota al ingreso existente **antes de validar JWT** y rechaza la inyección de un limitador falso. Los tres clientes Supabase permanecen aislados, sin sesiones persistentes. Ningún código activa proveedores, gastos ni ejecución.

**Riesgo residual:** una cuota PostgreSQL no sustituye un WAF ni mitiga por completo una inundación de solicitudes que ni siquiera llegan a la aplicación. Antes de publicar se debe confirmar el origen exacto del `rateKey` firmado por infraestructura de confianza, protección del edge, límites del proveedor de hosting, presupuesto operativo y la custodia/rotación de la clave HMAC. No guardar la clave en GitHub.

## 3. Controles y evidencias

- `apps/raxi-hq/tests/stagingDirectorSqlPreauth.test.ts`: cliente sintético, hash estable, distintos clientes producen distintos HMAC, errores y cuotas fallan cerrado, cliente servidor no ve IP/JWT, Deny/Outage bloquean antes de validar JWT, configuración no permite inyección de limitador falso.
- `apps/raxi-hq/tests/pg17/issue49_director_preauth_qa.sql`: **SQL real** en PostgreSQL 17 desechable, RLS y privilegios, 8/9 por cliente, 60/61 global sin insertar otra identidad, negativas por formato, caducidad y aislamiento de transacciones.
- `apps/raxi-hq/tests/pg17/issue49_director_preauth_concurrency.sh`: concurrencia física de conexiones independientes: 12 para un cliente (8 admitidas/4 denegadas) y 70 identidades (60 admitidas/10 denegadas). Ninguna conexión con Supabase alojado.
- `apps/raxi-hq/tests/pg17/issue49_rate_historical_parity.sql`: instalación histórica PR59 reproducida y comparada con el catálogo real verificado de staging.
- CI general: TypeScript, todas las pruebas, build, npm audit. El resultado **solo se declara PASS al verificar el run asociado al SHA exacto**.

## 4. Puertas de autorización siguientes

1. Aprobar/merge de código inerte únicamente si CI y Codex final pasan.
2. Pedir autorización **distinta** para migración versionada **solo staging** del NUEVO limitador, preflight, rollback y postflight, sin alterar producción ni el historial antiguo.
3. Confirmar el proveedor de montaje, origen Preview autorizado, **origen confiable del rateKey**, protección WAF, y secretos de Node sin exposición al navegador. Pedir autorización expresa para desplegar.
4. Ejecutar E2E hospedado: JWT vigente, dos sesiones de **una sola cuenta**, revocación de sesión A mientras B permanece activa, cuotas distribuidas, carreras, CORS, caída de base, secretos.
5. Más adelante y con otra autorización: acción humana `prepare/approve/revoke`; política y precio oficial actual del modelo; una única ejecución REAL de texto del Director, con presupuesto limitado, recibo persistente verificable y movimiento Pixi **solo** ante evento verdadero.

**No retirar DEMO/MOCK, no publicar, no activar Investigador automático y mantener Issue #49 abierto.**
