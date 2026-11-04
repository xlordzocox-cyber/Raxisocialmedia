# P3B — Avisos y bloqueos · Oficina

Base verificada: `1f37743945bd32d68fdbe3ed80459d781911cc7f`, con P1/P2A/P2B/P3A integrados. Rama/worktree aislados `feature/raxi-hq-agent-signals`. PR39 sigue independiente y las diez eliminaciones JPEG del checkout original no forman parte del incremento.

## Arquitectura

El selector puro `office/ui/agentSignalsSelectors.ts` deriva exclusivamente de HQState admitido: condiciones actuales, historial, advertencias de referencias y disponibilidad/procedencia. El panel `AgentSignalsPanel.tsx` se monta junto a P2A/P2B en App, separado de P3A. No crea stores, suscripciones, transportes, permisos, incidentes ni decisiones. No modifica HQState, tareas, runtime, Auth/RLS o contratos de dominio.

Se reutilizan `getOwnAgent`, `officeAgentView`, `taskOwnerMetadata` y `taskBoardView` para identidad y relaciones. Un `currentTaskId` sigue siendo una referencia descriptiva, no prueba de asignación o ejecución. No se inventan propietarios, campañas, assets, revisores ni fechas. Nombres de agentes solo se muestran con identidad de diccionario coherente. Alias/IDs duplicados o discordantes generan advertencias; no se selecciona una versión ganadora.

`office/declarationContext.ts` extrae literalmente los dos predicados de contexto que ya usaba handoffPolicy. P2B ahora reutiliza este helper sin cambiar su política de animaciones. La revisión independiente comparó las expresiones originales del commit base con el helper en 216 combinaciones de modo/mockMode/modo de health/fuente/conexión: 216 resultados idénticos. Esa comprobación auxiliar no se suma al número de tests de aplicación.

La inspección llama exclusivamente a la selección y enfoque P1 existentes. Antes del callback se revalida la identidad del snapshot, el scope, la presencia coherente del agente y la elegibilidad actual de la fila. Callbacks antiguos tras cuenta/fuente/snapshot/desmontaje quedan inertes. El efecto de montaje solo controla esa vigencia; no registra suscripciones ni temporizadores.

## Clasificación conservadora

| Registro | Clasificación |
| --- | --- |
| Agente BLOCKED / FAILED / QUARANTINED | Bloqueo / fallo / restricción declarados |
| WAITING y variantes explícitas | Espera declarada |
| APPROVAL_REQUIRED, AUTH_REQUIRED, RATE_LIMITED, CIRCUIT_BREAKER_OPEN, VISUAL_REVIEW_REQUIRED, PUBLISH_BLOCKED, QUARANTINED | Requisito de revisión / seguridad / límite / restricción declarados |
| READ_ONLY y WRITE_DISABLED | No crean una alerta por sí solos |
| Tarea BLOCKED / FAILED | Bloqueo / fallo declarados |
| approvalRequired:true | Requisito declarado, nunca aprobación humana pendiente acreditada |
| COMPLETED, CANCELED o mock-ready | No crean bloqueo por sí solos; no se inventa clasificación de tokens abiertos |

El historial incluye AGENT_BLOCKED, QA_REQUESTED, QA_FAIL, VISUAL_REVIEW_REQUIRED, APPROVAL_REQUIRED, SECURITY_STATE_CHANGED, MEMORY_SAVE_FAILED y como contexto QA_PASS/APPROVAL_GRANTED. Son registros declarados, no problemas vigentes derivados ni aprobación humana autenticada. Se preserva el orden admitido; no se correlacionan ni cierran señales por agente, tarea, fecha o proximidad. Cada evento mantiene ID/tipo/timestamp/fuente/referencias originales. No se renderizan label o payload arbitrarios.

La UI explica bloqueo, espera, revisión, fallo e historial mediante texto, sin severidades/urgencias inventadas. El vacío dice **Sin señales de estas categorías en el snapshot disponible**, sin afirmar que toda la operación está libre de problemas.

