# PR #11 — P1: sincronización tras capturar una idea

## Recuperación

Se verificó la rama `feature/raxi-hq-v1.0-campaign-strategy-persistence`, HEAD `7632d47de79bdbc0fa346d3be49ddebc52fd2151` y árbol limpio tras el apagado. No había un correctivo parcial que recuperar ni se descartaron archivos.

## Corrección

`RealIdeaCenter` diferencia reanudar una vista de invalidar campañas por una idea confirmada. `RealCampaignStore.synchronizeIdea` fuerza lectura canónica en READY y conserva el último aviso por sesión. Una lectura activa se comparte entre solicitantes; los avisos recibidos durante ella agrupan una lectura posterior. La respuesta anterior no puede habilitar decisiones, confirmar recibos ni sobrescribir la respuesta posterior. Las escrituras activas terminan antes de leer; los comandos inciertos conservan IDs y claves originales.

Las decisiones quedan bloqueadas durante sincronización y después de un error de lectura. El Centro de Ideas exige correspondencia de ID, `updatedAt` y estado entre sus filas confirmadas y el snapshot canónico antes de ofrecer transiciones. No hay inserción optimista ni copia de datos visuales al store de campañas. AuthStore sigue siendo propietario de ambos stores; logout/cambio de cuenta retira el estado e invalida respuestas y reconciliaciones en cola.

App permite inyectar el repositorio de campañas igual que el de ideas para probar su ciclo de vida real. En ejecución normal mantiene el mismo repositorio Supabase y la misma identidad autenticada; las pruebas no configuran credenciales ni red de producción.

## Regresiones y resultados

Build, typecheck y **321/321 pruebas PASS** (314 existentes y siete regresiones nuevas). `npm audit`: cero vulnerabilidades. El escáner de aplicación mantiene únicamente el nombre de campo literal del SDK ya verificado; revisión del diff y archivos preparados sin credenciales. No se modifican SQL, Edge Functions, políticas, dependencias ni contratos del servidor.

Cuatro regresiones montan App, AuthProvider/ProtectedRoute y ambos stores en Strict Mode con repositorios controlados:

1. Snapshot inicial vacío en READY; formulario original guarda una idea; su respuesta confirma la escritura del fixture; una lectura canónica diferida incorpora la idea y permite confirmar REVIEW_IDEA sin recargar el navegador. Antes de resolver esa lectura, ninguna transición ni comando puede ejecutarse.
2. Una lectura anterior sigue pendiente al confirmar la idea. Navegar REAL → DEMO → REAL y remontar App no duplica lecturas. La respuesta vieja se descarta, una única lectura posterior confirma la idea y se registra una sola revisión con un recibo.
3. Captura completada mientras se ve DEMO, regreso a REAL y cambio de usuario con lectura pendiente. Las respuestas de las cuentas terminan en orden inverso; el store retirado no reaparece ni modifica el nuevo.
4. Servicio sin desplegar: la captura no habilita decisiones ni inventa un snapshot; permanece el aviso de despliegue pendiente.

Tres regresiones adicionales cubren avisos agrupados, lectura fallida con reintento bloqueado hasta recuperar estado, conservación exacta del comando/idempotencia, reconciliación después de una escritura incierta, recibo incompatible que mantiene conflicto y logout que impide iniciar la lectura en cola. Las pruebas previas de PostgreSQL/PGlite, permisos, rollback, historial, respuestas perdidas y ciclo de vida siguen pasando.

Límite: las pruebas nuevas de App usan repositorios de fixture; la integración SQL local existente usa PGlite. No se afirma aceptación de la nueva función en Supabase alojado: sigue sin desplegarse.

## QA y producción

Se reinició únicamente Vite de este checkout tras comprobar que el puerto local estaba libre. En el navegador autenticado se inspeccionaron tarjetas, métricas y detalle; se navegó REAL → DEMO → REAL. REAL conserva una idea y su referencia de auditoría 2; DEMO muestra sus siete ideas aisladas. Revisar/Aprobar/Enviar permanecen deshabilitados y campañas muestra despliegue pendiente. [Captura de QA](p1-real-disabled.png).

No se crearon ideas de aceptación, no se escribieron datos reales, no se aplicó la quinta migración, no se desplegó la función ni se ejecutó Aria. La comprobación visual solo leyó el estado existente. No se hizo merge. La revisión remota del nuevo HEAD se solicita en el mismo PR #11.
