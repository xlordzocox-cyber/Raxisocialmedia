# Solicitudes supervisadas desde Campaign Workspace REAL

Issue #58. Base de trabajo `af4187a81c79a4c44334243b893c2f44c5bcfe0a` (PR #57).

## Inventario y alcance

| Pieza | Estado de este incremento |
| --- | --- |
| `CampaignSnapshot` | El contrato canónico procede de `raxi_campaign_snapshot`. El parser comprueba propietario, workspace, procedencia REAL, ideas, revisiones y recibos. La versión y la historia editorial provienen del commit de campañas. |
| Elegibilidad editorial | Campaign Workspace ya muestra el resultado de `evaluateCampaign`. El servidor reutiliza el mismo criterio, incluida la concordancia entre recibo editorial, evento de auditoría y revisión APPROVED vigente. DEMO queda fuera. |
| Identidad | El puerto reutiliza el adaptador B1 de Supabase Auth, con clientes de usuario y servidor separados. La propuesta depende de `raxi_supervised_host_identity` para comprobar `auth.sessions` y propiedad. La integración ejecutada aquí usa cuentas sintéticas. |
| Persistencia de solicitudes | Dos RPC propuestas sobre `raxi_audit_events`, sin segundo ledger. La migración de campañas y Strategy y el RPC de identidad B1 son dependencias. La propuesta queda fuera de `supabase/migrations` y del manifiesto de staging. |
| Runtime Director → Investigador | `raxi_runtime_request` admite trabajo real o simulado con la política, aprobación, reserva y auditoría del runtime. Sus tareas, ejecuciones, leases y recibos quedan fuera del puente. La admisión futura deberá reutilizar estos controles y vincular una autorización propia a cada etapa. |
| Despliegue | Este PR no añade Edge Function, ruta pública ni botón de envío. El estado de staging descrito en el issue es una referencia previa. Las comprobaciones de este PR son locales. |

## Contrato

`preflight` y `submit` son handlers de servidor sin ruta asignada. Aceptan JSON UTF-8 de hasta 4096 bytes y un bearer explícito. El único propósito admitido es `PREPARE_VISUAL_BRIEF` para una foto pública de Instagram Feed. El comando cerrado contiene `workspaceId`, `campaignId`, `strategyRevision`, `deliverableId`, `expectedCampaignVersion`, `requestKey` y `purpose`. `submit` añade `snapshotHash` devuelto por preflight.

- `ELIGIBLE` confirma alcance editorial y devuelve una huella SHA-256 de la evidencia canónica y el borrador. El preflight solo lee. La clave forma parte del borrador y debe fijarse antes de la consulta.
- `INELIGIBLE` bloquea comandos inválidos, identidad no confirmada y requisitos editoriales incumplidos. `STALE` exige volver a leer una versión vigente. `UNKNOWN` cubre dependencias indisponibles, datos canónicos inválidos y confirmaciones que no se pudieron verificar.
- `REQUESTED` con `PENDING_HUMAN_EXECUTION_AUTH` solo se devuelve después de confirmar el recibo de la RPC, su actor, el comando exacto y la huella recalculada. `CONFLICT` cubre reutilización de clave con otro cuerpo o intento con otra clave para el mismo workspace, campaña, revisión, entregable y propósito.
- Si se pierde una respuesta, reenviar el mismo cuerpo y clave. El servidor recupera el recibo histórico incluso si la revisión fue sustituida. Ese recibo conserva su fecha y alcance y no concede elegibilidad actual. Una revisión nueva aprobada admite su propia solicitud.

El hash usa JSON con claves ordenadas y arrays en su orden original. La fila guarda las cuatro piezas exactas de evidencia canónica (campaña, Strategy, recibo y evento editorial). Así la huella sigue siendo verificable tras modificar el workspace. PostgreSQL reconstruye la evidencia exacta desde la revisión vigente, su entregable, la decisión humana y el evento del mismo commit editorial. El tamaño de la evidencia está acotado por los contratos editoriales y por el conjunto cerrado de objetos admitidos. No se envía la evidencia en la respuesta HTTP.

## Frontera de seguridad

