# Raxi HQ — Diseño actual y hoja de ruta (documento maestro)

> **Fecha:** 2026-11-22. **Autor:** Claude, con las decisiones de Luis.
> **Para quien ejecute esto (Claude Code):** este documento es el mapa general. Cada fase con plan propio enlaza a su archivo en `docs/superpowers/plans/`; las fases sin plan se planifican con Superpowers (`brainstorming` → diseño aprobado por Luis → `writing-plans` → `subagent-driven-development`). **No escribas código de una fase sin plan aprobado por Luis.** Respeta `AGENTS.md`.
> **Rama de trabajo actual:** `feat/v11-mcp`. Contiene, apilados, `feat/claude-team-office`, `feat/v11-conexiones`, `feat/v11-talento`, `feat/v11-creador` y `feat/v11-continuidad`.

---

## 1. Qué es Raxi HQ

Raxi HQ es el panel interno de Luis para operar a sus modelos virtuales, **Vesper Corvus** (prioridad) y **Raxi Vox**, como una agencia de producción de fotos y video para redes. Cubre:

- Identidad versionada de cada modelo.
- Fichas 360.
- Creación de fotos con WaveSpeed.
- Recrear fotos objetivo.
- Series de continuidad.
- Archivo (Fototeca y Multimedia).
- Conexión segura de proveedores.
- Pronto: un MCP para que Claude opere la plataforma y un creador de videos.

**Canales:**
- **Instagram:** público. Fotos únicas como formato principal y reels de vez en cuando.
- **Fanvue:** feed NSFW y chats de pago, que son el negocio principal a futuro.

**Historia de Vesper:** gótica, sangre latina, **vive en Monterrey** y viaja a lugares góticos del mundo. Primer viaje: Praga, en enero de 2027.

## 2. Reglas permanentes (no negociables)

**Seguridad y entornos**
- Nunca guardar, pedir ni registrar contraseñas, claves de API, tokens ni secretos. La clave de WaveSpeed la introduce solo Luis, en **Conexiones**, y solo se lee en el servidor.
- **Staging:** Supabase `zvhxjindgyvtasstfjut`. **Producción (`jrkefsylpfriiqefcmzq`) no se toca.**
- Desplegar en staging solo con la autorización de Luis. Al desplegar Edge Functions por MCP, se envían **todos** los archivos de la función y se verifica con `get_edge_function` contra el repo.
- Las reglas se aplican **en el servidor**, nunca solo en la interfaz ni en las instrucciones de un agente.

**Contenido** (`AGENTS.md`, sección «Nivel de contenido por superficie»)
- **Niveles:** público, NSFW (feed de Fanvue) y EXPLICIT (chats de Fanvue). Nada baja de nivel, y las referencias adultas nunca se usan para contenido público.
- Las modelos siempre se ven claramente adultas y nunca son personas reales.
- **Claude no escribe prompts sexuales explícitos ni lanza generaciones NSFW.** Luis escribe la parte adulta.
- Antes de la primera publicación en Fanvue se verifican sus normas vigentes sobre contenido generado con IA.

**Costos**
- Cada generación de pago necesita el clic explícito de Luis sobre el precio mostrado. Con el MCP, se usará un presupuesto semanal aprobado en el panel (Fase 4).
- **Tope de $10 USD al mes en WaveSpeed**, controlado en la base de datos. Ver la decisión pendiente D2 sobre el video.
- La idempotencia es obligatoria: el mismo pedido nunca cobra dos veces.

**Método**
- No inventar. Todo dato externo (precios, endpoints, límites) se verifica en la documentación oficial y se anota con fecha y enlace. Si dos fuentes no coinciden, se prueba y se anota.
- TDD: rojo, verde, refactor. `npm run typecheck` y `node scripts/test.mjs` en verde antes de cada commit.

## 3. Estado actual (verificado el 2026-11-22)

### 3.1 Pantallas (`apps/raxi-hq`, Vite + React 19 + react-router 7.18.4 + supabase-js 2.118.0)

