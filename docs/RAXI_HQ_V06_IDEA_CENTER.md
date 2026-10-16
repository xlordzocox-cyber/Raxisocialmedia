# Raxi HQ v0.6 — Centro de Ideas

El Centro de Ideas es un componente lógico separado del Centro de Operaciones (HQ). Reúne **propuestas**, las somete a análisis y aprobación interna, y prepara un handoff mínimo para que HQ decida qué hacer después. No produce contenido final, no aprueba campañas, no genera imágenes y no publica.

```text
Fuentes previstas → Idea Center → APPROVED_FOR_HQ → SENT_TO_HQ → HQ
                                                       ↓
                                      análisis o producción futura, si HQ/Luis lo decide
```

`APPROVED_FOR_HQ` significa únicamente que la propuesta merece revisión por HQ. `SENT_TO_HQ` confirma la entrega de la propuesta; ninguno de los dos estados autoriza producción o publicación. `IdeaHandoffToHQ` transporta datos de la propuesta y referencias de evidencia; **no es un `Campaign` ni crea uno**.

## Contratos y funciones puras

- `apps/raxi-hq/src/ideas/ideaContracts.ts`: `IdeaRecord`, `IdeaEvidence`, `IdeaHandoffToHQ` y uniones canónicas.
- `apps/raxi-hq/src/ideas/ideaValidation.ts`: validación de registros y colecciones, transiciones explícitas y construcción del handoff.
- `apps/raxi-hq/src/ideas/ideaSelectors.ts`: resumen y selectores puros, con empates ordenados por ID.
- `apps/raxi-hq/src/ideas/mockIdeas.ts`: siete ejemplos fijos devueltos con `mode: 'MOCK'`. No son datos LIVE.

Fuentes previstas por contrato: `MANUAL_LUIS`, `TREND_RADAR`, `ANALYTICS`, `EDITORIAL_CALENDAR`, `SUPERMEMORY_INSIGHT` y `EXTERNAL_SIGNAL`. Son etiquetas, no conectores. La idea manual mock no representa una entrada real de Luis; la etiqueta Supermemory no implica que exista una lectura de Supermemory.

Estados: `PROPOSED`, `UNDER_REVIEW`, `APPROVED_FOR_HQ`, `REJECTED`, `ARCHIVED`, `SENT_TO_HQ`. Las transiciones permitidas son:

| Desde | Hacia |
| --- | --- |
| `PROPOSED` | `UNDER_REVIEW` |
| `UNDER_REVIEW` | `APPROVED_FOR_HQ`, `REJECTED`, `ARCHIVED` |
| `APPROVED_FOR_HQ` | `SENT_TO_HQ`, `ARCHIVED` |
| `REJECTED` | `ARCHIVED` |
| `ARCHIVED`, `SENT_TO_HQ` | ninguna |

La prioridad (`LOW`, `MEDIUM`, `HIGH`, `URGENT`) y los scores (`fitScore`, `confidenceScore`, ambos de 0 a 100) no alteran estas reglas. `URGENT` no permite saltar la revisión. Los canales sugeridos (`INSTAGRAM_FEED`, `INSTAGRAM_REEL`, `INSTAGRAM_STORY`, `TEASER`, `FANVIEW_FEED`, `FANVIEW_CHAT`) son planificación, no publicación.

## Límites y seguridad

| Colección o campo | Máximo |
| --- | ---: |
| Ideas por snapshot | 200 |
| Título | 120 caracteres |
| Resumen | 1000 caracteres |
| Razón | 1500 caracteres |
| Tags | 12, de hasta 40 caracteres cada uno |
| Canales sugeridos | 8 |
| Evidencias por idea | 12 |
| Campañas relacionadas | 20 |

El límite de cada colección se comprueba antes de mapear sus registros. Un exceso invalida la colección completa; no hay truncamiento silencioso. Los IDs son no vacíos, acotados y rechazan nombres heredados peligrosos de `Object.prototype`; los selectores usan arrays y comparación explícita, sin acceso por propiedad heredada. No se generan IDs aleatorios ni mediante `Date.now()`.

Los timestamps siguen la gramática ISO estricta usada por el feed canónico v0.5: se rechazan fechas de calendario imposibles y campos horarios fuera de rango, sin normalizarlos ni sustituirlos por la hora local. Las transiciones reciben un timestamp explícito. El mock utiliza únicamente fechas fijas.

`IdeaEvidence` contiene una etiqueta y, opcionalmente, un `sourceRef` **opaco** y un `capturedAt`. La evidencia externa se trata como entrada no confiable: no se ejecutan sus instrucciones, no se obtiene contenido desde `sourceRef`, no se inyecta HTML y no se convierte en prompt de sistema. Los campos desconocidos no se publican al contrato validado. No se inventan URLs ni datos ausentes.

## Fase 1 — contratos, MOCK y alcance

La fase 1 añadió contratos y pruebas, no un modo LIVE para el Centro de Ideas. Los ejemplos se identifican expresamente como `MOCK`; ninguna fuente enumerada está conectada. El Office v0.5 existente conserva sus modos y su comportamiento.

## Fase 2 — campus visual y panel de observación

La vista `RAXI HQ CAMPUS` aparece antes del workspace del Office. Incluye dos edificios originales dibujados con SVG/CSS: **Centro de Operaciones**, que representa el Office v0.5 sin cambiar Pixi, y **Centro de Ideas**, que abre y cierra un panel React. El campus vive en `src/campus/CampusOverview.tsx` y `src/campus/campus.css`; el detalle vive en `src/ideas/IdeaCenterPanel.tsx`. `App.tsx` solo incorpora el campus y conserva la escena del Office.

El edificio muestra conteos calculados con `summarizeIdeas()`. El panel lista ideas con `getIdeasSortedByPriority()`, permite seleccionarlas localmente y muestra detalle, scores, canales, tags y evidencias. Las etiquetas españolas están aisladas en `src/ideas/ideaPresentation.ts`; los valores y contratos canónicos no cambian. La interacción es **solo lectura**: no invoca `transitionIdea()`, `createIdeaHandoff()` ni adapters. Una idea `APPROVED_FOR_HQ` se destaca como propuesta lista para revisión, no como campaña ni autorización de producción.

La única fuente del panel es `loadMockIdeaCenter()`. Se identifica como **Centro de Ideas · MOCK** aunque el Centro de Operaciones esté en `LIVE_READ_ONLY`. No hay fallback ni afirmación de ideas LIVE. `sourceRef` se muestra como texto opaco escapado por React, sin enlaces, HTML inyectado ni solicitudes a su destino.

El edificio interactivo es un botón con `aria-expanded` y `aria-controls`; las ideas son botones seleccionables con `aria-pressed`. El panel tiene nombre accesible, foco visible y un diseño de dos columnas en desktop que se apila en móvil. No se añadió un mapa de campus a Pixi ni se modificaron movimiento, pathfinding, cámara, slots o Source Health.

Siguen fuera de alcance: formulario de entrada manual, fuentes reales de tendencias o analytics, envío real al HQ, creación automática de `Campaign`, Asset Studio, imágenes finales, publishing, FanView/Instagram API e integración real con Munder o Supermemory. El runtime no realiza escrituras externas.
