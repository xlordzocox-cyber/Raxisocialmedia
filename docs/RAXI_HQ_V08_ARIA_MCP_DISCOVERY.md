# Raxi HQ v0.8 — descubrimiento de Aria Studio MCP

Comprobación de lectura realizada desde Codex el 18 de octubre de 2026. El MCP respondió a `mis_personajes` y `modelos`; no se consumieron créditos durante el descubrimiento. Aria Studio es el proveedor exclusivo autorizado para fotografías nuevas de Raxi.

| Herramienta real | Permiso/propósito | Entrada relevante | Salida y límite comprobable |
|---|---|---|---|
| `mis_personajes` | Lectura de perfiles | Ninguna | Identificador `raxi-vox` para Raxi Vox. La ficha visual existente reside en Aria; el HQ no la reconstruye. |
| `modelos` | Lectura de disponibilidad y precio | Ninguna | `gptimg` (GPT Image 2.5) disponible; USD 0.039 `std`, USD 0.165 `high` por imagen en la consulta. También reportó `seedream`. El modelo por defecto indicado por la cuenta (`qwen`) figuraba como no disponible, por lo que hay que pasar el modelo explícitamente. |
| `saldo` | Lectura de disponibilidad de crédito/cuentas | Ninguna | Informa saldo y conexiones sin revelar claves. Estos valores son privados y variables: no se guardan aquí. |
| `generar_imagen` | **Escritura con coste**: una imagen | `personaje`, `escena`, `modelo?`, `calidad?`, `formato?`, `nsfw?` | Devuelve ID y precio real de la ejecución. Para este piloto: `raxi-vox`, `gptimg`, `std`, `3:4`, `nsfw: false`. No se llamó durante esta auditoría. |
| `estado_imagen` | Lectura de ejecución | `id` devuelto por generación | Al completar devuelve imagen y enlace temporal de 24 horas. Se debe consultar cada 15–20 segundos tras ejecutar. |
| `mis_creaciones` | Lectura de creaciones | `n?`, `con_imagen?` | Puede ayudar a reconciliar un resultado ambiguo antes de reintentar; no prueba por sí solo que pertenezca a una orden de HQ. |

Los nombres y parámetros anteriores provienen de las herramientas expuestas en la sesión Codex, no de una API HTTP supuesta. El precio es una observación, no una autorización ni garantía futura: se consulta de nuevo justo antes de generar y se comunica a Luis. El precio real devuelto por `generar_imagen` se registra después. No hay evidencia aún de un ID ni imagen producida para este piloto.

El descubrimiento de solo lectura no comprobó que `estado_imagen` permita recuperar los bytes originales de la fotografía. Antes de cualquier QA, Codex debe verificar el ID y obtener el archivo real de esa ejecución, calcular su SHA-256 sobre los bytes completos y adjuntarlo al recibo. Si solo dispone de una URL o vista previa sin bytes confiables, deja `imageSha256` ausente; HQ permanece en `VISUAL_REVIEW_REQUIRED`. El hash demuestra coincidencia de archivos, no autentica por sí solo a Aria Studio.

## Ejecución desde otra aplicación

OpenAI documenta el [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) para workflows programáticos y el [Codex app-server](https://learn.chatgpt.com/docs/app-server) para clientes con conversaciones, herramientas y aprobaciones. La documentación de app-server enumera `mcpServerStatus/list` y `mcpServer/tool/call`. Eso no demuestra que este navegador, este checkout o un proceso nuevo hereden la conexión Aria y sus credenciales de Codex Desktop. No se probó una autenticación, aislamiento ni confirmación de coste para una integración directa.

Por ello v0.8 usa **handoff controlado**: HQ exporta una orden validada con snapshot de campaña y Strategy aprobada; Luis la autoriza; Codex revisa el JSON, revalida precio y pide consentimiento para la llamada con coste; Codex invoca el MCP real; el resultado se registra en un manifiesto que se importa en HQ para QA. React no puede invocar el MCP, no expone credenciales y no presenta un JSON importado como prueba criptográfica del proveedor.
