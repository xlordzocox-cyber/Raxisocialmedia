# PR #12 — P1: escritura nueva de campaign-command

Base revisada: `76073c196bc440e841a5a75179d8508ba3582c49`. Cambios únicamente en el runner de ensayo, su verificador, regresiones y documentación. Ninguna función Edge ni migración cambia o se despliega.

## Fallo y corrección

La prueba anterior mandaba a la Edge el mismo `REVIEW_IDEA` ya confirmado desde las conexiones PostgreSQL. Una Edge capaz únicamente de leer recibos podía devolver ese resultado y aprobar el ensayo sin escribir nada.

Ahora se crea una operación `APPROVE_IDEA` con ID nuevo después de la concurrencia y el rollback. No reutiliza ninguno de sus IDs. El verificador lee el snapshot y rechaza un recibo preexistente antes de enviar la orden; no tiene una dependencia de escritura PostgreSQL. Solo envía el comando a la Edge autenticada. `campaign-command/index.ts` conserva su RPC real `raxi_campaign_commit` como mecanismo de commit.

El primer cuerpo HTTP se cancela sin decodificar. El servidor ya ha respondido; esto simula pérdida del cuerpo, no un corte físico de red. El readback exige incremento de versión exactamente uno, estado aprobado y un solo recibo con el payload correcto, preservando el resto del snapshot salvo el reloj del servidor y el timestamp de la transición. Replay y conflicto se comprueban contra el estado canónico recuperado, no contra el cuerpo descartado. Un 200 con recibos antiguos ya no basta.

## Regresiones locales

1. Handler real y RPC PostgreSQL embebido: sin recibo inicial; una llamada nueva a commit; lectura posterior con transición/recibo/auditoría únicos; replay 200 sin repetir commit y payload distinto 409. Son tres solicitudes Edge y una sola escritura.
2. Transporte que solo devuelve recibos antiguos: rechazo de la prueba, versión/estado intactos y cero escrituras.
3. Handler sin capacidad de commit: HTTP 503 y rechazo de la prueba; ningún recibo nuevo.
4. Operación ya confirmada: rechazo antes de cualquier solicitud Edge o escritura.

Las cuatro pruebas usan fixtures PGlite aislados, Auth de prueba y transporte local. Las comprobaciones alojadas existentes de Auth, RLS, acceso entre cuentas, tres conexiones/PIDs, lock real y rollback permanecen en el runner. No se ha ejecutado `staging-acceptance.mjs --run`; ninguna prueba local acredita Auth alojado, contención entre conexiones físicas o el despliegue real de la Edge. Ese ensayo continúa pendiente de autorización e infraestructura aislada.

Validación de esta rama: **325/325** pruebas de aplicación, incluido el nuevo grupo de cuatro regresiones, y **1/1** guard de staging; build y typecheck PASS. Auditoría de dependencias: cero vulnerabilidades. El readback compara el estado JSON sin el reloj de lectura, reconstruyendo los timestamps de la transición desde el timestamp confirmado; los opcionales `undefined` del dominio se comparan con la misma omisión que aplica HTTP/JSON.

Compatibilidad adicional: el commit de código `d5c13717fa2a468ad8fe18983a6cb5090ed590d2` se combinó virtualmente con main `c6976e63879efdf52edcc51aeb8cb135ebf2394e` mediante `git merge-tree`, sin crear merge commit. Árbol `f4bb138c0ba568f636554d3948a0e2cc381db8cf`, sin conflictos. Una copia aislada por `git archive` pasó instalación reproducible, build/typecheck frontend/servidor, **356/356** pruebas de aplicación y **1/1** guard. Incluye los correctivos anteriores de políticas, presupuesto, expiración, resultados e idempotencia del runtime. El verificador LF/CRLF compartido permanece intacto. Esta actualización posterior solo añade evidencia documental.

La corrección documental del catálogo corresponde exclusivamente al PR #14; no se incorpora aquí. No se modifica la corrección LF/CRLF compartida con main.
