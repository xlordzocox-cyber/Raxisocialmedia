# Host supervisado — etapa A local

Base: main `8c05866733dffde2f1f90f99f89b904e80305d01`, merge de #18. Este incremento contiene **handlers preparatorios y PostgreSQL local persistente con proveedor simulado**. No es un host alojado, Auth Supabase operativo, autorización humana real, worker ni ejecución IA auténtica.

## Arquitectura y límites

`createLocalSupervisedHost` recibe un Request y devuelve Response. No abre puertos, registra rutas públicas, arranca servicios o ejecuta al importar. El puerto de identidad reutiliza el contrato `LocalAdmissionPorts.identify`; requiere `LOCAL_FIXTURE`, propietario, capacidad y caducidad. Rechaza falsas etiquetas SUPABASE_AUTH. Una clave Bearer de ensayo es un handle opaco del fixture, no un JWT validado criptográficamente. **Auth alojado permanece BLOQUEADO para etapa B.**

El host solo registra `simulatedProvider` y llama una vez a `runOne` existente por solicitud manual. No hay segundo coordinador ni ledger: se usan las tareas, aprobaciones, políticas, runs, eventos y auditoría existentes. `localSupervisedRepository` implementa RuntimeRepository y SupervisedJournalPort sobre un puerto SQL local de pruebas. La marca LOCAL_POSTGRES_FIXTURE documenta un límite de infraestructura confiable; no autentica por sí sola una conexión ni debe aceptarse desde una petición. No hay URL, cliente Supabase alojado, credenciales o elección de proveedor en esa fábrica.

La biblioteca del handler no se monta en la UI. HQStore, RuntimeOfficeStore, OfficeScene, AgentMotion y el observador histórico de #18 no cambian. Las simulaciones siguen como MOCK/UNVERIFIED y no se proyectan como agentes REAL.

## Contratos manuales

Todos los comandos requieren sesión fixture y workspace propio. Los cuerpos son JSON UTF-8 acotados a 8192 bytes, con allowlist por acción; no aceptan actor, permisos o liveEnabled.

| Acción | Campos además de action/workspaceId |
| --- | --- |
| prepare | key, stage DIRECTOR o RESEARCHER, spec; parentRunId para Investigador |
| approve / revoke | taskId, key, scopeDigest, confirmed:true |
| execute | taskId, key, confirmed:true |
| reconcile | taskId, operationId |

La respuesta conserva LOCAL_SIMULATION_ONLY, LOCAL_FIXTURE, LOCAL_POSTGRES y liveEnabled:false. Se leen estados canónicos antes de responder; una excepción devuelve rechazo/no confirmación, nunca un guardado ficticio. Una respuesta incierta del coordinador puede coexistir con un task COMPLETED canónico si se perdió el cuerpo del commit: el cliente deberá conciliar, sin repetir el proveedor.

Se conserva el validador común taskSpec. Los specs nuevos exigen proveedor simulated, investigación externa false y techo de 10000 microunidades ficticias, sin utilizar tarifas antiguas. La política local limita salida a 256 tokens; el proveedor simulado no acredita medición auténtica de tokens o dinero. El requestSha256 identifica el spec canónico local serializado, **no bytes enviados a un proveedor real**.

Director e Investigador tienen task IDs, aprobaciones, claves y reservas independientes. prepare crea WAITING_APPROVAL sin reservar. approve congela el digest/versión y reserva una llamada en transacción. La finalización del Director deja COMPLETED; no crea ni encola otra tarea. El Investigador exige un run Director SUCCEEDED del mismo workspace y el hash del resultado confirmado. Se verifica de nuevo al aprobar, reclamar y despachar; contenido cambiado o evidencia ajena falla.

Las claves de preparación, aprobación y ejecución tienen ámbitos/controles independientes; una operación repetida no reserva ni ejecuta otra vez. Las revocaciones son nuevas decisiones REJECTED enlazadas a la aprobación inmutable; no borran historial ni liberan automáticamente la reserva.

Los contratos locales de #17 permanecen simulados. Su planificador original de dos etapas no se convierte en autoridad alojada y no es el camino del nuevo host. El camino heredado del SQL permanece para las regresiones anteriores; el host de etapa A solo admite tareas con binding supervisado local.

## Cambios SQL propuestos — sin aplicación alojada

`supabase/proposals/supervised_host_stage_a.sql` se carga solo en tests locales, después de las cuatro migraciones base y `agent_runtime.sql`. No depende de campaign-command ni se incorpora a migrations/.

- Añade journal_version a raxi_agent_runs.
- Usa source_ref único de raxi_agent_events para las operaciones del journal; sin tabla o contabilidad paralela.
- Añade RPC preparatorias de prepare, approve/revoke, step y binding de ejecución.
- Las RPC requieren service_role; ninguna concede ejecución a anon/authenticated. Las comprobaciones de propietario son explícitas.
- El SQL del runtime incorpora un branch para tareas supervisadas: etapa explícita, autorización independiente, dependencia confirmada y finalización de una sola tarea. El comportamiento heredado se conserva.
- La propuesta soporta únicamente simulated=true y proveedor simulated; no habilita REAL mediante un cambio de configuración.

