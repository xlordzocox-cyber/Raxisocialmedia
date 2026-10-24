# Contratos del host supervisado — incremento preparatorio

Base comprobada: main `01aa6155a45cbe5e4b66f8ab2035b9d7899e78a9`, posterior al merge de #16. Estado: **CONTRATOS LOCALES Y SIMULACIÓN; SIN HOST NI EJECUCIÓN REAL HABILITADOS**. No cambia versión del paquete, UI, SQL, proveedores, configuración o infraestructura.

## Arquitectura mínima y reutilización

| Pieza | Responsabilidad |
| --- | --- |
| `runtime.ts` existente | `TaskSpec` y su validación cerrada, etapas de `Claim`, `RuntimeRepository` y coordinador `runOne`. Se precisa en el validador común que proveedor/modelo sean strings, sin coerción implícita de regex. No cambia el coordinador |
| `supervisedSafety.ts` existente | Inspección del cuerpo exacto, SHA-256, tamaño UTF-8, medidor inyectado y clasificación de recibos/usage. No se duplican estas validaciones |
| `supervisedHostContracts.ts` | Contratos de identidad/aprobación/política local, inspección de admisión, planificación manual desde historial y conciliación conservadora. No ejecuta etapas |
| `supervisedHostContracts.test.ts` | Puertos de identidad/aprobación/política y adaptador `RuntimeRepository` **en memoria**, expresamente fixtures. Llama manualmente al `runOne` existente con `simulatedProvider` existente |
| `SupervisedJournalPort` | Interfaz futura de commit/conciliación con operación, versión esperada, IDs, autorización, digest, recibo y procedencia. **Sin implementación ni afirmación de persistencia** |

No se crean entidades de Supabase, perfiles de agentes, segundo coordinador, cola o motor de políticas desplegado. Los nombres de estado de intentos reflejan los ya existentes: CLAIMED, RUNNING, SUCCEEDED, FAILED, UNKNOWN. Director e Investigador son las dos etapas existentes, derivadas del contrato `Claim`; no se añaden agentes.

El mapeo futuro deberá reutilizar workspace/propietario, aprobaciones TASK, tareas/runs, eventos y auditoría existentes. Los contratos locales no declaran que el esquema remoto ya acepte todos sus campos: el adaptador alojado deberá revisar ese mapeo y sus transacciones en otro incremento, sin crear preventivamente tablas paralelas. Esta fase no consulta ni modifica el esquema remoto.

## Identidad, alcance y aprobación

La entrada local captura tarea, workspace, aprobación, clave original del comando y `TaskSpec` antes de cualquier `await`. El digest se construye con campos en orden estable; vincula esos IDs y el alcance completo, proveedor/modelo, presupuesto y vencimiento del spec. Reordenar propiedades no cambia su significado; cambiar alcance o clave produce otro digest.

Los puertos de prueba obtienen identidad, aprobación y política. Ningún dato enviado en el texto del modelo, fuentes o solicitud puede reemplazarlos. Se exige propietario del workspace, usuario no anónimo, capacidad TEXT_RESEARCH y vigencia del reloj del proceso. La aprobación debe pertenecer al mismo operador/tarea/workspace, ser APPROVED, no revocada, coincidir en digest/proveedor/modelo/presupuesto y en versión de política, y tener fecha de emisión/vencimiento válida. Se rechazan datos ausentes, fallos de lectura, versiones incompatibles y permisos añadidos a la solicitud.

Toda evidencia de estos puertos requiere `provenance:LOCAL_FIXTURE`. Un objeto que diga SUPABASE_AUTH se rechaza: **no es una implementación de Auth ni una autorización alojada**. La salida `LOCAL_CONTRACT_ONLY`, `mode:SIMULATED`, `liveEnabled:false` describe únicamente compatibilidad local. No es un token, una capacidad de ejecución ni una aprobación humana real. Las aprobaciones de tests son fixtures, no decisiones atribuidas a Luis.

Para producción seguirá siendo obligatorio verificar sesión en servidor, propiedad y aprobación canónica mediante las comprobaciones alojadas autorizadas. No aceptar el actor, metadatos de aprobación o versión de política desde el navegador como evidencia. Los modelos no reciben métodos de aprobación, claves, journal, repositorio o puertos de identidad.

## Política y presupuesto

Solo se admite proveedor `simulated`, modo simulado y pregunta textual sin recuperación externa. La política debe estar habilitada y vigente y conservar la versión aprobada. Se comprueba una reserva **teórica** para dos llamadas contra el techo humano y saldo informado. Se reutilizan exclusivamente los límites de planificación de `PILOT_QUOTE`: dos etapas, 8.000 tokens de entrada por etapa, 256 de salida y USD 0,01 de techo por tarea. **No se reutilizan sus tarifas caducadas ni se renueva su cotización.** Los importes de pruebas son microunidades ficticias; el proveedor simulado reporta cero.