| Ruta | Pantalla | Estado |
|---|---|---|
| `/` | Agencia: portada con el rediseño «editorial de agencia» | Funciona |
| `/estudio` | Oficina animada de agentes | Funciona, sección aparte |
| `/talento`, `/talento/:id` | Fichas 360, interruptor NSFW, identidad versionada y bloqueo en dos pasos | Funciona |
| `/talento/:id/creador` | Creador de ficha 360 con WaveSpeed (M2) | Funciona |
| `/recrear`, `/recrear/:id` | Recrear: foto objetivo + modelo, modo **con prompter** (unos $0.02) o **manual**, y Fanvue híbrido | Funciona; es la herramienta más usada |
| `/series/:id` | Series de continuidad (M3) | Funciona; se usa poco porque se priorizan fotos únicas |
| `/comparar` | Prueba A/B ciega de identidad (se eligió Seedream 5.5; FLUX-PuLID desactivado) | Funciona |
| `/fototeca` | Archivo de fotos por canal | Funciona |
| `/multimedia` | Archivo multimedia | Funciona |
| `/conexiones` | Clave de WaveSpeed guardada de forma segura | Funciona |

### 3.2 Edge Functions en staging

| Función | Versión | `verify_jwt` | Nota |
|---|---|---|---|
| `sheet-creator` | v17 | true | Motor de fichas, Recrear, series y prompter. Verificada contra el repo (commit `4c17d39`). |
| `raxi-agent-runner` | v14 | **false** | **Le falta el punto «piel» de `photoSpec`.** Desplegar cuando se necesite una serie. |
| `talent-reference` | v4 | true | Subida de referencias 360. |
| `provider-connection` | v1 | true | Conexiones. |
| `campaign-command`, `create-real-idea`, `supervised-campaign-request` | v3 | true | Pipeline de campañas. |
| `raxi-archive-aria` | v3 | **false** | Archivo de Aria. |
| `raxi-secrets-check`, `raxi-model-check` | v2 / v1 | **false** | **Parecen herramientas de diagnóstico; revisar (Fase 0).** |

### 3.3 Identidad
- **Vesper:** v4 **bloqueada**. Piel muy clara con subtono frío-neutro, poros, pecas y vello fino. Busto US 34DD. Cabello negro azabache largo y ondulado. Ojos grises. Labios vino (naturales solo en escenas de «despertar»). Cruz de plata con piedra roja. Unos 173 cm.
- **Raxi Vox:** **sin texto fijo en staging.** Faltan sus rasgos para aplicar el realismo de piel.

