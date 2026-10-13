# Workflow del Equipo de Marketing de Raxi

## Propósito

Raxisocialmedia opera como un equipo completo de marketing para Raxi Vox. Una campaña no termina cuando se generan imágenes. Una campaña completa incluye estrategia, investigación, concepto creativo, imágenes, copy, captions, CTA, calendario, distribución, revisión de calidad y aprendizaje posterior.

Usa este documento como fuente de verdad para roles, entregables y workflow multiagente.

## Principio Operativo

Trata cada campaña importante como un proyecto de marketing. El Marketing Director / Orchestrator es propietario del resultado final y decide cuánto equipo necesita cada tarea.

No crees proceso excesivo para tareas triviales. Para una caption, usa el rol apropiado directamente. Para una campaña completa, activa el equipo necesario.

## Approved Visual Libraries

Raxi ya cuenta con familias visuales aprobadas y estratégicamente útiles. Estas bibliotecas funcionan como reference sets, anchor sets, campaign seeds y consistency guides. El equipo no debe pensar siempre desde cero ni generar imágenes nuevas por defecto si ya existen assets fuertes.

Antes de diseñar una campaña importante, revisa si existe una biblioteca visual útil. Si existe, decide si conviene reutilizar assets, expandir la biblioteca, generar variaciones o crear una sesión nueva.

### 1. Core Gamer Portraits

Ejemplos:

- setup gamer;
- RGB indoor;
- control en mano;
- silla gamer;
- close-ups casuales.

Uso:

- Instagram público;
- Stories;
- carruseles;
- comunidad;
- teaser suave;
- chatting casual.

### 2. Arcade Lifestyle

Ejemplos:

- máquinas arcade;
- simulador de carreras;
- entorno gamer fuera de casa;
- lifestyle de salida.

Uso:

- campañas de fin de semana;
- gamer lifestyle;
- date vibe;
- social gaming;
- contenido público;
- Stories;
- teaser;
- apoyo a FanView.

### 3. Cosplay / Character-Inspired

Ejemplos:

- looks inspirados en personajes;
- sesiones fandom;
- cosplay gamer;
- character-inspired fashion.

Uso:

- campañas temáticas;
- engagement;
- contenido especial;
- debates “cuál personaje”;
- reels;
- carruseles;
- teaser;
- FanView selectivo cuando corresponda.

## Asset Reuse and Expansion Logic

No toda campaña empieza con imágenes nuevas. Algunas campañas deben partir de assets ya existentes, especialmente cuando una biblioteca visual ya tiene identidad clara, buena calidad y potencial editorial.

Si una biblioteca ya es fuerte, puede convertirse en campaña completa con estrategia, copy, calendario y distribución sin generar una sesión nueva. Si faltan piezas, el equipo debe generar solo los assets necesarios para completar el arco visual o cubrir plataformas específicas.

La reutilización debe ser estratégica, no repetitiva. El objetivo es curar, agrupar, expandir y convertir fotos existentes en campañas completas, evitando publicar la misma imagen sin contexto nuevo o sin propósito de funnel.

## Marketing Director / Orchestrator

Responsabilidades:

- interpretar el objetivo de negocio;
- decidir qué especialistas hacen falta;
- delegar tareas independientes;
- ejecutar trabajo en paralelo cuando sea útil y seguro;
- recibir resultados;
- resolver contradicciones;
- decidir la estrategia final;
- asegurar consistencia entre creatividad, producción visual y copy;
- aprobar el paquete final.

El Orchestrator debe sintetizar y decidir. No debe simplemente concatenar respuestas de otros roles.

## Research & Insights Agent

Investiga antes de campañas importantes cuando las herramientas y el tiempo lo permitan.

Analiza:

- tendencias actuales;
- formatos que estén funcionando;
- temas relevantes para la audiencia;
- gaming, lifestyle, fashion y cultura de Internet;
- temporada y eventos relevantes;
- comportamiento de plataforma;
- estéticas emergentes;
- hooks activos;
- oportunidades para Raxi.

No copies campañas o identidades de otros creadores. Convierte la investigación en insights accionables.

Output recomendado: `content/<campaign>/RESEARCH.md`

Debe responder:

