# Módulo de Creación — M3: Series de continuidad — Plan de implementación

> **Para quien ejecute esto:** usa `superpowers:subagent-driven-development` (o `executing-plans`), en orden y con TDD (prueba en rojo → código → verde). Cada paso lleva casilla `- [ ]`.
> **Estado:** PLAN PROPUESTO. El diseño se aprobó con 4 ajustes (Luis, 2026-11-17). No hay código. Requiere el visto bueno de Luis antes de ejecutarse.

## Decisiones que este plan implementa

**Del diseño aprobado el 2026-11-16** (`docs/superpowers/specs/2026-11-16-creation-module-design.md`, §3 y §5), se mantiene:
- Una foto base aprobada por Luis.
- Fotos 2..N del mismo momento, generadas con WaveSpeed.
- Una aprobación por serie completa, con techo de costo y el tope de $10 al mes.
- Cada foto usa como referencias la ficha de la identidad bloqueada más la foto base. **Sin encadenar** una foto con la anterior.
- Idempotencia: el mismo pedido nunca cobra dos veces.
- El MCP (M4) no podrá aprobar series.

**Ajustes aprobados por Luis el 2026-11-17:**
1. **Mismo motor que el creador de fichas (M2).** Se reutilizan cotización en milésimas, libro de costos en las tomas, tope en la base de datos, reclamo atómico de tomas, consulta del estado y clave de Conexiones. No se crea un motor paralelo.
2. **La serie empieza en una foto de la Fototeca.** Cualquier foto archivada de la modelo puede ser la base, incluidas las de Aria que ya están importadas. Generar una base nueva en Aria sigue siendo el flujo actual de campaña.
3. **Referencias según el nivel de la serie:**
   - Pública (Instagram, Stories, teaser): foto base + cara de frente y cuerpo de frente de la ficha **general**.
   - Fanvue: además puede usar el cuerpo de frente de la ficha **adulta**.
   - Una serie nunca baja de nivel respecto a su foto base (`AGENTS.md`).
4. **Cada foto lleva su momento.** A cada foto se le añade siempre "misma ropa, peinado, maquillaje, lugar y luz que la imagen 1".
   - Las escenas de series públicas las propone Claude y Luis las edita.
   - Las de Fanvue NSFW o EXPLICIT las escribe Luis.
   - Claude no escribe escenas explícitas ni lanza series adultas.

## Hechos verificados que este plan usa

**WaveSpeed — página oficial de `bytedance/seedream-v5.5/edit`, 2026-11-17**
- Hasta 10 imágenes de entrada.
- Si `aspect_ratio` va vacío, conserva la proporción de la primera imagen. La foto base va primera, así que la serie mantiene su encuadre.
- Precio: $0.02 por foto en 1k más $0.008 por cada imagen de entrada.

**Raxi HQ — staging y ramas `feat/v11-creador` y `feat/claude-team-office`**
- Ya existen `raxi_portfolio_collections`, con `channel` en `INSTAGRAM`, `INSTAGRAM_STORY`, `TEASER`, `FANVUE_FEED` o `FANVUE_CHAT`, y `raxi_portfolio_items`, con `asset_id`, QA y decisión humana.
- El motor de M2 (`sheet-creator`, `raxi_sheet_takes`, `raxi_sheet_create_run`/`add_take`, `raxi_reference_supersede`) funciona en staging con cobros reales. Al 2026-11-17 hay 25 tomas, ninguna fallida, y $1.156 estimados en el mes.
- La identidad solo admite referencias generales vigentes (migración `20261118020000`). Vesper tiene la v3 bloqueada con sus 6 vistas generales.

**Pendiente de verificar**
- Que el cargo real de WaveSpeed coincida con el estimado. Luis tiene que compararlo en su panel antes de la primera serie real.

## Costo de una serie (1k)

| Serie | Entradas por foto | Por foto | Serie de 4 | Serie de 6 |
|---|---|---|---|---|
| Pública | base + cara general + cuerpo general = 3 | $0.044 | $0.176 | $0.264 |
| Fanvue | lo anterior + cuerpo adulto = 4 | $0.052 | $0.208 | $0.312 |

Cada "Otra versión" de una foto se cotiza aparte, con el mismo precio por foto.

## Arquitectura

- **Lógica compartida** en `supabase/functions/_shared/generation/`. Se mueven ahí, sin cambiar su comportamiento, `wavespeed.ts`, la cotización y el ciclo de las tomas: reclamar, enviar, consultar, guardar y reemplazar.
  - `sheet-creator` las importa desde allí. Sus pruebas deben seguir en verde sin cambios.
