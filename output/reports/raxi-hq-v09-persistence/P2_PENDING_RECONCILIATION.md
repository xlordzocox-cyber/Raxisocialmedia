# PR #10 — reconciliación del guardado pendiente

Validado el 20 de octubre de 2026 sobre el HEAD revisado `32cc11c81bf37d0b62079e8ff42302db444ffdc6`.

## Corrección

Si PostgreSQL acepta una idea y se pierde la respuesta HTTP, `load()` ahora busca el ID externo del comando pendiente en la lectura canónica. Comprueba workspace, propietario, procedencia manual, estado inicial, título, nota, prioridad, referencia/evidencia, UUID interno, auditoría y fechas válidas. La lectura autenticada existente obtiene las filas mediante el RPC que une cada idea con su auditoría real de creación. No se cambia ese RPC ni el esquema.

El comando se libera únicamente después de validar toda la lectura en la generación vigente. La recuperación publica `savedId` y permite crear otra idea con nuevas claves sin reiniciar el componente. El formulario confirmado se cierra para evitar que el contenido recuperado se vuelva a enviar accidentalmente como una operación nueva.

Si no aparece el registro, se conserva el comando completo y sus claves. Un registro incompatible o múltiples coincidencias producen un conflicto con el ID externo y mantienen el comando; ningún conflicto se presenta como éxito. Las respuestas directas de guardado usan la misma comprobación de confirmación. Se mantienen las barreras por generación, sesión y propietario.

## Regresiones y QA

Las pruebas usan un repositorio en memoria con commit idempotente separado del transporte: el servidor simulado guarda una única fila/auditoría antes de lanzar el error de respuesta perdida. No son escrituras a Supabase.

- Respuesta perdida después del commit; `load()` recupera y confirma la idea original.
- Creación posterior con contenido, ID y operación diferentes en el mismo store; original intacta.
- Lectura sin registro: no libera el comando y conserva exactamente las claves durante dos reintentos, con un solo efecto persistido simulado.
- Rechazo de propietario, workspace, título, nota, prioridad, referencia, procedencia, estado, auditoría ausente/malformada, UUID y fecha incompatibles.
- Coincidencias duplicadas rechazadas; lectura posterior válida resuelve el conflicto.
- Lectura tardía tras cerrar sesión y lectura sustituida por una generación más reciente: no alteran el estado actual ni el de otro usuario.
- QA con componentes React montados: formulario → error de transporte → botón Recargar desde Supabase → confirmación → formulario cerrado → nueva captura vacía → segunda idea seleccionada. Se preservan las claves de la primera operación.

## Resultados

- Build y typecheck: PASS.
- Suite completa: **294/294 PASS** (18 regresiones nuevas).
- npm audit: cero vulnerabilidades.
- `git diff --check`: PASS.
- Revisión manual de la reconciliación: validación antes de liberar el comando, sin cambios de permisos, credenciales, endpoint o RLS. El escáner de secretos conserva un único falso positivo del SDK, comprobado por igualdad exacta con `access_token:"access_token"`; no se silencia el escáner. Sin referencias a claves privilegiadas en `src` o bundle.
- Consulta remota exclusivamente de lectura y comparación profunda contra la evidencia anterior: idea original y auditoría intactas; una idea REAL, cero ideas DEMO, cero eventos de agentes y las mismas cuatro migraciones.

No hubo migraciones, escrituras de producción, generación de fotografías, consumo de créditos de Aria, publicación de contenido ni merge. La revisión automática del nuevo HEAD se solicita por separado; estas validaciones no afirman que esa revisión ya haya terminado.
