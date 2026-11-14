# Raxi HQ · Centro de mando fijo (PR #66)

**Estado:** Implementado en rama DRAFT. No merged, no Preview, no migraciones.

## Origen UX

Boceto del usuario: oficina siempre visible **arriba**, contenido de módulo **abajo a la izquierda**, selector de módulo **abajo a la derecha**. No convertir el campus en una página larga con la oficina lejos del área de trabajo.

## Arquitectura de pantalla

- **Header compacto:** REAL/DEMO y salida autenticada.
- **Oficina fija:** una única instancia Pixi `OfficeScene` fuera de cualquier panel con scroll; posición/cámara controladas por usuario, sin recrear canvas al cambiar de módulo. Overlay estado de cámara con altura estable para que `ResizeObserver` no borre `focusZone`.
- **Área inferior:** panel izquierdo con scroll-y independiente; rail derecho con botones **Ideas, Campañas, Agentes, Tareas, Actividad, Runtime y Fuentes**; los módulos no mueven la oficina.
- **Móvil:** viewport `100dvh`, altura de oficina proporcional y variante para `max-height:520px` que da prioridad a la zona de trabajo en landscape. Sin desplazamiento del body y sin panel vacío por flexbox.
- **Desktop:** el mismo patrón de comandos, ampliado. No hay 3D.

## Contratos y límites que deben preservarse

- `RealIdeaCenter` se mantiene montado mientras el usuario cambia entre ideas/campañas/runtime, con `view` que oculta subpaneles **sin destruir sus stores**. Los guardados pendientes, ownership, selección, suscripción y RPC de lectura conservan su ciclo de vida.
- `CampusOverview` mantiene sesiones locales DEMO al cambiar entre ideas y campañas; Runtime DEMO se muestra como inexistente, nunca como proveedor real.
- Agentes, Tareas y Actividad usan `officeState` con scope y selección ya verificados. Seleccionar un agente mueve cámara y abre su Inspector.
- `REAL` solo acepta fuente comprobada; `DEMO` sigue explícitamente MOCK. Si no existen eventos `AGENT_EXECUTOR/VERIFIED`, la oficina REAL muestra **0 agentes**, no sprites inventados.
- Esta rama **no** solicita nuevos permisos, migraciones ni ejecuciones pagadas.

## Aceptación pendiente

- Suite completa React/TypeScript/build, PG17 offline, seguridad de compatibilidad REAL/DEMO, Codex independiente.
- Android vertical estrecho: office fija visible mientras el panel inferior hace scroll, navegación táctil del rail, 7 módulos, foco en sala y botón `Vista completa` sin cambio espontáneo de zoom.
- Android horizontal corto: oficina reducida, panel inferior utilizable y rail desplazable.
- Escritorio/teclado: focus ring y acceso a todos los módulos.
- Sesión/cambio workspace y guardado pendiente al cambiar de módulo sin pérdida de confirmación.

**El resultado visual en navegador no se declara validado hasta una Preview autorizada del SHA exacto.**
