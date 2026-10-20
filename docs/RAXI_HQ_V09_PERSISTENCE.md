# Raxi HQ v0.9 — persistencia y procedencia

## Límite de confianza

La vista REAL solo puede mostrar registros recuperados de un workspace autenticado. Las siete ideas de `mockIdeas.ts` pertenecen exclusivamente a DEMO; no se importan automáticamente ni se presentan como investigación. La ausencia de conexión deja REAL sin datos y con un error visible, nunca con un fallback a DEMO.

El navegador puede leer únicamente los registros permitidos por RLS al propietario autenticado. Las escrituras operativas pasan por un servicio que verifica el JWT, deriva el usuario desde la sesión autenticada, comprueba la pertenencia al workspace y valida la transición, versión esperada e idempotencia antes de confirmar una transacción. Ninguna clave privilegiada se distribuye al frontend.

La interfaz publica una acción como guardada solo después de recibir la confirmación del servicio y de reconciliar el estado canónico devuelto. Si la red o la validación falla, conserva el formulario editable y muestra el fallo. Un reintento usa la misma clave de idempotencia; no duplica la acción.

## Registros y relaciones

La persistencia debe conservar los IDs originales junto a UUID internos para resolver colisiones históricas sin sobrescritura. Ideas, borradores, handoffs, decisiones, campañas, estrategias y revisiones, órdenes Aria, recibos, revisiones QA, decisiones humanas y auditoría forman una proyección consistente del workspace. El recibo importado no acredita por sí solo el origen de Aria; la procedencia y la integridad del archivo se verifican por separado.

Cada idea REAL declara procedencia: entrada manual de Luis, propuesta de agente, investigación con fuentes, o importación histórica con estado de verificación. Las evidencias de investigación vinculan idea, ejecución/agente cuando existan, fuente, URL, fecha de consulta, resumen, verificación, confianza justificada y relaciones. Una investigación sin evidencia comprobada nunca aparece como verificada. Los futuros agentes solo publicarán resultados y eventos cuando haya un ejecutor real identificado.

Los originales de Aria van a Storage privado sin recodificación, con SHA-256 de los bytes originales y relación obligatoria al recibo, `ariaImageId`, trabajo y revisión. Supermemory aporta contexto semántico autorizado; PostgreSQL mantiene el registro operativo y Storage el original físico.

## Sincronización del esquema

Antes de añadir migraciones se deben recuperar y versionar exactamente las migraciones ya aplicadas en el proyecto Supabase. No se deben volver a ejecutar. A continuación se inspeccionan tablas, restricciones, índices, RLS, políticas, funciones y bucket reales. Las migraciones nuevas se limitan a las diferencias necesarias para procedencia, evidencias y frontera de escritura. Toda comprobación de propiedad e idempotencia se prueba contra el esquema real antes de abrir el PR.

## Verificación de aceptación

1. Crear una idea manual REAL, confirmar guardado, recargar y recuperar exactamente el mismo ID, estado y contenido.
2. Crear campaña y Strategy; recargar y verificar revisiones, aprobaciones, relaciones y auditoría.
3. Repetir una operación con la misma clave de idempotencia: un único efecto.
4. Rechazar acceso anónimo y referencias a otro workspace.
5. Simular error de red: ningún mensaje de guardado exitoso y ningún estado canónico adelantado.
6. Confirmar que DEMO no aparece en REAL y que las investigaciones sin evidencia no figuran como verificadas.
7. Confirmar que ningún secreto o clave de servicio llega al bundle y que los eventos MOCK no se mezclan con eventos persistidos.

Esta especificación no afirma que el esquema o el servicio estén implementados: el SQL final debe derivarse de la instancia real.

## Incremento implementado: primera idea manual

El incremento de este PR implementa exclusivamente workspace propio, Auth, captura manual de ideas, lectura persistente, idempotencia y auditoría. El esquema se inspeccionó en la instancia real, se recuperaron las tres migraciones originales y se añadió una cuarta versión sin reejecutar las anteriores. Los contratos del frontend se conservan mediante un adaptador de respuestas canónicas. Las escrituras de campañas, estrategias, fotografías, aprobaciones y agentes descritas en la visión general siguen pendientes y no están habilitadas en este incremento.

Las siete ideas de demostración solo se cargan tras elegir Campus DEMO. La función de creación rechaza sus IDs y no permite elegir procedencia, actor ni transición. El registro manual usa el ID externo generado al iniciar su operación, `PROPOSED`, hora de PostgreSQL y una auditoría enlazada. Los reintentos conservan el ID y la clave de operación; cambiar el contenido pendiente produce un conflicto en vez de insertar otra idea silenciosamente.

Detalle técnico y comandos: `supabase/README.md`. Evidencias verificadas: `output/reports/raxi-hq-v09-persistence/VALIDATION.md`.
