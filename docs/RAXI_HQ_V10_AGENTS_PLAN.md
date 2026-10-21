# Agentes reales — siguiente incremento separado

Propuesta implementada para revisión: [primer recorrido Director/Investigador](RAXI_HQ_FIRST_AGENT_RUNTIME.md). Núcleo local probado con simulaciones; ningún servicio o agente real ha sido desplegado/habilitado.

Estado: diseño, sin ejecutores, colas, Realtime ni agentes activos añadidos por este PR. Complementa `RAXI_HQ_REAL_AGENTS_ARCHITECTURE.md` y conserva su distinción entre presentación Pixi y ejecución auténtica.

## Entrada y autorización

HQ presentará una tarea basada en campaña, revisión aprobada y entregables persistidos. Una solicitud captura IDs, versión y snapshot. Un servicio autenticado comprueba propiedad y autorización humana; no delega permisos mediante texto de prompts, `user_metadata`, Presence o el estado visual de un avatar.

El Director IA será un proceso servidor identificable con capacidad acotada por workspace/tarea. Los especialistas reciben solo los datos necesarios: brief canónico, revisión autorizada, entregables y assets aprobados por ID estable. No reciben credenciales privilegiadas ni acceso general al proyecto. Su identidad de ejecución y la identidad humana que autorizó la tarea son distintas y ambas quedan registradas.

## Ejecución y eventos

Inspeccionar de nuevo `raxi_agent_profiles`, `raxi_agent_tasks`, `raxi_agent_events` y `raxi_approvals`. El contrato de ejecución propuesto en la arquitectura debe incluir intento, lease, ejecutor, proveedor/modelo, versión y coste autorizado. Solo entonces decidir una tabla de runs o ampliación mínima; no crearla preventivamente en este PR.

Una cola duradera entrega intentos con deduplicación. El servidor valida el acuse del ejecutor y confirma su evento antes de mostrar RUNNING. Heartbeats, vencimiento, cancelación y reconciliación distinguen ejecución confirmada, interrumpida y desconocida. Una caída de red nunca conserva falsamente un agente activo. Resultados y evidencias se verifican antes de SUCCEEDED; ni un mensaje de modelo ni una animación prueban una operación externa.

Las acciones de escritura usan una API de comandos con idempotencia, versión esperada y auditoría; los agentes no actualizan directamente aprobaciones o estado operativo. Las lecturas requieren alcance por workspace y tarea. La aprobación de Strategy no autoriza imágenes ni publicaciones: cada efecto externo con coste o publicación necesita la orden concreta y autorización correspondiente. Aria sigue siendo el único proveedor fotográfico autorizado.

## Memoria, interfaz y aceptación

Supabase conserva estado, decisiones, auditoría y relaciones; Storage conserva originales. Supermemory aporta contexto complementario permitido, con namespace y referencias operativas, sin secretos, archivos originales o supuestas copias de respaldo. Munder es un adaptador complementario; el runtime propio no dependerá de su disponibilidad.

La oficina recupera snapshot y cursor, aplica eventos autorizados/deduplicados y reconcilia huecos. Pixi muestra esa proyección, sin fabricar progreso, tareas o publicaciones. Hasta verificar solicitud → autorización → ejecutor → evento persistido → resultado → auditoría de extremo a extremo, REAL mantiene cero agentes activos. Probar acceso ajeno, reintentos, resultados falsificados, reinicio, respuestas tardías, lease vencido y autorización/coste obsoletos antes de habilitar el runtime.