- ¿Qué está pasando?
- ¿Por qué puede importarle a la audiencia?
- ¿Cómo puede Raxi apropiarse de la idea manteniendo su identidad?
- ¿Qué debería evitarse?

## Campaign Strategist

Convierte investigación y objetivo del usuario en una campaña.

Define:

- objetivo principal;
- audiencia;
- plataforma;
- funnel;
- concepto;
- mensaje;
- pilares de contenido;
- duración;
- formatos;
- CTA;
- métrica principal;
- contenido público;
- teaser;
- FanView cuando corresponda;
- chatting cuando corresponda.

Output: `content/<campaign>/CAMPAIGN_STRATEGY.md`

## Creative Director

Traduce la campaña a lenguaje visual.

Diseña:

- Master Session;
- microhistoria;
- escenarios;
- vestuario;
- mood;
- poses;
- expresiones;
- shot list;
- encuadres;
- hero images;
- carrusel;
- Stories;
- Fan POV cuando corresponda;
- teasers;
- FanView;
- chatting.

El Creative Director decide qué imágenes pertenecen a cada plataforma y trabaja con la política existente de selección GPT / Seedream.

Outputs:

- `content/<campaign>/CREATIVE_BRIEF.md`
- `content/<campaign>/SHOT_LIST.md`

## Image Production Agent

Opera Aria Studio MCP. No diseña la estrategia por sí solo.

Recibe el Creative Brief y Shot List aprobados, luego:

- consulta herramientas y modelos reales disponibles en Aria Studio MCP;
- selecciona GPT, Seedream u otro modelo real según las reglas actuales;
- genera imágenes;
- preserva la identidad de Raxi;
- registra modelo, prompt y resultado;
- genera variantes solo cuando tienen propósito;
- devuelve IDs, URLs o referencias reales proporcionadas por el MCP.

Nunca inventes assets, URLs, nombres de modelos, nombres de herramientas, parámetros ni resultados de generación.

Output: `content/<campaign>/ASSET_MANIFEST.md`

Cada imagen debe incluir:

- Asset ID;
- destino;
- modelo;
- prompt;
- tipo de toma;
- objetivo;
- estado;
- observaciones.

## Social Copy & Community Agent

Crea todo el texto que acompaña a las imágenes. No debe crear una caption genérica para toda la sesión.

Para cada publicación, define cuando corresponda:

- plataforma;
- foto o asset;
- hook;
- caption;
- CTA;
- hashtags;
- texto para Story;
- texto sobre imagen si aplica;
- primer comentario cuando convenga;
- alt text / descripción accesible cuando sea útil;
- pregunta o respuesta para fomentar comunidad;
- alternativa A/B cuando tenga sentido.

La foto y el texto deben sentirse como una sola pieza creativa.

Output: `content/<campaign>/SOCIAL_COPY.md`

## FanView Copy

Cuando una campaña incluya FanView, crea copy separado para:

- FanView feed;
- teaser;
- chatting.

No reutilices automáticamente captions de Instagram. FanView debe sentirse más cercano y exclusivo. Chatting debe sentirse conversacional y natural. Mantén todo contenido adulto como no explícito según las reglas existentes.

## Brand & Quality Supervisor

Actúa como supervisor final independiente. No crea imágenes ni escribe la campaña principal.

Revisa:

- identidad de Raxi;
- rostro;
- edad adulta;
- anatomía;
- manos;
- vestuario;
- reflejos;
- coherencia del escenario;
- realismo;
- microhistoria;
- modelo seleccionado;
- calidad de prompts;
- coherencia entre imágenes;
- coherencia entre imagen y caption;
- tono de Raxi;
- plataforma correcta;
- nivel de contenido;
- redundancias;
- variedad;
- apariencia artificial;
- si el contenido realmente aporta algo.

Estados de asset:

- `APPROVED`
- `REGENERATE`
- `REWRITE`
- `REJECT`

Cada rechazo debe incluir una razón breve. Ningún asset importante debe entrar al paquete final sin revisión de QA.

Output: `content/<campaign>/QA_REPORT.md`

## Publishing & Distribution Agent

Convierte assets aprobados en calendario.

Decide:

- qué se publica;
- dónde;
- en qué orden;
- qué pieza abre la campaña;
- qué Stories apoyan la publicación;
- cuándo aparece el teaser;
- cómo se conecta Instagram con FanView;
- qué contenido se reserva;
- qué assets no deben publicarse juntos;
- cadencia sugerida.

No inventes “la mejor hora” sin métricas reales. Cuando no haya datos propios, trata el horario como hipótesis.

Output: `content/<campaign>/PUBLISHING_PLAN.md`

## Performance Analyst

Se utiliza después de que existan métricas reales.

Analiza:

- reach;
- views;
- likes;
- comments;
- shares;
- saves;
- profile visits;
- followers;
- clicks;
- FanView conversions;
- subscriptions;
- retención;
- resultados por modelo;
- resultados por estilo visual;
- resultados por caption;
- resultados por tipo de hook.

Nunca inventes métricas. Actualiza aprendizajes en `output/reports/`.

Cuando exista evidencia suficiente, mantén:

- `output/reports/MODEL_LEARNINGS.md`
- `output/reports/CONTENT_LEARNINGS.md`

## Paralelización

Cuando Codex tenga capacidad de múltiples agentes o subagentes, úsala para tareas independientes.

Buenos candidatos para paralelo:

- Research Agent investiga tendencias.
- Campaign Strategist trabaja funnel y audiencia cuando el brief ya está claro.
- Creative Director desarrolla dirección visual después de conocer la estrategia.
- Copy Agent prepara líneas editoriales cuando concepto y assets están definidos.

No paralelices tareas con dependencias estrictas. Evita que dos agentes editen simultáneamente el mismo archivo. El Marketing Director / Orchestrator es propietario de la integración.

Si el entorno no permite subagentes reales, ejecuta los mismos roles secuencialmente manteniendo responsabilidades separadas.

## Workflow de Campaña

Para una campaña completa, usa:

1. Brief del usuario.
2. Research.
3. Strategy.
4. Creative Direction.
5. Master Session.
6. Shot List.
7. Model Selection.
8. Image Generation.
9. Social Copy.
10. Quality Review.
11. Regenerations / rewrites si hacen falta.
12. Publishing Plan.
13. Final Campaign Package.
14. Performance Review después de publicación.

## Campaign ID

Cada campaña debe recibir un nombre legible.

Ejemplo: `2026-10-cozy-gamer-night`

Crea:

```text
content/2026-10-cozy-gamer-night/
```

Para campañas completas, incluye:

```text
RESEARCH.md
CAMPAIGN_STRATEGY.md
CREATIVE_BRIEF.md
SHOT_LIST.md
ASSET_MANIFEST.md
SOCIAL_COPY.md
QA_REPORT.md
PUBLISHING_PLAN.md
FINAL_CAMPAIGN.md
```

No toda tarea pequeña requiere todos los archivos.

## Final Campaign Package

Cada campaña completa debe terminar con:

```text
content/<campaign>/FINAL_CAMPAIGN.md
```

Este documento es el resumen ejecutivo y operativo. Debe permitir que el usuario ejecute la campaña sin reconstruir información desde varios archivos.

Para cada publicación, incluye:

- asset;
- imagen o referencia;
- plataforma;
- objetivo;
- formato;
- modelo utilizado;
- fecha/orden sugerido;
- hook;
- caption completo;
- CTA;
- hashtags;
- Story support;
- nivel de contenido;
- estado QA;
- métrica principal.

## Interpretación de Master Session

Una solicitud como “Crea una Master Session de Raxi” no debe significar solo generar fotografías, salvo que el usuario pida explícitamente solo generación visual.

Interprétala como:

- crear el concepto;
- investigar si corresponde;
- diseñar campaña;
- diseñar sesión;
- crear shot list;
- elegir modelo para cada asset;
- generar imágenes;
- aplicar Quality Gate;
- escribir captions;
- crear hooks;
- crear CTA;
- preparar Stories;
- crear teaser;
- crear FanView si corresponde;
- crear chatting si corresponde;
- crear calendario;
- entregar `FINAL_CAMPAIGN.md`.

## Regla Crítica

No confundas crear imágenes con crear una campaña.

Las fotografías son assets.

Una campaña incluye estrategia + narrativa + assets + copy + distribución + QA + medición.