- **Migración nueva:**
  - `raxi_series` con:
    - `id`, `workspace_id`, `character_id`, `channel` y `level` (calculado del canal).
    - `base_asset_id`, `identity_version` (la bloqueada vigente) y `ref_asset_ids`.
    - `scenes jsonb` (2 a 6 escenas, de 300 caracteres como máximo cada una).
    - `ceiling_mills`, `attested_not_real`, `collection_id` y `status`.
  - Las tomas se guardan en `raxi_sheet_takes`, generalizada con:
    - `series_id` como alternativa a `run_id` (exactamente uno de los dos).
    - `shot_no` en lugar de `view` para las series.
    - El tope y el gasto del mes siguen siendo uno solo para fichas y series.
  - `raxi_series_create(p_actor, p_series, p_takes)` (solo `service_role`) comprueba:
    - Hay identidad bloqueada.
    - La base es de la modelo y su nivel es menor o igual que el de la serie.
    - Todas las referencias son vigentes y de un nivel permitido.
    - Techo de la serie ≥ costo total, y el tope mensual.
- **Edge Function `series-creator`** (`verify_jwt = true`). Acciones:
  - `QUOTE`, `START` (el clic con el total visto es la aprobación) y `STATUS`.
  - `RETAKE` (una foto, con instrucción opcional).
  - `CHOOSE`: crea o actualiza el `raxi_portfolio_items` de la colección de la serie en la posición de la foto, con `asset_id`, `content_level` y QA `VISUAL_REVIEW_REQUIRED`.
  - `LATEST`.
  - Todas las fotos se envían en paralelo: no hay ancla, porque la base ya existe.
- **Prompt de cada foto:** texto de la identidad bloqueada + "Same outfit, hairstyle, makeup, location and lighting as image 1; same woman as the reference images." + la escena + la instrucción de "Cambiar", si la hay.
- **Interfaz:**
  - Botón "Crear serie" en cada foto de la Fototeca.
  - Página `/series/:id` con la base a la izquierda, las escenas editables, el canal, el costo y "Crear serie · $x". Debajo, una tarjeta por foto con "Otra versión", "Cambiar" y "Elegir".
  - Series de Fanvue: el interruptor NSFW apagado por defecto oculta sus fotos. Las escenas adultas solo se editan con el interruptor encendido.
  - Las fotos elegidas aparecen en la colección y siguen el flujo de Fototeca (QA, decisión, publicación).
- **Escenas propuestas por Claude:** solo para canales públicos.
  - En M3 se hace desde el chat: Claude prepara las escenas y Luis las pega o edita.
  - En M4 llegará la herramienta MCP `preparar_serie`, que solo crea un borrador sin coste.

**Rama de trabajo:** `feat/v11-continuidad`, desde `feat/v11-creador`.

