# PR #10 — escrituras pendientes durante navegación

Validado el 20 de octubre de 2026. Base revisada: `ac12dc5938340e62a67316b9c0f5c4c9b0f8eb54`.

## Ciclo de vida

`AuthStore` es el propietario de un único `RealIdeaStore` por sesión verificada. `App` lo solicita mediante una fábrica de repositorios y conserva la misma instancia al cambiar de campus o remontarse. La fábrica de producción sigue usando el repositorio autenticado de Supabase; las pruebas inyectan únicamente un repositorio en memoria. No hay fallback a DEMO.

`RealIdeaCenter` solo se suscribe y llama a `resume()`. Su desmontaje no ejecuta `dispose()`. Al regresar, una escritura activa mantiene su bloqueo; una confirmación existente conserva su resultado; una escritura incierta inicia la lectura canónica y reconciliación ya implementada. Si falta la fila o hay conflicto, el comando permanece pendiente. El botón **Reintentar guardado pendiente** utiliza el comando, ID externo y clave de idempotencia originales, sin exigir volver a escribir el formulario.

La pérdida de sesión verificada o cambio de usuario retira y vacía el store antes de notificar el nuevo estado Auth. Esa invalidación es terminal: el objeto retirado no puede leer ni escribir de nuevo. Las respuestas tardías no pasan la comprobación de generación y no se publican en la sesión siguiente. Invalidar una sesión no afirma que una petición ya enviada al servidor haya sido cancelada; su resultado se debe recuperar desde el workspace autenticado.

La conservación del comando ocurre en memoria durante la misma sesión autenticada; no se añade un diario persistente del navegador. Tras una recarga completa se recuperan los registros aceptados por PostgreSQL. Los efectos de montaje/cleanup de Strict Mode y del proveedor visual no son eventos de cierre de sesión.

## Regresiones con componentes montados

Las diez pruebas nuevas montan `App`, `RealIdeaCenter`, `AuthProvider`, rutas protegidas y Strict Mode. El repositorio simula el servidor con una relación única operación → fila/auditoría y controla por separado commit y respuesta HTTP. El runner define configuración Vite vacía en tests para que importar App nunca lea credenciales ni conecte al proyecto real.

1. Iniciar guardado REAL, cambiar a DEMO, volver antes de la respuesta y forzar remount de App: misma instancia, nueva captura deshabilitada, segunda operación rechazada, una solicitud y un único efecto tras confirmarla. La recarga de lectura recupera el original.
2. Confirmación mientras DEMO está visible: resultado conservado al volver a REAL.
3. Respuesta HTTP perdida después del commit en DEMO: lectura al regresar reconcilia el original y solo entonces permite otra idea con claves nuevas.
4. Lectura sin fila: dos reintentos y navegación conservan exactamente el mismo comando, con una sola fila/auditoría simulada.
5. Registro incompatible: conflicto visible y bloqueo conservado tras navegar; reintento usa las claves originales.
6. Logout antes de una respuesta exitosa: exposición retirada y objeto anterior inutilizable.
7. Logout antes de un fallo tardío: mismo aislamiento y ninguna mutación posterior.
8. Cambio directo de cuenta con respuestas completadas en orden inverso: solo el resultado propio llega al nuevo usuario.
9. Fallo del servidor anterior al commit: ninguna fila ni éxito anticipado; navegación y reintento recuperan la operación original.
10. Desmontar/remontar todo el proveedor visual dentro de la misma sesión: el guardado sigue activo y bloquea duplicados.

## Validación y seguridad

- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: **304/304 PASS**, incluidas las diez regresiones nuevas y las anteriores de reconciliación.
- `npm audit --audit-level=low`: cero vulnerabilidades.
- `git diff --check`: PASS.
- Revisión manual: propiedad exclusiva de la sesión verificada; invalidación antes de cambio de identidad; acciones bloqueadas sobre stores retirados; comprobaciones de generación conservadas; ninguna modificación de JWT, RLS, RPC, migraciones o credenciales.
- Escáner de secretos: un falso positivo del SDK, comprobado por igualdad exacta con el literal `access_token:"access_token"`. Sin supresión del escáner. Sin claves privilegiadas en frontend/bundle.
- Consulta remota de solo lectura y comparación profunda contra la evidencia anterior: primera idea y auditoría originales intactas; una idea REAL, cero ideas DEMO, cero eventos de agentes y las mismas cuatro migraciones.

## QA visual

Navegador autenticado en escritorio 1440 px y móvil 390 px: REAL → DEMO → REAL conserva la separación; siete tarjetas solo en DEMO, una en REAL, ID original y auditoría 2. Sin desbordamiento horizontal (documento 1425/375 px con scrollbar). Recarga completa del navegador: misma idea original, conexión Supabase confirmada y cero agentes/eventos REAL.

Capturas: [DEMO](navigation-demo.png) y [vuelta a REAL](navigation-real.png). El navegador no envió nuevas ideas; los escenarios de escrituras pendientes se ejercitaron en los componentes montados con transporte controlado, sin tocar producción.

No hubo merge, migraciones, nuevas escrituras de producción, generación de fotografías, consumo de créditos Aria ni publicación de contenido. La revisión automática del nuevo HEAD se solicita después del push; su resultado no forma parte de estas comprobaciones locales.