Admisión y reserva usan locks y una transacción de PostgreSQL. El step y su evento/auditoría se confirman junto con el registro idempotente del journal. Un fallo al insertar ese registro revierte el cambio de estado y el evento operativo completo.

Antes de B deberá revisarse el inventario alojado y generar una migración mediante la CLI autorizada, evitando recrear el esquema aplicado. No aplicar estos scripts directamente a producción. Una adopción futura tendrá que reconciliar las propuestas del runtime y esta extensión, no duplicar las migraciones de v0.9.

## Journal y recuperación

Cada operación usa runId:dispatch|ack|finish|unknown y versión esperada. El replay exacto devuelve su confirmación canónica; cambios de contenido o versión generan conflicto. El journal comprueba tarea/workspace/actor/aprobación/digest/requestSha256 y solo admite MOCK/UNVERIFIED. Los tokens de lease no se guardan en la confirmación del evento ni se devuelven por el handler.

SupervisedJournalWrite incorpora campos opcionales result, receipt y knownCostMicros para permitir replay completo del step. El adaptador de A exige response:null y recibos SIMULATED:<runId>; no fabrica Responses/usage ni acepta coste facturado distinto de cero. committedDigest es la huella del comando persistido, no una aprobación.

reconcile distingue FOUND, MISSING y UNAVAILABLE; nunca elimina comandos ni autoriza otro intento. La ausencia de un registro de finalización no demuestra que el efecto externo no ocurrió. runOne conserva el comportamiento de UNKNOWN y no reintenta automáticamente. Una lectura de conciliación no modifica el estado.

Las pruebas en disco cierran y reabren PGlite y crean un repositorio nuevo: comprueban operación, recibo ya confirmado y bloqueo tras reinicio. No prueban corte eléctrico, tolerancia a corrupción, concurrencia entre procesos o recuperación de un proveedor real.

### Decisión sobre la bandeja de archivos

**No implementada en A.** El journal local en PostgreSQL ya prueba confirmación, idempotencia y reinicio sin mantener otra copia del estado operativo. Una bandeja adicional requeriría ACL Windows verificadas, cifrado/retención según datos, límites de espacio, escritura atómica y recuperación sin doble entrega. chmod por sí solo no acredita aislamiento en Windows. Añadirla ahora sin esas condiciones ampliaría superficie y duplicaría datos sensibles.

Esto conserva un bloqueo explícito para C: si una respuesta se recibe pero el almacenamiento falla antes del primer commit del recibo y el proceso muere, puede perderse esa evidencia en memoria. No se promete recuperación de ese recibo; el intento queda incierto y nunca se repite automáticamente. Antes de permitir dinero real habrá que acreditar captura duradera/conciliación o aprobar una bandeja segura en un incremento revisado. Una reserva e intención persistidas no equivalen a un recibo persistido.

## Seguridad y estados

El dispatch solo registra admisión y conserva CLAIMED. No significa que el proveedor esté procesando. Solo ACK de la simulación entra en RUNNING simulado; ningún evento local puede convertirse en evidencia REAL. Revocar antes del dispatch produce cero llamadas incluso al proveedor simulado. Si una llamada empezó antes de revocar, se retienen recibos y costes; no se promete cancelación retroactiva.

Guardian automático sigue inactivo; su política no se modifica. La autorización del host es fail-closed y no hereda la excepción del scanner de instalaciones. No se han instalado ni activado scanners, hooks, proveedores, workers o servicios.

## Bloqueos para staging y REAL

1. Revisión/autorización del SQL y entorno de staging aislado con costes aprobados.
2. Identidad Supabase verificada en servidor y comprobaciones de sesión/revocación; LOCAL_FIXTURE no puede reutilizarse como identidad alojada.
3. Pruebas de grants/RLS y dos cuentas auténticas; conexiones PostgreSQL independientes, locks, rollback, concurrencia e idempotencia.
4. Revisión de privilegios del adaptador; el puerto SQL local no es un cliente RPC Supabase listo para desplegar.
5. Captura duradera del recibo frente a caída simultánea de host/BD, descrita arriba.
6. Transporte real que use los bytes del preflight de #16, medidor auténtico y política por tarea, con límites y cotización vigentes. Este host no lo registra.
7. Cuenta/proyecto API, modelo, facturación y aprobación específica por ejecución, sin inferir derechos de acceso de contratos o memoria.
8. Proyección REAL y frescura sobre eventos auténticos; mantener DEMO e histórico separados.

## Reversión

No hay servicio que apagar en A. Retirar el handler de cualquier composición futura impide nuevos comandos. Ante un rollback se conservan la base local de ensayo, journal, reservas e historial para reconciliar; no borrar runs ni operaciones inciertas. Los cambios son propuestas sin despliegue: revertir el código no requiere un downgrade de producción. Después de B cualquier reversión de esquema requerirá revisión, respaldo y ausencia de operaciones pendientes; no automatizar un DROP.

Pruebas/evidencias: [validación de etapa A](../output/reports/raxi-hq-runtime/SUPERVISED_HOST_STAGE_A_VALIDATION.md).