**Reglas que ninguna tarea puede romper:**
1. Ninguna referencia adulta en una serie pública. Lo comprueban la base de datos y el handler, cada uno con su prueba.
2. Una serie nunca baja de nivel respecto a su foto base.
3. Ninguna llamada a WaveSpeed sin `START` aprobado y su reserva en el tope.
4. Las pruebas existentes (1050) siguen en verde sin tocar sus aserciones.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/functions/_shared/generation/{wavespeed,pricing,takes}.ts` (nuevos, movidos) | Motor común |
| `supabase/functions/sheet-creator/*` (modificar) | Importa el motor común |
| `supabase/migrations/20261118030000_raxi_hq_continuity_series.sql` (nuevo) | `raxi_series`, generalización de tomas, RPCs |
| `supabase/functions/series-creator/{seriesPlan,seriesPrompts,handler,index}.ts` (nuevos) | Series |
| `apps/raxi-hq/src/series/{seriesModel.ts,SeriesPage.tsx,SeriesRoute.tsx,series.css}` (nuevos) | Interfaz |
| `apps/raxi-hq/src/portfolio/FototecaPage.tsx` (modificar) | Botón "Crear serie" |
| `apps/raxi-hq/tests/series.test.ts`, `tests/seriesUI.test.tsx` (nuevos) | Pruebas |

---

### Tarea 0: Rama y línea base
- [ ] `git switch -c feat/v11-continuidad feat/v11-creador`. Ejecuta `npm test`, `tsc`, `build` y `deno check` de las 3 funciones, y anota los resultados.

### Tarea 1: Extraer el motor común (refactor sin cambio de comportamiento)
- [ ] Mueve `wavespeed.ts`, la cotización y el ciclo de las tomas a `_shared/generation/`. `sheet-creator` lo importa.
- [ ] Las pruebas de `sheetCreator.test.ts` siguen en verde **sin cambiar sus aserciones**.
- [ ] `deno check` en verde. Commit.

### Tarea 2: Plan de la serie (puro)
- [ ] **Pruebas (rojas):**
  - El canal da el nivel: `INSTAGRAM`, `INSTAGRAM_STORY` y `TEASER` → `PUBLIC`; `FANVUE_FEED` → `NSFW`; `FANVUE_CHAT` → `EXPLICIT`.
  - Una base `NSFW` con canal `INSTAGRAM` se rechaza (no se baja de nivel).
  - Las referencias de una serie pública son base, cara general y cuerpo general. En Fanvue se añade el cuerpo adulto, si existe.
  - La cotización de 4 escenas públicas da 176 milésimas y la de 6 de Fanvue, 312.
  - Hay de 2 a 6 escenas, de 1 a 300 caracteres cada una.
- [ ] Implementa `seriesPlan.ts`. Verde. Commit.

### Tarea 3: Prompts de la serie
- [ ] **Pruebas (rojas):** cada prompt empieza con la identidad bloqueada, contiene "Same outfit, hairstyle, makeup, location and lighting as image 1" y termina con la escena. La instrucción de "Cambiar" va al final, con 300 caracteres como máximo. Un prompt de más de 4000 caracteres se rechaza.
- [ ] Implementa `seriesPrompts.ts`. Verde. Commit.

### Tarea 4: Migración
- [ ] **Pruebas (rojas)** con PGlite:
  - `raxi_series_create` rechaza:
    - una serie sin identidad bloqueada;
    - una base de otra modelo o de nivel superior al de la serie;
    - una referencia `NSFW` en una serie pública;
    - una referencia retirada;
    - un techo menor que el total;
    - superar el tope mensual, que se comparte con las fichas.
  - Una toma tiene `run_id` o `series_id`, nunca los dos.
  - `authenticated` solo puede leer.
- [ ] Escribe la migración y añádela a la lista de exclusión de `campaignDatabase.ts`, con su comentario. Verde. Commit.

### Tarea 5: Handler `series-creator`
- [ ] **Pruebas (rojas)** con dependencias falsas:
  - Sesión, roster, casilla de "no es persona real" y precio recalculado (409 si cambió).
  - Sin la clave de WaveSpeed → 412, sin reservar nada.
  - `START` reserva la serie completa y envía todas las fotos con la base como primera imagen.
  - `STATUS` guarda las imágenes en `${ws}/series/${id}/${shot}/${n}.png`.
  - `RETAKE` cotiza una foto.
  - `CHOOSE` crea o actualiza el ítem de la colección con el nivel correcto.
  - Dos `STATUS` simultáneos nunca envían dos veces la misma foto.
  - Ninguna respuesta contiene la clave.
- [ ] Implementa `handler.ts` e `index.ts`, y añade `[functions.series-creator] verify_jwt = true`. Verde. Commit.

### Tarea 6: Interfaz
- [ ] **Pruebas (rojas):**
  - "Crear serie" aparece en las fotos de la Fototeca.
  - El botón "Crear serie · $0.176" está desactivado hasta tener escenas válidas y la casilla marcada.
  - Si el canal es de Fanvue, las fotos se ocultan con el interruptor NSFW apagado.
  - Una base adulta no ofrece canales públicos.
  - Cada foto tiene "Otra versión · $x", "Cambiar" y "Elegir".
  - El medidor del mes es el mismo que el del creador de fichas.
- [ ] Implementa `seriesModel.ts`, `SeriesPage.tsx`, `SeriesRoute.tsx` y `series.css` (solo tokens) y añade las rutas. Verde. Commit.

### Tarea 7: Verificación y staging
- [ ] Ejecuta todas las pruebas, `tsc`, `build` y `deno check`. Haz mutaciones de las reglas 1 a 3: los tests deben detectarlas.
- [ ] **Solo con la autorización de Luis:** aplica la migración y despliega en staging. Verifica los permisos con SQL, en una transacción que se deshace. Producción no se toca.
- [ ] **Piloto, lanzado por Luis desde la interfaz:**
  - Una serie de Vesper para Fanvue.
  - Una serie de Raxi para Instagram, cuando su identidad esté bloqueada.
  - En ambas: comparar el estimado con el cargo en el panel de WaveSpeed y pasar el Quality Gate de `AGENTS.md`.
- [ ] Actualiza Supermemory y la sección 8 del spec, y abre el PR hacia `feat/v11-creador`.

## Fuera de M3
- MCP `raxi-creation` (M4): cotizar y preparar borradores de serie, nunca aprobarlos ni lanzar series adultas.
- Video y cambios de ropa o de lugar dentro de una misma serie: una serie es un solo momento.