## Procedencia y disponibilidad

- MOCK requiere modo, mockMode y SourceHealth coherentes y conectados. Todas las filas mantienen DEMO/MOCK, aunque el evento tenga verified:true o una etiqueta aria/github/supermemory/munder.
- LIVE requiere el contexto Munder LIVE_READ_ONLY conectado ya admitido. Se muestra **Estado declarado por la fuente · sin verificación independiente de ejecución**. verified no concede confianza adicional.
- LIVE desconectado/degradado o inconsistente retira condiciones e historial de la vista vigente: **No hay información LIVE vigente para confirmar avisos o bloqueos**. No hay fallback MOCK.
- HISTORICAL_REPLAY no ofrece avisos de Raxi. La captura Codex admitida describe un ejecutor externo histórico, no QA, bloqueos o aprobaciones de los agentes Raxi.

No se añade un sondeo ni se inventa un límite de antigüedad: la disponibilidad deriva del contexto admitido del store. Una fuente silenciosa o metadatos conectados no prueban ejecución actual; esa limitación permanece explícita. Las entradas inconsistentes conservan referencias y advertencias; la inspección se retira cuando no hay coherencia suficiente.

### RuntimeOfficePanel: análisis separado, sin integración

RuntimeOfficeStore valida workspace/owner y ciertas estructuras, filtra tareas simuladas y eventos sin AGENT_EXECUTOR/VERIFIED/simulated:false. Su proyección utiliza ACKNOWLEDGED más lease y tarea RUNNING para representar ejecución; RESULT_COMMITTED se proyecta como TASK_COMPLETED. Otros eventos aceptados utilizan un fallback visual AGENT_BLOCKED. Ese nombre genérico **no demuestra por sí solo un bloqueo operativo específico**, ni reemplaza la semántica original del evento/recibo/tarea.

P3B rechaza sourceHealth.source runtime. Antes de admitirlo haría falta revisar por separado la matriz de tipos nativos, alcance, temporalidad, procedencia, incertidumbre y pérdida de conexión. No se cambia ese código, se habilita ejecución ni se interpreta su clasificación como incidente confirmado. Guardian automático no se modifica ni se declara activo.

## Corrección recuperada de la revisión independiente

La revisión local detectó que un diccionario de campañas con entrada canónica `c` y alias con el mismo id podía dejar inspectId habilitado. El selector ahora verifica identidad global de campañas y advierte sobre las referencias presentes en evento, tarea y participantes, incluso si event.campaignId falta. La regresión dedicada conserva las referencias pero retira la inspección de filas afectadas. La revisión independiente confirmó el correctivo y ejecutó 79/79 tests P3B. No se amplió la autoridad de la vista.

## Validación ejecutada

La sesión anterior dejó 846/846 PASS en registro completo; se conservó ese registro y se ejecutó de nuevo la suite al retomar. Resultado nuevo del 4 de noviembre de 2026: **846/846 aplicación PASS**, incluidos **79 tests P3B** y **340 focalizados P1/P2A/P2B/P3A/observador/P3B**; staging guard offline **1/1 PASS**, para **847 tests totales**. Cero fallos/omitidos/cancelados. Typecheck, build, diff y controles de secretos/rutas protegidas PASS.

`npm ci --ignore-scripts` desde lockfile se ejecutó en la preparación conservada; no cambió dependencias. Auditoría actualizada: solo el advisory moderado preexistente qs, cero high/critical. No se corrigieron dependencias dentro de este incremento.

Autorización explícita del usuario para P3B: **Sí, solo SQL local de la suite existente**. Solo se ejecutó ese SQL sintético local (PGlite). Sin Docker, SQL alojado, migraciones, usuarios reales, proveedores, Aria, gasto, despliegues o publicaciones. GitHub se usa exclusivamente para entregar/revisar el cambio de código.

Desde `apps/raxi-hq`:

```text
npm test
node --test .validation/agentSignals.test.mjs
node --test .validation/agentSignals.test.mjs .validation/office.test.mjs .validation/officeUX.test.mjs .validation/taskBoard.test.mjs .validation/handoffTimeline.test.mjs .validation/humanAttention.test.mjs .validation/executionObservation.test.mjs
node --test tests/stagingSafety.test.mjs
npm run typecheck
npm run build
npm audit --json
git diff --check
```

Los bundles focalizados proceden de scripts/test.mjs. Los logs quedan ignorados localmente; se documentan fingerprints para contraste sin publicar secretos ni logs privados.

| Registro | SHA-256 |
| --- | --- |
| p3b-resumed-full.log | `0ffcd96661539b85c7aed13f21cbee62b8402d9914a9ddbf4a948a012e11ed78` |
| p3b-recovered-focused.log | `f0a3865d698d7754dd35568c3b99a0896e8c34a43ebc08d2a9838aa691d9dd82` |
| p3b-recovered-guard.log | `7866a218083b6331eb1ba48fb6cad62260e9648c4bc898450b4e34b7fc4e0d4a` |
| p3b-resumed-typecheck.log | `236189c12f0a4a176be02a7e6dae4a48b84cf0bc7b101374891c5d1457577ede` |
| p3b-resumed-build.log | `bc4d41226d109ba7c9b233a110ef61ff884b4c636df9512a5ab4b2e021eb4bc7` |
| p3b-audit.json | `e5f34547f0af478c4918deed42013f3a55f67da8284ed208dd14059a99beb485` |

## QA visual de navegador

Laboratorio `tests/manual/agentSignals.html`: todos los datos, modos y repositorios son fixtures sintéticos; no acredita conexión auténtica. Escritorio 1440×1000 y móvil390×844 (ancho documento375, sin desbordamiento horizontal observado). Enter sobre Inspeccionar agente cambia el inspector de B a A. Se mantienen foco visible, textos además de color y controles44px. No se añaden animaciones ni smooth scroll, compatible con movimiento reducido sin nuevos temporizadores.

Al retirar las condiciones actuales, QA_FAIL/QA_PASS permanecen como dos registros históricos y la sección actual queda vacía. LIVE desconectado/degradado retira todas las filas y no inicia MOCK. Restablecer un escenario vuelve a derivar únicamente del snapshot disponible. La App existente también se probó con su fixture Auth y la captura histórica auténtica admitida: P3B no atribuye señales de Raxi a esa captura.

Hubo una advertencia createRoot durante hot reload del laboratorio de desarrollo; una recarga limpia posterior no registró nuevos errores. No se añadió un workaround al entrypoint productivo. El ensayo no certifica lectores de pantalla ni dispositivos físicos.

- [DEMO escritorio](../output/reports/raxi-hq-agent-signals/demo-desktop.jpg)
- [LIVE sintético con historial declarado](../output/reports/raxi-hq-agent-signals/live-declared-history.jpg)
- [LIVE desconectado](../output/reports/raxi-hq-agent-signals/live-disconnected.jpg)
- [Contexto histórico sin atribuciones](../output/reports/raxi-hq-agent-signals/historical-no-raxi-signals.jpg)
- [DEMO móvil](../output/reports/raxi-hq-agent-signals/mobile-demo.jpg)
- [App con captura histórica admitida](../output/reports/raxi-hq-agent-signals/app-historical.jpg)

## Riesgos, revisión y reversión

Los contratos preparados y las pruebas no acreditan agentes o fuentes operativos. Las condiciones del snapshot dependen de la admisión existente; los timestamps no prueban vigencia de un incidente. MemoryArchiveEffect y sus garantías de confianza permanecen fuera de alcance, documentados como revisión separada. Se conserva el pendiente independiente de qs.

Revertir este incremento restaura la presentación anterior; no hay datos, permisos o infraestructura que revertir. La revisión local y la revisión GitHub del SHA publicado son pasos separados, sin autoridad de merge. Mantener PR en borrador y detenerse para aprobación humana.