Esta inspección sin estado no reserva fondos ni arbitra presupuestos entre procesos/tareas. El backend futuro deberá efectuar reserva y admisión transaccional, versión monotónica de política, owner checks e idempotencia usando la implementación existente revisada, sin crear un segundo ledger. No conectar un proveedor real hasta establecer cotización actual, límites de entrada/salida, control de factura, secretos de servidor y autorización humana verificable.

## Estados, reintentos y conciliación

`inspectLocalManualStep` solo propone el siguiente paso manual desde evidencia del mismo workspace/tarea. Historial vacío permite planificar Director; solo Director SUCCEEDED permite planificar Investigador; ambos SUCCEEDED dan COMPLETED. CLAIMED/RUNNING bloquean otra operación; FAILED/UNKNOWN exigen conciliación. Duplicados de run/clave, intentos distintos de 1, orden inválido, estados desconocidos, recibos reales dentro de simulación o ámbitos ajenos se rechazan. Nada de esto reclama o inicia un intento por sí solo.

Las pruebas serializan claims en el adaptador de memoria y comprueban solicitudes concurrentes. Esto **no acredita locks entre conexiones PostgreSQL**. El adaptador lee de nuevo identidad/aprobación/política antes de claim y dispatch; una revocación en el despacho produce cero llamadas incluso al adaptador simulado. Recibos de una operación iniciada no se borran porque cambie después una política: se retienen para conciliar, siguiendo el runtime existente.

La conciliación distingue PENDING, CONFLICT y MATCHED_LOCAL comparando workspace, tarea, run, clave original, SHA-256 y procedencia MOCK/UNVERIFIED. Incluso una coincidencia local conserva el comando original y `automaticRetry:false`; no reabre un intento UNKNOWN ni lo declara SUCCEEDED. Una ausencia o caída no autoriza repetir el efecto. El journal futuro deberá resolver commit incierto de manera canónica y conservar recibos antes de considerar otro intento.

## Auditoría y persistencia futura

`SupervisedJournalWrite` referencia los IDs existentes, operación, versión esperada, operador/aprobación, scopeDigest/requestSha256 y acción del contrato `RuntimeRepository.step`. Reutiliza `InspectedResponse`, incluidos ID y usage sin coste facturado inferido. Su unión de procedencia impide tipar una simulación como AGENT_EXECUTOR/VERIFIED. El puerto exige commit atómico e inspección de conciliación, pero no contiene cliente, SQL o adaptador duradero.

Un tipo TypeScript no autentica la procedencia ni sustituye validación de datos recibidos. Un adapter futuro deberá comprobar estas invariantes en servidor y probarlas con Auth/RLS alojados. La huella del preflight tiene que corresponder a los bytes realmente enviados y al evento/recibo persistido. No se afirma que esa integración exista en este incremento.

## Riesgos y bloqueos que permanecen

- Los puertos y el journal son contratos, no servicios operativos. El estado en memoria se pierde al reiniciar; no usarlo para efectos reales ni recuperación tras caídas.
- Las lecturas de política/aprobación no son una transacción. El futuro backend debe impedir TOCTOU con admisión final, leases e idempotencia; no se promete cancelar una llamada que ya empezó.
- Falta host autenticado, transporte real que use el cuerpo inspeccionado, medidor auténtico, journal duradero y ensayo aislado autorizado. No se prueba aquí persistencia real de recibos, Auth de Supabase o concurrencia física.
- Faltan acceso API, cotización vigente, controles de facturación y aprobación de gasto. Ninguno se obtiene a partir de texto, una memoria o una Strategy aprobada.
- Investigación externa, QA creativo ejecutable, Aria, publicación, Munder y memoria automática quedan fuera. Supermemory sigue siendo contexto; Supabase y Storage serán los registros operativos/originales.

La UI y Office/Pixi no cambian. Una regresión utiliza la proyección existente para comprobar que los fixtures no crean agentes o eventos REAL. Sin API keys, SQL nuevo, migraciones, workers, cron, nocturnidad, despliegues o recursos facturables.

Pruebas y resultados: [evidencia del incremento](../output/reports/raxi-hq-runtime/SUPERVISED_HOST_CONTRACTS_VALIDATION.md). El PR debe permanecer en borrador; ningún resultado local autoriza merge o habilitación de agentes.
