# Raxi HQ — Preparación del host supervisado y controles de proveedor

**Estado: propuesta de integración, no host operativo ni habilitación de IA.** Base: main posterior al PR #15. No incorpora endpoints, credenciales, cola, trabajador, SQL, migraciones, aplicaciones desplegadas ni consumo de proveedores.

## Controles añadidos

- \`server/agent-runtime/supervisedSafety.ts\` implementa \`inspectSupervisedPreflight\`: recibe **el cuerpo JSON serializado exacto** que se pretende enviar a Responses y un medidor de tokens configurado por el servidor de confianza (nunca por el navegador). Rechaza ausencia/errores de medición, entrada por encima del límite, cotización caducada antes o después de medir, \`store\` distinto de \`false\`, herramientas habilitadas, modelo o límite de salida distintos y cuerpo inválido. Devuelve exclusivamente \`PREFLIGHT_ONLY\` / \`liveEnabled:false\`. **No implementa tokenizer, no aproxima tokens por caracteres y no autoriza gasto.**
- \`inspectResponseReceipt\` clasifica datos JSON recibidos del proveedor sin hacer red: extrae \`resp_*\` y \`usage\` validado *antes* de interpretar texto generado. Cuando el resultado no termina correctamente o el JSON generado es inválido, retorna \`RECONCILIATION_REQUIRED\` conservando ID y uso cuando existen. Un objeto interpretable se clasifica \`PARSED_UNVERIFIED\`: no garantiza calidad factual, coste facturado ni autorización.
- \`apps/raxi-hq/tests/supervisedSafety.test.ts\` usa un medidor simulado y respuestas locales; \`scripts/test.mjs\` incorpora esa suite al corredor principal.

Estos controles están **deliberadamente desconectados** de \`openAIProvider\`, \`runOne\`, la interfaz y Supabase. Los tests no acreditan medición auténtica de OpenAI ni recuperación de efectos remotos. No se ha añadido un ejecutor.

## Host mínimo supervisado — diseño pendiente, sin implementación ejecutora

1. Un host de servidor autorizado verifica \`getUser(token)\`, rechaza cuentas anónimas, obtiene propietario y workspace mediante Auth + PostgreSQL real y **no** acepta actor suministrado por el navegador.
2. El usuario aprueba tarea, dos etapas, proveedor/modelo, precio vigente, importe máximo y vencimiento. Supabase confirma aprobación, política, reserva y auditoría transaccionalmente. El modelo, una memoria recuperada o una Strategy aprobada no pueden concederse permisos.
3. Antes de una llamada, serializar el cuerpo definitivo, contar **todos los tokens del payload completo** con un medidor confiable específico del modelo e inspeccionarlo. El transportador debe enviar *exactamente los mismos bytes* inspeccionados; si cambia el cuerpo se mide nuevamente. Ante error, no enviar. El contador y los límites requieren adaptación y pruebas reales específicas; este PR no los aporta. Una reserva no es un tope duro de facturación del proveedor.
4. La futura integración debe **persistir duraderamente receipt y usage antes de decodificar el texto**. Si la decodificación falla, retener intento/reserva y clasificar \`UNKNOWN/BLOCKED\` hasta conciliación humana; no reintentar automáticamente una llamada potencialmente facturada. \`usage\` no equivale a factura y \`resp_*\` no debe imprimirse como secreto en registros públicos.
5. El Director y el Investigador corren únicamente cuando el operador solicita cada paso; el segundo requiere confirmación canónica del primero. Sin cron ni ejecución nocturna autónoma. Los eventos SIMULATED nunca se muestran como agentes REAL.
6. Primera prueba auténtica: solamente en Supabase de ensayo aislado, tras cotizar y autorizar explícitamente cualquier coste de infraestructura y API. Producción y su primera idea permanecen fuera del ensayo.

## Bloqueos antes de activar IA real

Aún se requieren host/secretos, ensayo de Auth/RLS con dos cuentas, SQL runtime validado en staging, mecanismo de medición exacta del proveedor, conservación duradera de recibos/usage ante fallos, verificación de acceso/facturación de API y aprobación explícita de gastos. La cotización del PR #15 vence el 23 de octubre de 2026 a las 18:00 UTC; no se renueva por este PR. Investigación externa requiere recuperador permitido, límites de red/SSRF y fuentes verificables. Aria Studio sigue siendo el único proveedor visual autorizado; esta fase no lo conecta.

## Validación honesta

Revisión local puntual del módulo: compilación TypeScript y pruebas básicas aisladas, sin red. **La ejecución completa de \`npm test\`, build, typecheck del monorepo y auditoría de dependencias debe efectuarla Codex en el checkout del proyecto** antes de aprobar merge. Los tests locales con un \`TrustedTokenMeter\` simulado no prueban que el futuro proveedor mida tokens correctamente. Mantener este PR en borrador hasta la revisión técnica y de seguridad.

Ningún comando de este incremento debe desplegar servicios, modificar producción, consumir OpenAI/Aria, crear recursos facturables o hacer merge automático.

## Correctivos P2 del PR #16

### Cuerpo exacto e inmutable

`inspectSupervisedPreflight` captura todos los valores de la solicitud y el método del medidor antes del primer `await`. Valida y mide esa cadena inmutable, aunque el llamador cambie después su objeto. El resultado congelado conserva `serializedRequest`, `requestSha256` (SHA-256 de UTF-8), `requestByteLength` y la caducidad capturada. No devuelve un objeto JSON mutable como cuerpo de transporte. Se rechazan sustitutos Unicode aislados para evitar reemplazos implícitos al codificar.

El contrato del futuro transporte exige enviar **la cadena `serializedRequest` del resultado**, codificada UTF-8, sin reconstruir JSON ni consultar de nuevo el input original. Si una integración necesita otra representación, debe comprobar obligatoriamente su SHA-256 contra `requestSha256` inmediatamente antes del envío y rechazar cualquier diferencia; una comparación de objetos o de tokens no basta. Ese transporte sigue sin implementarse ni conectarse a `runOne`. La prueba usa un transporte local sin red y verifica que mutaciones durante la medición y después de finalizar no cambian los bytes disponibles para enviar. La huella y `PREFLIGHT_ONLY` no conceden permisos ni autorizan gasto.

### Subconjunto cerrado del piloto

Se admiten exclusivamente `model`, `store:false`, `max_output_tokens`, `tools:[]` e `input`; modelo y límite de salida deben coincidir con la configuración inspeccionada. `input` contiene un mensaje `user`, o un mensaje `developer` seguido de `user`, con solo `role` y `content` textual no vacío. No se aceptan mensajes de asistente/sistema, respuestas previas, referencias a items, llamadas de herramientas, archivos, imágenes o bloques de contenido. Es un subconjunto deliberado del API, no soporte de todos sus tipos.

Cualquier propiedad adicional se rechaza antes de medir: por ejemplo `background` (incluso false), `conversation`, `previous_response_id`, `prompt`, `instructions`, `tool_choice`, `parallel_tool_calls`, `truncation` o `service_tier`. Nuevas capacidades requieren revisar el contrato y sus costes; no se habilitan por cambiar JSON.

### Telemetría oficial y conciliación

Se consultó el 23/10/2026 la [referencia oficial de Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), incluida su versión Markdown. El envelope mínimo inspeccionado exige `object:response`, fecha Unix válida, modelo, estado reconocido y array de salida; un resultado completado no puede contener error o detalles de incompletitud. El ID `resp_*` se extrae antes y por separado: un envelope inválido mantiene ese ID, pero no acredita telemetría válida.

El esquema de `usage` contiene `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details` con `cached_tokens` y `cache_write_tokens`, y `output_tokens_details` con `reasoning_tokens`. Se exigen enteros seguros no negativos, total exactamente igual a entrada más salida sin overflow, detalles de caché dentro de la entrada y razonamiento dentro de la salida. Se conservan los detalles validados, sin valores por defecto. Campos de telemetría nuevos o incompatibles requieren conciliación/revisión de contrato, no descarte silencioso.

Uso ausente, nulo, parcial, mal tipado o inconsistente retorna `RECONCILIATION_REQUIRED`, `usage:null` y el ID disponible, incluso si el texto generado es JSON válido. Un error al interpretar texto conserva ID y uso válido. `PARSED_UNVERIFIED` sigue sin acreditar verdad factual, efecto remoto, coste facturado o autorización. Los controles siguen desconectados de proveedores y persistencia; la futura integración debe conservar duraderamente esas evidencias antes de cualquier reintento.

Resultados del correctivo: [evidencias locales](../output/reports/raxi-hq-runtime/SUPERVISED_PREFLIGHT_P2_VALIDATION.md). El PR permanece en borrador y no habilita ejecución real.

La validación completa que figuraba pendiente en la entrega inicial se efectuó en este checkout: instalación reproducible, build y typecheck PASS; 443 pruebas de aplicación más 1 guard de staging, todas PASS y sin omitidas; auditoría de dependencias con cero vulnerabilidades. Las 66 pruebas enfocadas están incluidas en las 443. No se acreditan ejecuciones auténticas mediante estos resultados locales.
