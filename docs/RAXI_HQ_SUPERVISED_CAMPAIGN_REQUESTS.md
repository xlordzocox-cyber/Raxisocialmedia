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

La suite usa PostgreSQL aislado mediante PGlite y datos sintéticos. Las pruebas del puente cubren límite de entrada y campos inyectados, identidad y workspace ajenos, revocación antes del commit, Strategy incompatible o sustituida, evidencia editorial alterada, conflicto de versión y CAS, duplicados concurrentes, pérdida de respuesta, conciliación tras recrear el handler y digest incompatible. También comprueban auditoría inmutable, aislamiento por roles y cero tareas, eventos de agentes, activos, trabajos de producción y planes de publicación. El caso de concurrencia solapa dos primeras solicitudes antes del commit, con una conexión SQL serializada. La prueba PGlite no probaba ni contención entre conexiones físicas ni recuperación después de detener el contenedor. Las pruebas nativas posteriores se registran en la actualización del 2026-11-09.

QA en Chrome con `npm run dev -- --host 127.0.0.1 --port 5182 --strictPort` y `/tests/manual/supervisedCampaignRequests.html`. Se observó el entregable sintético elegible con Strategy aprobada y el motivo de bloqueo con Strategy en revisión. El panel mantuvo el requisito de autorización humana separada y carece de acción de envío. El fixture solo monta el Workspace y usa repositorios locales.

## Antes de habilitar la ruta

Revisar la propuesta y el plan de reversión antes de cualquier aplicación remota. Validar roles y RLS en PostgreSQL 17 aislado, contención física y sesiones reales de ensayo. Verificar la identidad del proyecto de destino y bloquear producción antes de configurar el host. Definir rate limiting, timeouts y política de retención de recibos. Antes de una integración visual, añadir confirmación explícita y estado de operación ligado a cuenta, workspace y sesión. Retirar respuestas de generaciones anteriores al desmontar o cerrar sesión y conservar la clave del comando incierto para conciliar al volver con la misma cuenta. La UI futura debe mostrar `UNKNOWN` hasta confirmar y no crear otra clave automáticamente.

La futura autorización de ejecución debe referenciar la solicitud persistida y una revisión aún vigente, especificar proveedor, modelo, tope, expiración y revocación. Aria Studio permanece como proveedor visual canónico. La entrega del Director no inicia ni autoriza al Investigador.

La reversión de este PR es de código. Para una aplicación futura, retirar primero el acceso a la ruta y a las RPC, preservar los recibos históricos y mantener su protección contra alteración. Cualquier retirada posterior de objetos requiere revisión y autorización.

## Auditoría PR #59: plan original del ensayo nativo (histórico)

Revisión de referencia: [auditoría de fa7363e](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6729762385). El laboratorio anterior estaba detenido y conectado a una red interna, distinta del requisito actual de ausencia de red. La consulta al daemon local no encontró contenedores activos. Esa era la situación **al redactar originalmente esta sección**. El ensayo nativo se ejecutó después; sus resultados y límites se documentan en la actualización del 2026-11-09 al final del documento. Los resultados PGlite por sí solos no acreditaban contención física ni Auth alojado.