### 3.4 Ramas y PR
- Cadena apilada, **sin fusionar a `main`**: #80 `feat/claude-team-office` → `main`; #81 conexiones; #82 creador; #83 continuidad. Sobre esa cadena está `feat/v11-mcp`, que solo añade documentos.
- Hay PR antiguos abiertos (#62–#79, de la etapa «issue60/64/66/49») que quedaron desfasados.

### 3.5 Planes ya escritos
- `docs/superpowers/plans/2026-11-19-mcp-raxi-creation-fase-1.md`: MCP de solo lectura.
- `docs/superpowers/plans/2026-11-19-saldo-wavespeed.md`: barra de saldo y piloto de Astryx.
- Diseño del MCP: Claude Doc «MCP raxi-creation — Diseño v2».
- Diseño original del módulo: `docs/superpowers/specs/2026-11-16-creation-module-design.md`, en la rama `docs/v11-creation-module-spec`, **que no está fusionada en `feat/v11-mcp`**.

## 4. Hoja de ruta por fases

Orden recomendado. Cada fase termina con pruebas en verde, despliegue en staging autorizado y prueba real con Luis.

| Fase | Qué | Plan | Depende de |
|---|---|---|---|
| **0** | Consolidación y limpieza | Por escribir (corto) | — |
| **1** | MCP `raxi-creation`, solo lectura | ✅ Escrito | 0 |
| **2** | Barra de saldo de WaveSpeed y piloto de Astryx | ✅ Escrito | 0 |
| **3** | Fototeca: «Objetivos y muestras» | Por escribir | 0 |
| **4** | MCP Fase 2: producción con presupuesto semanal | Por escribir | 1, 3 |
| **5** | **Creador de videos** con WaveSpeed | Diseño en §5, plan por escribir | 2, decisión D2 |
| **6** | Rediseño completo con Astryx (migración progresiva) | Por escribir | Resultado del piloto en 2 |
| **7** | Mejoras de Recrear y del motor | Por escribir (corto) | 0 |
| **8** | Biblioteca de Lugares (Monterrey y viajes) | Por escribir | 3 |
| **9** | Calendario de publicación y analítica | Por escribir | 6 |
| **10** | MCP Fase 3: series y campañas | Por escribir | 4 |

### Fase 0 — Consolidación y limpieza
1. **Fusionar la cadena apilada** (#80 → #83 y luego `feat/v11-mcp`) siguiendo el orden que Luis decida (decisión D1), para que `main` refleje lo que funciona en staging.
2. **Cerrar o archivar los PR antiguos (#62–#79)**, previa revisión con Luis, para que no confundan a los agentes.
3. **Auditar las funciones con `verify_jwt = false`.**
   - Si `raxi-secrets-check` y `raxi-model-check` son de diagnóstico, proponer a Luis eliminarlas de staging.
   - `raxi-agent-runner` y `raxi-archive-aria`: documentar cómo se autentican; si no lo hacen, corregirlo.
4. **Fusionar la rama `docs/v11-creation-module-spec`** (diseños y planes M1–M3) para tener toda la documentación en un solo lugar.

### Fase 1 — MCP solo lectura
Ver su plan. Herramientas: `personajes`, `identidad`, `fotos`, `ver_foto` y `presupuesto`. Usa OAuth 2.1 de Supabase con la cuenta de Luis, **solo nivel público** y registra cada llamada.

**Prerrequisitos en el panel de Supabase:**
- Claves JWT asimétricas (ES256 o RS256).
- Site URL de Auth.
- Servidor OAuth activado, con registro dinámico de clientes.

### Fase 2 — Barra de saldo y piloto de Astryx
Ver su plan. La barra muestra el saldo real de WaveSpeed por su API (la clave solo en el servidor), el gasto del mes frente al tope y cuántas fotos quedan aproximadamente. **Es la pantalla piloto de Astryx.**

### Fase 3 — Fototeca: «Objetivos y muestras» (aprobado por Luis, 2026-11-18)
- Una sección nueva de la Fototeca donde Luis sube fotos objetivo y de muestra: poses, lugares, prendas.
- Recrear y el MCP las eligen desde ahí, sin tener que subirlas cada vez.
- Cada imagen lleva:
  - **etiquetas:** pose, lugar, prenda, ciudad;
  - **origen:** propia, o de internet como referencia;
  - **nivel:** público o adulto.
- Las de nivel adulto nunca aparecen para el MCP.

### Fase 4 — MCP Fase 2, producción
Herramientas: `preparar_foto` (cotiza), `generar` (de 1 a 2 versiones, cobra del presupuesto), `estado`, `elegir` y `descartar`.

**Presupuesto semanal:**
- Luis lo aprueba en el panel. Propuesta inicial: $1.00 por semana.
- Vence el domingo y lo no gastado no se acumula.
- El servidor lo descuenta y frena al llegar a cero.

**Sin herramientas para:** aprobar presupuesto, claves, borrar ni publicar.

### Fase 5 — Creador de videos (ver §5)

### Fase 6 — Rediseño con Astryx
- **Solo si el piloto de la Fase 2 sale bien.** Migración pantalla por pantalla en una rama aparte, empezando por las más usadas: Recrear, Fototeca y Talento. Antes de cada pantalla, Luis aprueba una captura o maqueta.
- Mantener la dirección «editorial de agencia» con un tema propio (`defineTheme`), no los colores de Meta.
- **Nada que funcione hoy puede dejar de funcionar:** las pruebas de cada pantalla siguen en verde.
- **Prioridad en el móvil:** Luis usa Raxi HQ desde el teléfono. Los botones y mensajes importantes deben verse sin desplazarse.
  - Ejemplo de lo que hay que evitar: hoy el error de Recrear sale al final de la página.

### Fase 7 — Mejoras de Recrear y del motor
1. **Error visible junto al botón de crear.** Hoy aparece al final de la página y Luis no lo ve en el móvil.
2. **Inicio del prompt automático.** Si al prompt cinematográfico le falta «Cinematic photograph», añadirlo solo, o avisar junto al campo.
3. Desplegar `raxi-agent-runner` con el punto «piel» cuando se use una serie.
4. **Raxi Vox:** crear su versión de identidad cuando Luis dé sus rasgos.

### Fase 8 — Biblioteca de Lugares
- Lugares reales con foto de referencia, para que las fotos se vean fieles:
  - **Monterrey:** Barrio Antiguo, mercado de antigüedades, Panteón del Carmen, Obispado, Fundidora;
  - **destinos de viaje:** Praga, Edimburgo, París, Transilvania y otros.
- Cada lugar lleva:
  - fotos de referencia, enlazadas a «Objetivos y muestras»;
  - una descripción para el prompt;
  - la temporada o el viaje al que pertenece;
  - notas de QA: qué suele inventar la IA de ese lugar.
- **Lección aprendida:** con una foto real del lugar como foto objetivo y el prompt «conserva el lugar de la foto», el resultado se reconoce. Con solo el nombre, la IA inventa.

### Fase 9 — Calendario de publicación y analítica
- **Calendario:** qué se publica cada día, con su texto bilingüe, hashtags y estado (programado o publicado). Hoy se lleva a mano en el chat.
- **Analítica:** registrar a mano, o por una conexión futura, las estadísticas de cada post (alcance, origen, seguidores) para ajustar horarios y formatos con datos. **No publicar automáticamente en Instagram** sin una decisión explícita de Luis.

### Fase 10 — MCP Fase 3
Series y campañas desde el MCP, con las mismas reglas de las fases 1 y 4.

## 5. Creador de videos (diseño propuesto, pendiente de aprobación)

### 5.1 Objetivo
Generar reels cortos (de 5 a 12 s, vertical 9:16) de las modelos **dentro de Raxi HQ con WaveSpeed**, para dejar de depender de Magnific, que Luis cancelará. Con el mismo control de costos, archivo y QA que las fotos.

### 5.2 Lo aprendido con Magnific (noviembre de 2026, probado en 6 videos)
| Técnica | Resultado |
|---|---|
| **Partir de una foto aprobada como fotograma inicial** (de imagen a video) | ✅ **La identidad se mantiene.** Es la técnica principal. |
| Generar solo con referencias, sin fotograma inicial, y con cortes entre tomas | ❌ La cara cambia, sobre todo en los cortes. |
| Primeros planos extremos de la cara | ❌ Cambian ojos, cara y pecas. **Evitarlos.** Como mucho, plano de cintura para arriba. |
| Una sola toma continua, sin cortes | ✅ Más fiel. |
| Kling: movimiento suave por defecto | Hay que pedir el movimiento de forma explícita (cámara que se acerca, gestos concretos) y añadir «static camera, frozen pose» a lo que no se quiere. |
| Seedance: más dinámico y con audio propio | Mejor para un reel estrella; más caro. |
| El modelo amplía la sonrisa al final | Pedir «lips closed, never showing teeth» y añadir «wide smile, teeth» a lo que no se quiere. |

### 5.3 Modelos y precios (WaveSpeed, consultados el 2026-11-19; **verificar antes de programar**)
| Modelo | Endpoint (verificar) | Precio documentado |
|---|---|---|
| Kling 2.5 Turbo Std, de imagen a video | `kwaivgi/kling-v2.5-turbo-std/image-to-video` (verificado en su documentación) | $0.21 por 5 s, $0.42 por 10 s |
| Kling 2.5 Turbo Pro, de imagen a video | Probablemente `kwaivgi/kling-v2.5-turbo-pro/image-to-video` (**sin verificar**) | $0.35 por 5 s, $0.70 por 10 s |
| Seedance 2.5, de imagen a video | `bytedance/seedance-2.5/image-to-video` (página del modelo) | 480p $0.90 por 5 s; 720p ×2 ($1.80); 1080p ×5 |

WaveSpeed avisa de que los precios de la documentación son orientativos y que manda el cobro real. **La cotización debe usar la tabla `raxi_provider_prices` y registrar el costo real de cada trabajo.**

### 5.4 Flujo
1. Luis elige en la Fototeca una **foto aprobada** de nivel público.
2. Elige un **modelo**: Kling Pro por defecto; Seedance para un reel estrella.
3. Elige la duración (5 o 10 s; hasta 12 s en Seedance).
4. **Escribe el movimiento.** Lo hace Luis, o lo propone el prompter (opcional, con su costo de unos $0.02). La plantilla aplica las lecciones de §5.2: una sola toma, sin primeros planos extremos, la cara igual que en el primer fotograma, labios cerrados y movimiento de cámara explícito.
5. **Cotización** con el precio exacto y clic de Luis.
6. Generación asíncrona: trabajo, consulta del estado y tiempo límite.
7. **Archivo** en Storage (mp4, sha256, duración, modelo y costo real) y entrada en Multimedia.
8. **QA:** la pantalla muestra fotogramas a varios tiempos para revisar cara, manos y escote. Luis elige o descarta.

### 5.5 Reglas del servidor
- **Solo nivel público** en esta versión. El video para Fanvue queda fuera de alcance; si algún día se hace, la parte adulta la escribe Luis y lleva su propia aprobación.
- Siempre parte de una foto **archivada y aprobada** de la misma modelo. No se aceptan URLs externas como fotograma inicial.
- Tope de costo según la decisión D2, idempotencia y registro de cada trabajo.
- La clave de WaveSpeed solo se usa en el servidor.

### 5.6 Componentes propuestos
- **Migración `raxi_video_jobs`:**
  - `id`, `workspace_id`, `character_id`, `level`;
  - `source_asset_id` (la foto inicial), `model`, `duration_s`, `resolution`, `prompt`, `negative_prompt`;
  - `quote_mills`, `cost_mills`, `wavespeed_job_id`, `status`;
  - `object_path`, `sha256`, `created_by`, `created_at`.
  - RLS de lectura para el dueño; escritura solo por la service role.
- **Edge Function nueva, `video-creator`**, que reutiliza el cliente de WaveSpeed de `_shared`. La alternativa es añadir acciones a `sheet-creator`, pero esa función ya es grande; se decide en el brainstorming.
- **Interfaz:** botón «Animar» en cada foto de la Fototeca y página `/video/:id` con la cotización, el estado, el reproductor y los fotogramas de QA. Los videos terminados se ven en Multimedia.
- **Integración con el MCP (Fase 4 o posterior):** `animar_foto` y `ver_video`, con las mismas reglas del presupuesto semanal.

### 5.7 Por verificar al escribir el plan
- Endpoints exactos, parámetros (duración, resolución, audio, prompt negativo) y formato de salida de cada modelo.
- Si la proporción del video sale de la imagen o hay que indicarla.
- El tamaño máximo de imagen de entrada (Kling: 10 MB según su documentación).
- Cuánto tarda en generarse, para fijar el tiempo límite y la frecuencia de consulta.

## 6. Decisiones pendientes de Luis

| # | Decisión | Opciones / recomendación |
|---|---|---|
| D1 | Cómo fusionar la cadena #80 → #83 y `feat/v11-mcp` a `main` | Recomendación: en orden, uno por uno, después de revisar cada PR |
| D2 | Presupuesto para el video | El tope actual de $10 al mes alcanza para unos 14 clips de Kling Pro de 10 s, o solo 2–3 reels de Seedance a 720p. Opciones: un tope aparte para video (por ejemplo, $5 al mes) o subir el tope total |
| D3 | ¿Se eliminan `raxi-secrets-check` y `raxi-model-check` de staging? | Recomendación: sí, si son de diagnóstico |
| D4 | ¿Se cierran los PR antiguos #62–#79? | Recomendación: archivarlos tras revisarlos |
| D5 | ¿Se migra todo a Astryx? | Se decide después del piloto de la Fase 2 |
| D6 | Rasgos de Raxi Vox para su identidad | Pendiente de Luis |

## 7. Glosario rápido
- **Recrear:** foto objetivo + identidad bloqueada → foto nueva de la modelo en esa escena.
- **Prompter:** Claude Sonnet propone el prompt (unos $0.02); el modo manual lo escribe Luis.
- **Ficha 360:** vistas de cara y cuerpo de la modelo. La general (con ropa interior uniforme) define la identidad; la adulta es solo para Fanvue.
- **QA:** identidad, manos, texto raro, transparencias, escote, que no se filtre la ropa de la referencia y coherencia del lugar.
