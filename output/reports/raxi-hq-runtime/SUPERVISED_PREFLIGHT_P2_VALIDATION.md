# PR #16 — tres correctivos P2

Fecha: 23/10/2026. Base revisada `161158511b42a686514ea68b21b5d42d363f9644`. Rama `feature/raxi-hq-supervised-preflight-receipts`; árbol limpio antes de trabajar. La rama remota y el PR se comprobaron antes de editar; no se descartaron modificaciones. PR en borrador, sin merge ni despliegue.

## Evidencia por hallazgo

- **P2-1:** captura sincrónica de modelo, cuerpo, límites, vencimiento y método del medidor. Resultado congelado con cadena exacta, tamaño UTF-8 y SHA-256. Regresiones con medidor asíncrono suspendido, sustitución del objeto/método, mutación posterior, intento de modificar la prueba congelada y transporte local que usa exactamente los bytes medidos. Unicode, escapes y whitespace conservan su huella; sustitutos aislados se rechazan. No se ha implementado transporte real.
- **P2-2:** lista explícita de cinco campos raíz y mensajes mínimos user o developer/user. Pruebas negativas para campo desconocido, segundo plano, conversaciones, respuestas previas, prompt remoto, instrucciones fuera del contrato, elección/paralelismo de herramientas, truncamiento/tier y elementos inválidos de input. Rechazo antes de contactar el medidor. Casos existentes de herramientas no vacías, almacenamiento, modelo/cap distintos y JSON inválido conservados.
- **P2-3:** esquema consultado en la [referencia oficial Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) el 23/10/2026; recuperación efectiva de su Markdown público, sin llamadas de inferencia. Se valida envelope mínimo, objetos de detalles y totales exactos, incluyendo caché de escritura/lectura y razonamiento. Regresiones negativas de envelope, objetos ausentes/arrays, tipos/cantidades inválidos, overflow, detalles superiores a totales y total mayor/menor que la suma. ID separado y `usage:null` si falta evidencia; coste facturado nunca inferido. Cero es admisible únicamente cuando todos los campos auténticos están presentes con cero.

## Validación del checkout

Instalación reproducible `npm ci --ignore-scripts --no-audit`: PASS (166 paquetes). Build y typecheck: PASS. Suite completa: **443/443**, guard de staging separado: **1/1**, total **444/444**, cero fallos, canceladas u omitidas. Suite enfocada de helpers: **66/66** (forma parte de las 443, no se suma otra vez). `npm audit --json`: cero vulnerabilidades. Diff y control local de patrones de secretos: PASS en cuatro archivos; no hay archivos rastreados en `.validation`. Se ejecutan fixtures/transportes locales; no acreditan tokenización auténtica, comunicación con OpenAI, Auth alojado, Edge o workers.

Logs locales: `pr16-install.log`, `pr16-build.log`, `pr16-typecheck.log`, `pr16-tests.log`, `pr16-focused-tests.log`, `pr16-guard.log` y `pr16-audit.json`. La consulta GitHub anterior a publicar confirmó `draft:true` y HEAD revisado `1611585`. No se cambia el estado de borrador. Revisión del cambio limitada a helpers, regresiones y documentación; no se afirma una auditoría de servicio desplegado.

No se cambia `runOne`, `openAIProvider`, SQL, configuración de despliegue ni permisos. No se consumió OpenAI/Aria, activó trabajador, creó infraestructura o modificó producción. Auxiliares/logs de `.validation` excluidos del commit. El futuro host continúa pendiente de autorización, infraestructura y pruebas aisladas; estos helpers solo preparan evidencia y conciliación.