| Dependencia revisada | Evidencia y límite |
| --- | --- |
| Tabla de auditoría | `action` es texto con longitud 2–160. `actor_user_id` referencia `auth.users`, `resource_id` es texto y `details` exige un objeto JSONB. Las columnas y el valor de acción pasaron inserción en PGlite. |
| Campaign y Strategy | La migración de Campaign/Strategy aporta `campaign_version`, el snapshot, las transiciones, los recibos y la aprobación editorial inmutable por revisión. El lock de workspace ya serializa las escrituras de campaña e idea. |
| Identidad B1 | Requiere propuestas runtime → A → B, `auth.sessions(id,user_id,not_after)`, `auth.users(id,is_anonymous)` y grants de columna. El ensayo nativo instala las siete fuentes verificadas del manifiesto, incluido B completo, y agrega la migración independiente de Campaign/Strategy solo al laboratorio. La suite PGlite ejercita solo la función de identidad extraída sobre Auth sintético. |
| RPC e integridad | En PostgreSQL 17 están disponibles PL/pgSQL, JSONB, `gen_random_uuid()`, los índices parciales y los triggers empleados. La revisión estática no encontró una incompatibilidad de sintaxis o tipos en la propuesta. La comprobación nativa posterior de sintaxis, roles, RLS y grants se registra en la actualización del 2026-11-09. [Funciones de PostgreSQL 17](https://www.postgresql.org/docs/17/sql-createfunction.html). |
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

**Gate de esta revisión histórica: NO-GO para integrar o desplegar.** Los ensayos nativos locales se completaron posteriormente y se detallan abajo; el gate para entorno alojado sigue separado. En el árbol correctivo, la suite completa pasó 900/900 y la focalizada 3/3 (incluidas en el total). La regresión falló contra el SQL de fa7363e al aceptar evidencia no correlacionada. Typecheck, build, guard offline de siete fuentes, sintaxis del runner, rechazo de autorización ausente y diff --check pasaron. npm audit informó cero vulnerabilidades.


## Actualización de evidencia y gates — 2026-11-09

**Estado verificado en GitHub antes de esta actualización:** PR #59 abierto y DRAFT; HEAD de los ensayos locales \`85685ea581b63501ad18596e3e8746513f616616\`. Los resultados siguientes provienen de salidas completas facilitadas por el operador y de comentarios publicados en el PR, **no** de un despliegue alojado ni de una revisión independiente. Esas pruebas no implican aprobación de merge, de SQL remoto, de ejecución de agentes ni de gasto.

| Ensayo en PostgreSQL 17.11 | Evidencia / alcance demostrado |
| --- | --- |
| Concurrencia física, misma clave | Dos PID distintos 287/309, B bloqueada por A; mismo \`requestId\` \`ef6a0f1c-a8b1-4b01-8aac-326f6c31bfca\`, exactamente 1 recibo persistido; salida 0. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6743355438). |
| Rollback, replay, claves en conflicto | Rollback con 0 filas; luego recibo \`206d66bd-9470-4517-8724-6f95fe1337f2\`, mismo tras nueva conexión; conflicto de claves, 1 fila y 0 efectos; salida 0. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6744701566). |
| Revocación sintética durante bloqueo | PID 640/661, B bloqueada; revocación de la fila \`auth.sessions\`; B rechazada con \`42501\`, 0 filas, 0 efectos; sesión sintética restaurada. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6744825905). |
| ACL y RLS del catálogo | 13 comprobaciones Docker PASS; \`raxi_audit_events\` RLS habilitado; \`anon\` / \`authenticated\` sin EXECUTE, \`service_role\` con EXECUTE y sin TRUNCATE. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6745021366). |
| Lectura RLS efectiva | Con \`SET LOCAL ROLE authenticated\` y claims sintéticos, dueño ve 3 recibos; usuario ajeno ve 0. Solo lectura. **No** valida firma JWT real. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6745563888). |
| Expiración durante bloqueo | PID 1012/1033; lease sintético de 6 s vence esperando A; SQLSTATE \`42501\`, 0 filas/efectos; salida 0. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6746460598). |
| Lock timeout físico | PID 1505/1520, \`lock_timeout\` de 6 s, denegación \`55P03\`, 0 filas/efectos; tres recibos preservados. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6749262692). |
| Negativas RPC e inmutabilidad | \`anon\`/\`authenticated\` sin RPC (\`42501\`), UPDATE/DELETE rechazados (\`23514\`), TRUNCATE rechazado (\`42501\`); huella de 3 recibos idéntica. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6749437164). |
| Recuperación con volumen nombrado | Laboratorio **separado**, PostgreSQL 17.11, sin red ni puertos, volumen administrado por Docker; tras stop/start ordenado y replay, mismo \`requestId\` \`ad6d298a-5cba-46d4-bd9e-daa1123b4832\`, 1 fila, SHA-256 \`4a22ab60d8af06771e0c893f937ee2fe06ba6b38e88126705621ba7df603241d\`; salida 0. [Registro](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/59#issuecomment-6752020371). |

Los laboratorios permanecen preservados. El primero usa \`tmpfs\` y **no debe reiniciarse para probar durabilidad**. La recuperación controlada en el segundo volumen **no** acredita crash recovery, apagón, backup/restore, ni garantías de Supabase alojado. Ninguna de estas pruebas justifica invocar proveedores o gastar créditos.

### Presupuesto operativo y retención: propuesta, NO implementada

**Hechos del código:** el cuerpo HTTP entrante tiene límite de 4096 bytes; \`preflight\`/ \`submit\` siguen sin ruta montada. PostgreSQL guarda el recibo y cuatro piezas de evidencia en \`raxi_audit_events\`; las pruebas deliberadamente crean evidencia de más de 65 536 bytes. La RPC actual no define un límite explícito de tamaño para la evidencia persistida. Los recibos supervisados rechazan UPDATE/DELETE por trigger y TRUNCATE para \`service_role\`; esto exige una política de crecimiento y conservación, no una limpieza automática.

**Propuesta inicial para staging, sujeta a medición y autorización antes de implementar:**

| Control | Dirección propuesta | Criterio de aceptación / bloqueo |
| --- | --- | --- |
| Tamaño del recibo | Evaluar primero distribución realista de \`octet_length(details::text)\` con fixtures aprobados y determinar un tope de bytes finito en servidor **y SQL**, incluyendo \`p_evidence\`. **Candidato exploratorio:** 256 KiB por recibo, no aprobado y no activado. | Exceder el límite debe devolver error controlado y **no** insertar fila; cubrir casos por arriba y por debajo del límite en PG17 nativo. No adoptar 256 KiB si los casos legítimos lo exceden. |
| Frecuencia | Rate limiting por cuenta, workspace, ruta y método, con protección de replay y mensajes de \`UNKNOWN\` que no generen automáticamente nuevas claves. **Candidato exploratorio:** hasta 30 preflights/min y 3 submits/min por workspace; sin despliegue hasta validar carga/UX y costos. | Una solicitud rechazada por límite no crea recibo; reintento con misma \`requestKey\` conserva semántica idempotente; las solicitudes en curso y la cola de errores son observables. |
| Cantidad y capacidad | Cuota operativa de recibos y bytes por workspace; monitoreo de incremento diario, tamaño de \`raxi_audit_events\` e índices, errores \`23505\`, \`42501\`, \`55P03\`, \`UNKNOWN\` y duplicados. | Umbrales y alarmas definidos con cifras de staging verificadas; no afirmar capacidad o costo sin medición de la base alojada. |
| Retención/archivo | **No borrar ni truncar recibos históricos** bajo el PR #59. Diseñar retención y archivo que preserve cadena de evidencia, identidad, fechas, auditabilidad, protección contra modificación y posibilidad de recuperar por clave. | Política y restauración probadas antes de habilitar cualquier caducidad o limpieza. Backup y procedimiento de restauración sujetos a revisión separada; sin SQL automático de purga. |
| Timeouts y concurrencia | Definir \`lock_timeout\`, \`statement_timeout\` y límites de solicitudes del host según mediciones reales; distinguir timeout sin commit de respuesta \`UNKNOWN\` con commit confirmado. | Reintento con misma clave y recuperación del recibo; jamás crear nueva clave sin conciliación previa. |
| Controles de gasto | \`REQUESTED\` significa \`PENDING_HUMAN_EXECUTION_AUTH\`: no autoriza presupuesto, proveedor, modelos, creación de assets, tareas de agentes ni publicaciones. | Autorización separada para cualquier ejecución futura, con proveedor/modelo/tope/expiración/revocación. |

**Seguridad de la frontera:** \`service_role\` es una credencial privilegiada; \`p_evidence\` es confiable solo después de verificación editorial por el host y correlación relacional por la RPC. El reviewer debe desafiar cambios de snapshot entre preflight/submit, recibos de otra revisión/actor/workspace, evidencia alternativa de auditoría, clases de datos de tamaño extremo, grants de escritura directa al ledger, disponibilidad del JWT real y revocación entre llamadas. El host no puede usar esta propuesta como aprobación de ejecución del Director.

### Incremento local de seguridad en PR #59 — guard de tamaño, QA pendiente

**Estado: implementado en el borrador, NO validado ni aplicado remotamente.** Después de la matriz nativa anterior se incorporaron controles de bytes en dos fronteras:

- `supervisedCampaignRequests.ts`: la evidencia editorial generada por el host debe ocupar **como máximo 240 KiB en UTF-8 JSON compacto** para que `preflight` responda `ELIGIBLE`. Si excede ese presupuesto, responde `422 INELIGIBLE / EVIDENCE_TOO_LARGE`. Esto ocurre **después del replay**; recuperar recibos anteriores no requiere una reevaluación editorial. Se agregaron pruebas unitarias de fronteras ASCII/UTF-8.
- `supervised_campaign_requests.sql`: antes de una **nueva inserción**, la RPC rechaza `p_evidence` mayor a **256 KiB** y rechaza cualquier `details` completo de recibo mayor a **256 KiB**, con SQLSTATE `22023`. El tamaño se mide con `octet_length(...::text)` (representación textual de JSONB). No cambia los recibos anteriores ni su replay. Se agregó caso negativo de entrada mayor al límite y aserciones del tamaño persistido.

**La diferencia entre 240 KiB y 256 KiB es intencional:** reserva margen para representación JSONB y metadatos. No constituye una equivalencia exacta para casos extremos; prevalece el límite de la RPC. Estas cifras son **valores provisionales sujetos a medición y aceptación del operador**, no política de producción aprobada. La evidencia actual de tests con más de 64 KiB debe seguir siendo válida; si resulta mayor al límite se debe revisar el presupuesto y no relajar silenciosamente el control.

**No declarar PASS de este incremento** hasta ejecutar suite focalizada/completa, typecheck, build, diff check, audit y pruebas PG17 **en laboratorio sintético nuevo/autorizado**. No reejecutar `prepare` en los contenedores existentes ya poblados, no reiniciar el laboratorio original en tmpfs. Todo SHA posterior requiere nueva revisión de Codex y evidencia específica.

**Continúa NO IMPLEMENTADO:** rate limiting distribuido por identidad/workspace/ruta, cuotas y monitorización de crecimiento del ledger, política formal de retención/archivo y endpoint alojado. No montar el endpoint antes de diseñar y probar esos controles; no presentar los candidatos de frecuencia anteriores como activos.

### Incremento local de rate limiting distribuido — propuesta implementada, QA pendiente

**Estado de este incremento: CÓDIGO PROPUESTO / NO VALIDADO, sin endpoint montado ni SQL remoto.** Los límites provisionales anteriores se trasladaron a la propuesta SQL para experimentar con datos sintéticos; **no** constituyen una política de staging/producción aprobada.

El nuevo contrato `public.raxi_supervised_request_rate_admit(p_identity jsonb,p_operation text)` comprueba `service_role`, sesión viva y propiedad de workspace mediante `raxi_supervised_host_identity` antes y **después** del contador. Usa la hora exclusiva del servidor PostgreSQL (no del navegador), ventanas fijas UTC por minuto y un UPSERT atómico `INSERT ... ON CONFLICT DO UPDATE ... WHERE`, respaldado por una llave primaria `(workspace_id, actor_user_id, operation)`. El contador se actualiza solo si todavía tiene presupuesto o cambia la ventana. Una denegación no incrementa el contador. Las fallas de identidad revierten la transacción. El SQL no acepta límites ni relojes aportados por el cliente.

| Operación | Cuota provisional / ventana de 60 s | Momento y alcance |
| --- | --- | --- |
| `PREFLIGHT` | 30 | Después de autenticar sesión/actor/workspace y **antes** del snapshot editorial. |
| `REPLAY` | 60 | En todo `submit`, antes de buscar recibo existente; protege consultas repetidas con una misma clave. |
| `SUBMIT` | 3 | Solo tras `REPLAY` sin recibo previo, antes del snapshot/commit de una solicitud potencialmente nueva. |

La respuesta del RPC es `ALLOWED` o `RATE_LIMITED` con `retryAfterSeconds` acotado al próximo inicio de ventana. El host valida forma, operación y campos del resultado: `RATE_LIMITED` se transforma en HTTP 429 con `Retry-After`; error, caída de base o respuesta malformada producen 503/`UNKNOWN`. **No** cambia las `requestKey` originales. Un recibo confirmado se recupera sin consumir `SUBMIT`; si el presupuesto de `REPLAY` se agotó, deberá reintentarse con la **misma** clave después de la ventana, sin generar otra.

**Límites conscientes:** es una ventana fija, no deslizante; podrían admitirse ráfagas cercanas a dos ventanas consecutivas. La cuota es **por pareja actor+workspace**, no una cuota global por cuenta ni por IP. La API aún **no está montada**, por lo que tampoco hay limitación de intentos con token inválido antes del autenticador: el futuro perímetro/ingress debe limitar esos intentos sin registrar tokens. Un cliente con `service_role` es parte de la base de confianza y podría invocar directamente el commit sin pasar por este puerto; el host real solo deberá montar el flujo que exige admisión. No almacenar tokens, `requestKey` ni cuerpo del comando en la tabla de contadores.

La tabla `raxi_supervised_request_rate_counters` tiene **una fila por combinación** de actor/workspace/operación, no una fila por minuto; cambia `window_start` y `request_count` en lugar de acumular ventanas históricas. Mantiene RLS habilitado, `anon`/`authenticated` sin grants, `service_role` con SELECT/INSERT/UPDATE y sin DELETE/TRUNCATE directo. Un eventual borrado de workspace puede quitar contadores operativos vía FK; **esto no toca ni purga recibos de auditoría**. Tamaño global crece con el número de pares autenticados, así que los límites de workspace y monitorización siguen pendientes.

**Evidencia todavía requerida para el nuevo SHA:** suite focalizada/completa, typecheck, build, fuentes y diff; PG17.11 **nuevo** para pruebas de concurrencia de dos conexiones con 3 envíos y un cuarto 429, cuotas por operación/actor/workspace, rollover de ventana, negativa de roles y no crear recibos/efectos al rechazar. No reutilizar/repreparar los tres laboratorios existentes. La auditoría especializada de seguridad y pruebas de Supabase Auth firmado/ingress alojado siguen pendientes. En particular, las nuevas respuestas 429 deben ser documentadas y probadas en el futuro cliente para conciliar `UNKNOWN` con la misma clave.

### Bloqueantes antes de declarar listo para merge o staging alojado

1. **Revisión independiente registrada** del HEAD exacto y sus diffs, de servidor + SQL + contratos, sin convertir comentarios del autor en aprobación externa.
2. **Política operativa aprobada** de límites de bytes, rate limiting, observabilidad, timeouts y retención; aplicar código/SQL y pruebas negativas con nuevo SHA, o conservar NO-GO.
3. **Validación Auth alojada de staging, bajo autorización separada:** proyecto correcto, issuer/audience/JWT firmado, sesión viva, logout/revocación, usuario ajeno, respuestas obsoletas, e infraestructura de ruta controlada. Probar el rollback remoto aprobado; **no** desplegar con este documento.
4. **Actualizar evidencia de QA al HEAD final** después de cualquier corrección. No dar por vigente automáticamente 900/900 sobre commits posteriores.
5. **Mantener bloqueada la ejecución real:** no agregar endpoint operativo, autorización del Director ni Aria Studio con capacidad de gasto sin la aprobación humana específica.

**Gate al 2026-11-09: PG17 local (casos descritos) PASS; PR #59 DRAFT y NO-GO para merge/despliegue.**
