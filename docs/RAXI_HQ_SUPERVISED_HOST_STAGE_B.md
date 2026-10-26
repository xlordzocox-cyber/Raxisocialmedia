# Host supervisado — B1 preparatorio

Base: main `55eecc4ef7a6e6eb748c61ea1c1e2b30c4657247` (PR #19 integrado). Este incremento prepara adaptadores de servidor y SQL revisable, **sin desplegar ni contactar Supabase alojado**. Todos los proveedores ejecutados en pruebas son simulados. No acredita sesiones auténticas, JWT firmados alojados, RLS remoto ni actividad REAL de agentes.

## Arquitectura reutilizada

Se conservan `runOne`, `RuntimeRepository`, las transiciones y reservas de `agent_runtime.sql`, las aprobaciones por tarea de A y el mismo journal de `raxi_agent_events`. No hay otro coordinador, ledger, cola, servidor ni worker. `supabaseSupervisedRepository` utiliza únicamente las RPC `raxi_supervised_host_identity` y `raxi_supervised_host_command`; no usa `rpcRepository` genérico ni `raxi_runtime_request` heredado.

`createSupabaseSupervisedHost` es una biblioteca Request/Response sin listener ni registro en UI. Comparte el parser cerrado, límite de 8192 bytes y contrato de acciones con el host local. Solo registra `simulatedProvider`, exige `liveEnabled:false`, rechaza REAL y conserva investigación externa desactivada. Director e Investigador tienen tareas, claves, aprobaciones y reservas independientes; el Investigador exige resultado confirmado del Director y una autorización nueva. El claim requiere además la clave de ejecución manual.

La identidad y la ejecución son dimensiones diferentes: el futuro host B2 podrá verificar una identidad Supabase auténtica, pero seguirá produciendo `STAGING_SIMULATION_ONLY`, `execution:SIMULATED`, eventos MOCK/UNVERIFIED y ninguna actividad REAL en Pixi. Los fixtures B1 no son usuarios auténticos ni aprobaciones humanas atribuidas a Luis. RuntimeOfficeStore, OfficeScene, AgentMotion y el observador histórico #18 no cambian. Guardian automático sigue inactivo.

## Identidad del servidor y revocación

`supabaseSupervisedAuth` recibe dos clientes separados y confiables del servidor, sin crearlos ni conectarse al importar. El cliente de usuario debe ser el SDK Supabase configurado para el proyecto exacto, sin persistencia, auto-refresh o sesión global; el privilegiado debe usar credenciales exclusivas de staging. Ambas fábricas rechazan ejecución en navegador. Los puertos TypeScript son inyección de infraestructura confiable, **no una prueba criptográfica por sí mismos**.

1. `getClaims(token)` debe verificar firma mediante el SDK, no decodificar un JWT. Se validan issuer exacto `https://<ref>.supabase.co/auth/v1`, audiencia/rol authenticated, usuario no anónimo, sub/session_id UUID, iat/nbf/exp y reloj del proceso. Se rechaza el proyecto de producción conocido. El chequeo del ref es defensa previa, no prueba suficiente de aislamiento.
2. `getUser(token)` consulta Auth; su identidad debe coincidir con los claims y no ser anónima. No se leen permisos de user_metadata, app_metadata, navegador, modelos o fuentes.
3. Una RPC invoker exclusiva del servidor comprueba propietario y consulta **de nuevo** `auth.sessions` por ID/usuario junto con `auth.users.is_anonymous`. Exige fila existente y `not_after` nulo o futuro. No hay caché positiva de sesiones. No se guardan JWT ni claves.
4. El repositorio revalida antes de operaciones nuevas, claim y dispatch. La propuesta SQL repite la comprobación en la admisión final; el binding persistido conserva actor, sesión, proyecto, workspace y caducidad, nunca el token. Cambiar cuenta/sesión no transfiere una tarea pendiente. El vencimiento original permanece conservador aun si luego se refresca el JWT: no se extiende automáticamente la autorización de esa tarea.
5. ACK/finish/unknown de un efecto ya admitido pueden conservar su recibo después de revocación. Siguen exigiendo rol de servidor, binding actor/sesión/workspace, tarea y lease. No conceden un nuevo dispatch ni están expuestos como acciones del navegador. El replay y la conciliación para el operador requieren una sesión vigente.

**Límites:** el JWT por sí solo no demuestra revocación. La lectura de sesión observa el estado de la base en ese instante; no hace atómicos logout, commit y llamada al proveedor. Una revocación posterior a la admisión no cancela retroactivamente una llamada iniciada. `not_after` y existencia de fila no acreditan por sí solos todas las políticas de inactividad, cierre global, usuario bloqueado o limpieza diferida de GoTrue: B2 debe inventariar configuración/versión y probar cada política exigida; configuraciones no cubiertas bloquean la aceptación. La validez de la firma y todas estas garantías siguen **sin probarse alojadas** en B1.

Referencias consultadas el 26-10-2026: [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [sesiones y revocación](https://supabase.com/docs/guides/auth/sessions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [funciones](https://supabase.com/docs/guides/database/functions). El changelog revisado advierte retirada de cifrados TLS antiguos a partir del 10-11-2026; no se deshabilita verificación TLS.

## SQL propuesto y dependencias

No se añaden migraciones aplicables. Orden solo para fixtures locales: cuatro migraciones v0.9 → `agent_runtime.sql` → `supervised_host_stage_a.sql` → `supervised_host_stage_b.sql`. La quinta migración de campañas es independiente, no se aplica ni se recrea.

| Dependencia | Uso / diferencia B |
| --- | --- |
| 20261019030541 private_core | workspaces, tareas, perfiles, eventos, aprobaciones y auditoría con RLS |
| 20261019030659 fk_indexes | índices base, sin cambios |
| 20261019030808 onboarding | permisos base, sin cambios |
| 20261019231655 real_idea_write | funciones existentes, sin cambios ni uso para ensayos de producción |
| agent_runtime.sql | políticas, runs, leases, reservas, versión de política y coordinador SQL; sin duplicación |
| supervised_host_stage_a.sql | se extraen tres seams de identidad/binding; A conserva LOCAL_FIXTURE, nombres de auditoría y formato del journal |
| supervised_host_stage_b.sql | reemplaza esos tres helpers, añade verificación de sesión y un dispatcher RPC cerrado; no crea tablas |

El contexto transaccional `raxi.supervised_identity` solo se establece tras validación en el dispatcher de servidor y es transaction-local; no es una autorización suministrada por el cliente. La propuesta A sola nunca acepta origen alojado. B no convierte fixtures a Auth: su entrypoint exige el binding `SUPABASE_AUTH_STAGING` y su sesión existente, y rechaza tareas de A. Todas las operaciones nuevas usan las funciones A existentes; no se copian sus algoritmos de presupuesto o journal. La clasificación técnica histórica `SUPERVISED_LOCAL_JOURNAL` se mantiene para conservar el formato y trigger existente: la procedencia está en el binding y payload, y la ejecución B sigue siendo simulada.

La operación de paso conserva versión, digest del comando y digest de confirmación completa. El mismo validador P2 se usa antes de devolver confirmación o FOUND. Corrupción devuelve CONFLICT, ausencia MISSING e indisponibilidad lanza operación no confirmada; nunca se convierte en ausencia o autorización para repetir el proveedor. El bloqueo UPDATE/DELETE/reclasificación/TRUNCATE del journal se conserva. No se promete resistencia contra postgres capaz de desactivar triggers y recalcular hashes.

| Rol | Grants / RLS / funciones |
| --- | --- |
| PUBLIC / anon | Sin EXECUTE de RPC supervisadas ni acceso nuevo |
| authenticated | Lecturas base sujetas a RLS por propietario; sin RPC de escritura supervisada ni leases |
| service_role | Servidor confiable; bypass RLS. EXECUTE limitado por allowlist del adaptador; permisos existentes amplios del runtime requieren revisión B2. B añade SELECT solo de columnas id/user_id/not_after de sesiones e id/is_anonymous de usuarios |
| postgres / propietario de esquema | Aprovisionamiento e inyección de fallos de ensayo exclusivamente; nunca identidad del host |

Todas las funciones propuestas son **SECURITY INVOKER**, `search_path=''`, nombres de relaciones cualificados. No se introduce SECURITY DEFINER ni se soluciona un error de permisos abriendo tablas al navegador. Las funciones auxiliares mantienen revocación PUBLIC/anon/authenticated y grants de A; las dos nuevas RPC revocan explícitamente esos roles. La escritura de service_role se protege por controles explícitos, no se presenta como aislamiento RLS del escritor. No se incorporan contraseñas, URLs con credenciales ni conexiones a la propuesta.

## Contratos y pruebas locales

EARS: si falta token o falla firma/issuer/caducidad/sesión/propietario, el host deberá rechazar sin efectos. Cuando se revoque la aprobación antes de admisión, deberá haber cero llamadas. Cuando un comando idéntico se repita, deberá conservar su tarea/reserva/operación; contenido distinto deberá ser conflicto. Si se pierde el cuerpo de un commit, la lectura canónica deberá recuperar el resultado sin repetir efecto. Si se altera el journal, deberá rechazarse antes de confirmación/FOUND. Cuando Director termine, no deberá existir un Investigador automático. Mientras ejecución sea SIMULATED, no deberá proyectarse como actividad REAL.

`supabaseSupervised.test.ts` usa PGlite y dobles de SDK/claims claramente identificados; NO valida firmas JWT auténticas. Ejecuta el SQL completo B y cubre rechazo de identidad/sesión, permisos, propietario, scope, presupuesto, concurrencia local, aprobación independiente, pérdida de confirmación, reapertura en disco, corrupción del journal, fallo de persistencia, revocación antes/después de dispatch y guard B2. Las pruebas previas de A/P2 y oficina permanecen en la suite. El parser y coordinador se reutilizan.

Las primeras pruebas detectaron una mutación administrativa de auth.sessions ejecutada indebidamente con service_role y el guard CLI empaquetado dentro del bundle del test. Se corrigieron los fixtures para usar administrador solo en inyección y mantener el módulo CLI externo, sin relajar permisos del runtime.

## Ejecutor B2 — preparado, NO ejecutado

`scripts/staging-runtime-acceptance.mjs` es inerte al importar. Solo una invocación directa con `--run`, `RAXI_STAGING_RUNTIME_ACK=RUN_SUPERVISED_SIMULATION_B2` y el consentimiento base del guard permite continuar. Antes de conectar exige endpoints/ref coherentes, rechazo de producción, manifiesto de aprobación y SHA-256 exacto; rechaza manifiesto vencido/incompatible. Los tokens/contraseñas solo se proporcionarían al proceso tras autorización, sin guardarlos en el repositorio.

El manifiesto externo deberá contener kind SUPERVISED_B2_SIMULATION, projectRef, organizationId, createdAt, expiresAt, providers SIMULATED_ONLY, productionClone false, baseCommit y lista migrations ordenada. Su hash liga el archivo revisado al ensayo; **no es una firma que demuestre por sí sola aprobación humana ni aislamiento**. Estos exigen revisión humana de la procedencia del proyecto y comparaciones con respuesta autenticada de Management API (ID/organización/fecha/estado), endpoints con TLS, inventario real de migraciones/funciones y ausencia de datos de producción en el proyecto de dos cuentas. No basta una variable de entorno o etiqueta.

El futuro ensayo requiere: RAXI_STAGING_REF/URL/DATABASE_URL/ACK; RAXI_STAGING_APPROVAL_FILE/SHA256; token de Management con lectura del proyecto; publishable key y server key de staging; cuentas A/B ya aprovisionadas; WORKSPACE_A y SIMULATED_MODEL. No crea proyecto, usuarios, workspace, política ni esquema. El administrador deberá preparar, tras autorización, dos cuentas/workspaces y política simulada acotada (10 microunidades ficticias por llamada, máximo de tareas revisado). El runner exige dos usuarios y cero ideas/campañas; no está diseñado para importar datos ni para reejecutar sin revisar el estado de ensayo.

El runner prepara una comprobación **parcial**: dos conexiones físicas distintas, inventario, Auth/owner, handler en proceso, aprobación/ejecución simulada, replay y logout. No acredita Edge desplegada ni completa B2. Antes de aceptar B2 faltan contención observada entre conexiones, rollback con fallos reales, matriz completa de RLS/grants, sesiones auténticas revocadas/caducadas, recuperación tras caída, backups/restauración y revisión del esquema exacto. No ejecutar el runner para averiguar si hay credenciales disponibles.

## Riesgos y bloqueos

| Prioridad | Riesgo / cierre pendiente |
| --- | --- |
| P1 | Auth/sesión/proyecto solo probados con dobles: B2 debe verificar SDK contra sesiones auténticas y configuración de GoTrue |
| P1 | Pérdida de recibo antes del primer commit: permanece bloqueo C; no se añade bandeja insegura ni segundo ledger |
| P2 | Privilegios service_role y SELECT de sesiones: aprobar inventario efectivo y separar administración del host; no publicar estas RPC a usuarios |
| P2 | Propuestas no desplegadas: revisar compatibilidad auth.sessions/not_after/is_anonymous, grants por columna, triggers y funciones antes de crear una migración autorizada |
| P2 | PGlite no acredita PostgreSQL físico concurrente, Auth alojado, RLS remoto o durabilidad frente a corte eléctrico |
| P2 | Revocación y HTTP no son atómicos; definir la frontera de admisión, no prometer cancelación retroactiva |
| P3 | Runner B2 parcial: no elevar su éxito a aceptación completa o demostración REAL |

No se seleccionan modelo real, precios, cuenta API ni presupuesto facturable. B2 exige autorización independiente de proyecto, compute, tráfico, almacenamiento y backups según el plan vigente. La reserva ficticia no es dinero ni límite del proveedor. C sigue bloqueada hasta aceptar B2, cerrar captura de recibos, comprobar transporte/preflight, aprobar proveedor/modelo/coste y autorizar Director e Investigador por separado.

## Reversión

En B1 no hay servicio ni SQL alojado que revertir: retirar la composición de los adaptadores impide nuevas admisiones. Se pueden revertir los cambios de código sin modificar la base de producción. No borrar datos/journal/reservas para recuperar un ensayo. Si en B2 se autoriza esquema, obtener backup e inventario antes, detener nuevas admisiones, preservar inciertos, probar restauración aislada y revisar cualquier downgrade; no automatizar DROP ni desactivar triggers para resolver errores. Guardian y el histórico #18 se conservan intactos.

Evidencia final: [validación B1](../output/reports/raxi-hq-runtime/SUPERVISED_HOST_STAGE_B1_VALIDATION.md).