Las RPC son `SECURITY INVOKER` con `search_path` vacío y ejecución exclusiva de `service_role`. La política existente de lectura de auditoría sigue limitada al propietario. No se amplían grants del navegador. El servidor privilegiado es parte de la base de confianza y debe proporcionar el resultado validado y la evidencia exacta. El SQL añade comprobaciones de sesión, propiedad, correlación de evidencia, versión y CAS. La validación editorial completa del brief y la matriz permanece en el evaluador existente.

El commit usa el mismo bloqueo de fila del workspace que los commits de campaña y de idea REAL. Vuelve a comprobar sesión y replay tras esperar por el bloqueo, compara el snapshot completo salvo `serverTime` e inserta una fila con identidad y hora de servidor. Dos índices únicos protegen la clave y el alcance editorial. El trigger rechaza UPDATE/DELETE de esos recibos y la conversión por UPDATE de otro evento a ese tipo. El rol propietario de la base sigue siendo privilegiado. La fila no cambia la versión de campaña ni crea tareas, aprobaciones de ejecución, reservas, activos ni publicaciones.

El mecanismo de revocación verifica existencia y vigencia de sesión junto con el JWT. No acredita cancelación retroactiva de una transacción ya confirmada ni todas las políticas de refresco del proveedor. Antes de habilitar el endpoint se debe probar revocación con Auth alojado y JWT aún vigente. [Sesiones de Supabase](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

## Evidencia y reproducción

Desde `apps/raxi-hq`:

```text
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
node scripts/verify-staging-preparation.mjs
npm audit
```

La suite usa PostgreSQL aislado mediante PGlite y datos sintéticos. Las pruebas del puente cubren límite de entrada y campos inyectados, identidad y workspace ajenos, revocación antes del commit, Strategy incompatible o sustituida, evidencia editorial alterada, conflicto de versión y CAS, duplicados concurrentes, pérdida de respuesta, conciliación tras recrear el handler y digest incompatible. También comprueban auditoría inmutable, aislamiento por roles y cero tareas, eventos de agentes, activos, trabajos de producción y planes de publicación. El caso de concurrencia solapa dos primeras solicitudes antes del commit, con una conexión SQL serializada. La contención entre conexiones físicas y la recuperación tras reiniciar el servidor PostgreSQL quedan pendientes.

QA en Chrome con `npm run dev -- --host 127.0.0.1 --port 5182 --strictPort` y `/tests/manual/supervisedCampaignRequests.html`. Se observó el entregable sintético elegible con Strategy aprobada y el motivo de bloqueo con Strategy en revisión. El panel mantuvo el requisito de autorización humana separada y carece de acción de envío. El fixture solo monta el Workspace y usa repositorios locales.

## Antes de habilitar la ruta

Revisar la propuesta y el plan de reversión antes de cualquier aplicación remota. Validar roles y RLS en PostgreSQL 17 aislado, contención física y sesiones reales de ensayo. Verificar la identidad del proyecto de destino y bloquear producción antes de configurar el host. Definir rate limiting, timeouts y política de retención de recibos. Antes de una integración visual, añadir confirmación explícita y estado de operación ligado a cuenta, workspace y sesión. Retirar respuestas de generaciones anteriores al desmontar o cerrar sesión y conservar la clave del comando incierto para conciliar al volver con la misma cuenta. La UI futura debe mostrar `UNKNOWN` hasta confirmar y no crear otra clave automáticamente.

La futura autorización de ejecución debe referenciar la solicitud persistida y una revisión aún vigente, especificar proveedor, modelo, tope, expiración y revocación. Aria Studio permanece como proveedor visual canónico. La entrega del Director no inicia ni autoriza al Investigador.

La reversión de este PR es de código. Para una aplicación futura, retirar primero el acceso a la ruta y a las RPC, preservar los recibos históricos y mantener su protección contra alteración. Cualquier retirada posterior de objetos requiere revisión y autorización.

## Auditoría PR #59 y ensayo nativo pendiente

Revisión de referencia: [auditoría de fa7363e](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6729762385). El laboratorio anterior estaba detenido y conectado a una red interna, distinta del requisito actual de ausencia de red. La consulta al daemon local no encontró contenedores activos. El ensayo nativo queda **PREPARADO / NO EJECUTADO**. Los resultados PGlite no acreditan contención física ni Auth alojado.

| Dependencia revisada | Evidencia y límite |
| --- | --- |
| Tabla de auditoría | `action` es texto con longitud 2–160. `actor_user_id` referencia `auth.users`, `resource_id` es texto y `details` exige un objeto JSONB. Las columnas y el valor de acción pasaron inserción en PGlite. |
| Campaign y Strategy | La migración de Campaign/Strategy aporta `campaign_version`, el snapshot, las transiciones, los recibos y la aprobación editorial inmutable por revisión. El lock de workspace ya serializa las escrituras de campaña e idea. |
| Identidad B1 | Requiere propuestas runtime → A → B, `auth.sessions(id,user_id,not_after)`, `auth.users(id,is_anonymous)` y grants de columna. El ensayo nativo instala las siete fuentes verificadas del manifiesto, incluido B completo, y agrega la migración independiente de Campaign/Strategy solo al laboratorio. La suite PGlite ejercita solo la función de identidad extraída sobre Auth sintético. |
| RPC e integridad | En PostgreSQL 17 están disponibles PL/pgSQL, JSONB, `gen_random_uuid()`, los índices parciales y los triggers empleados. La revisión estática no encontró una incompatibilidad de sintaxis o tipos en la propuesta. Falta comprobar ejecución con el catálogo nativo y sus grants efectivos. [Funciones de PostgreSQL 17](https://www.postgresql.org/docs/17/sql-createfunction.html). |
| Bloqueo y revocación | La RPC de replay exige `READ COMMITTED`. El commit vuelve a verificar sesión después de esperar y antes de devolver el recibo. Un snapshot de transacción fijo podría ocultar una baja posterior de sesión. Una revocación posterior a la última comprobación no cancela retroactivamente el commit. [Aislamiento en PostgreSQL 17](https://www.postgresql.org/docs/17/transaction-iso.html). |

Se confirmaron y corrigieron dos P2. El primero permitía presentar piezas de `p_evidence` que existían de forma independiente, o una revisión sustituida. El SQL ahora vincula la revisión vigente, el entregable permitido, la aprobación relacional del propietario y **la misma fila de auditoría del comando editorial**. Exige un único resultado y evidencia exacta. El segundo permitía que `service_role` con grant de tabla omitiera el trigger por fila mediante `TRUNCATE`. La propuesta revoca ese permiso. La aplicación valida la huella antes de escribir y al devolver el recibo. Un rol que pueda escribir directamente el audit o cambiar DDL permanece dentro de la frontera de confianza. Antes de desplegar hay que verificar que esos permisos queden limitados al host y establecer retención, monitoreo de crecimiento y timeouts.

### Procedimiento reproducible en un laboratorio nuevo y autorizado

Usar un contenedor desechable **ya encendido**, aprobado por ID completo, con la imagen fijada por el script, Docker local, `--network none`, sin puertos, sin privilegios ni volúmenes de host, datos en tmpfs y base vacía `raxi_validation` con usuario sintético `raxi_local`. No iniciar ni reconfigurar el laboratorio anterior. El script verifica las siete huellas del manifiesto y la huella fijada de la migración independiente de Campaign/Strategy, la identidad del contenedor, PG 17.11 y el socket local. Instala bootstrap, fuentes revisadas, propuesta y fixture en una transacción. No aplica B2, ni genera usuarios alojados. Un fallo de preparación exige inspección del operador antes de repetir.

Desde `apps/raxi-hq`, tras identificar y autorizar el contenedor vacío:

```powershell
node scripts/pr59-native-pg17.mjs --check-inputs
node scripts/pr59-native-pg17.mjs --authorized-local-pr59 <ID-completo> prepare
node scripts/pr59-native-pg17.mjs --authorized-local-pr59 <ID-completo> session
```

Abrir A, B y C con `session` en consolas independientes. Registrar el PID y la versión que imprime el script. En A y B, ejecutar `set role service_role;` y darles nombres con `set application_name='pr59_a';` o `'pr59_b'`. C conserva el rol local de fixture para observar bloqueos y manipular **solo** la sesión sintética. En A y B fijar `set lock_timeout='60s'; set statement_timeout='75s';`. En las instrucciones siguientes, las claves `K1` a `K5` son UUID distintos generados por el operador. Reutilizar cada clave literalmente en su caso. `request(n,key,seconds)` devuelve el recibo y el estado, con validez sintética de 60 segundos por defecto.

| Caso | Operaciones y observación requerida |
| --- | --- |
| Primera escritura simultánea y replay | A ejecuta `begin; select raxi_pr59_fixture.request(1,'K1',300);` y conserva el recibo sin confirmar. B ejecuta el mismo SELECT. En C, consultar `select pid,pg_blocking_pids(pid) from pg_stat_activity where application_name='pr59_b';` y confirmar que bloquea el PID de A. A hace `commit;`. B debe devolver el mismo recibo completo. C comprueba exactamente una fila con `details->'command'->>'deliverableId'='STRATEGY-ITEM-001'` y acción `SUPERVISED_CAMPAIGN_REQUESTED`. |
| Dos claves para el mismo alcance | Repetir con item 2. A usa K2 y B usa K3. Tras comprobar el bloqueo y confirmar A, B devuelve `CONFLICT` y queda una fila para el item. La misma clave K2 con item 3 también devuelve `CONFLICT`. |
| Rollback y reconexión | A ejecuta `begin; select raxi_pr59_fixture.request(3,'K4',300); rollback;`. C confirma cero filas del item 3. B confirma la operación con K4 en autocommit. Cierra B sin usar su respuesta, abre una sesión nueva y reenvía K4. Debe obtener el recibo comprometido que C observó y una sola fila. |
| Revocación y expiración durante el lock | A toma solo el lock con `begin; select id from public.raxi_workspaces where slug='pr59-lab' for update;`. B inicia `select raxi_pr59_fixture.request(4,'K5',300);`. Una vez observado el bloqueo en C, C elimina la sesión sintética con `delete from auth.sessions where id='59000000-0000-4000-8000-000000000003';`. Tras `commit` de A, B debe fallar con SQLSTATE `42501` y quedar cero filas del item 4. Reponer la sesión sintética en C con el mismo ID y `user_id='59000000-0000-4000-8000-000000000002'`. Repetir con una validez corta que expire **después** de observar el bloqueo y antes de liberar A. Para comprobar también un timeout, mantener A bloqueado y fijar `lock_timeout` menor en B, esperar SQLSTATE `55P03`, liberar A y comprobar cero filas antes de reenviar la clave. |
| ACL y ausencia de efectos | El fixture falla antes de crear datos si no encuentra RLS, las RPC o los grants esperados. En sesión nueva, `set role authenticated;` con claims sintéticos del propietario debe leer solo sus recibos, con claims ajenos debe leer cero, y ejecutar las RPC debe fallar con `42501`. Como `service_role`, UPDATE/DELETE de recibos deben fallar con `23514` y TRUNCATE con `42501`. Contar cero tareas, eventos de agente, activos, jobs de producción y planes de publicación. |

Usar `\set VERBOSITY verbose` al verificar SQLSTATE. Cada error esperado cierra la sesión por `ON_ERROR_STOP`; abrir una nueva con la misma guardia. Abortar ante un PID compartido, falta de espera observada, resultado incierto o una fila adicional. Ante error, cerrar las consolas y conservar el laboratorio aislado para inspección. No limpiar tablas ni remover contenedores desde el runner. El rollback de la prueba de datos ocurre dentro de la transacción. La eliminación posterior del laboratorio corresponde al operador.

**Gate actual: NO-GO para integrar o desplegar.** Falta ejecutar el ensayo con conexiones físicas y validar la composición de identidad y permisos en el entorno que se autorice posteriormente. En el árbol correctivo, la suite completa pasó 900/900 y la focalizada 3/3 (incluidas en el total). La regresión falló contra el SQL de fa7363e al aceptar evidencia no correlacionada. Typecheck, build, guard offline de siete fuentes, sintaxis del runner, rechazo de autorización ausente y diff --check pasaron. npm audit informó cero vulnerabilidades.
