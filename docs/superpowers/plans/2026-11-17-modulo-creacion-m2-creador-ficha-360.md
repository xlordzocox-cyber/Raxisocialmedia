# Módulo de Creación — M2: Creador de ficha 360 — Plan de implementación

> **Para quien ejecute esto:** usa `superpowers:subagent-driven-development` (o `executing-plans`) y sigue las tareas en orden, con TDD (prueba en rojo → código → verde). Cada paso lleva casilla `- [ ]`.
> **Estado:** PLAN PROPUESTO. No hay código escrito. Requiere el visto bueno de Luis antes de ejecutarse.

## Decisiones de Luis que este plan implementa (2026-11-17)

1. **Flujo tipo Aria:** Luis sube de 1 a 3 fotos de la modelo, y la ficha 360 completa se crea sola a partir de ellas.
2. **Vistas:** las de la cara, más las del cuerpo **sin la cabeza** (así funciona mejor, como en Aria). Las poses del cuerpo son naturales, de pie y nada sexualizadas.
3. **Orden:** primero se genera la cara de frente y luego, en automático, el resto de vistas, usando como referencia ese frente y las fotos subidas. Así la cara no se reinterpreta en cada vista.
4. **Ficha adulta:** se activa con el interruptor NSFW (apagado por defecto), se basa en la ficha general ya elegida y usa por defecto `bytedance/seedream-v5.5/edit`. Es solo para Fanvue (`AGENTS.md`).
5. **Gasto:**
   - Cada creación muestra su costo antes de pulsar, y el clic es la aprobación.
   - Hay un tope de $10 USD al mes (diseño del 2026-11-16).
   - Antes de generar hay una casilla obligatoria: "es un personaje creado con IA, no una persona real".

## Hechos verificados que este plan usa

**WaveSpeed — página oficial de `bytedance/seedream-v5.5/edit`, consultada el 2026-11-17**
- Envío: `POST https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.5/edit`.
- Consulta del resultado: `GET https://api.wavespeed.ai/api/v3/predictions/{id}/result`.
- Parámetros:
  - `prompt` (obligatorio).
  - `images` (obligatorio): URLs o Base64, hasta 10.
  - `aspect_ratio` (opcional; vacío = la proporción de la primera imagen).
  - `resolution`: `1k`, `1.5k` o `2k` (por defecto `1k`).
  - `output_format`: `png` o `jpeg`.
- Precio por imagen de salida: $0.02 en `1k` y `1.5k`, $0.035 en `2k`. Cada imagen de entrada suma $0.008.
- La página advierte que sus precios pueden estar desactualizados y que manda el cargo final de la tarea.
- La página **no** lista ningún parámetro de seguridad o NSFW. Eso no confirma que el modelo acepte desnudos: se comprueba con la primera toma adulta (Tarea 9).

**Repositorio, ramas `feat/v11-talento` y `feat/claude-team-office`**
- `raxi_assets.kind` admite `'REFERENCE'`. El ángulo y el nivel viven en `metadata` y no tienen restricción en la base de datos.
- `raxi_identity_lock` exige una referencia con `angle = 'FRONT'` y `content_level = 'PUBLIC'`.
- La clave de WaveSpeed se lee solo con `raxi_connection_secret` (`service_role`).

**Sin verificar (no se activa hasta confirmarlo)**
- Precio de `seedream-v5.0-pro/edit`: queda en la lista pero desactivado hasta leer su página oficial.
- Si la respuesta de WaveSpeed trae el costo real cobrado. Mientras no se confirme, el libro de costos guarda el **costo estimado** con la tarifa vigente y su fecha.

## Objetivo de M2

En `/talento/:id/creador`, Luis crea la ficha 360 de una modelo así:
1. Sube sus fotos.
2. Ve el costo y pulsa "Crear ficha".
3. Se genera la cara de frente y después, solas, el resto de vistas.
4. En cada vista puede pedir "Otra versión", "Cambiar" (con una instrucción) o "Subir la mía", y "Elegir" la toma buena.
5. Las tomas elegidas pasan a ser referencias de Talento (M1). Desde ahí Luis bloquea la identidad como ya hace.
6. Con el interruptor NSFW encendido, la ficha adulta se crea igual a partir de la ficha general elegida.

## Vistas

| Clave | Ficha | Qué muestra | Ancla de la cadena |
|---|---|---|---|
| `FRONT` | General | Cara de frente, expresión neutra | **Sí** (se genera primero) |
| `THREE_QUARTER` | General | Cara a tres cuartos | No |
| `PROFILE` | General | Cara de perfil | No |
| `BODY_FRONT` | General y adulta | Cuerpo de frente, sin cabeza, de pie, pose natural | Ancla de la ficha adulta |
| `BODY_SIDE` | General y adulta | Cuerpo de lado, sin cabeza, de pie | No |
| `BODY_BACK` | General y adulta | Cuerpo de espalda, sin cabeza, de pie | No |

- **Ficha general:** las 6 vistas, con ropa.
- **Ficha adulta:** solo las 3 vistas del cuerpo. La cara es la misma de la ficha general, así que no se paga dos veces (recomendación, confírmala, Luis).
  - Su ancla es `BODY_FRONT`. Si el modelo rechaza esa primera toma, la cadena se detiene antes de gastar en las otras dos.
- `FRONT` se mantiene como clave de la cara de frente para que el bloqueo de M1 siga funcionando sin cambios.

## Costo por ficha (con las tarifas verificadas, en `1k`)

Costo de una toma: `salida + 0.008 × entradas`.

| Ficha | Cálculo | Total |
|---|---|---|
| General | Cara de frente: 1–3 fotos subidas. Las otras 5 vistas: frente + 1–3 fotos subidas | **$0.208 a $0.304** |
| Adulta | 3 vistas, con cara de frente + cuerpo de frente generales + 1 foto subida | **≈ $0.108** |

Cada "Otra versión" o "Cambiar" se cotiza aparte, con el mismo cálculo.

## Arquitectura

- **Base de datos** (migración nueva):
  - `raxi_provider_prices`: tarifa por modelo y resolución, con fecha de verificación y un campo `enabled`.
  - `raxi_sheet_runs`: una creación, con su modelo, nivel, fotos de origen y la casilla de "no es persona real" registrada.
  - `raxi_sheet_takes`: cada toma, con su vista, número, prompt, estado, `prediction_id`, ruta de la imagen y si fue elegida.
  - `raxi_generation_ledger`: el libro de costos.
  - `raxi_ledger_reserve(...)`: solo `service_role`. Bloquea con `pg_advisory_xact_lock`, suma el gasto del mes UTC y rechaza si la reserva pasa de $10.
  - `authenticated` solo puede leer; toda escritura pasa por la función.
- **Edge Function `sheet-creator`** (`verify_jwt = true`), con el handler sin imports de Deno para probarlo en Node. Acciones:
  - `QUOTE`: calcula el costo sin gastar.
  - `START`: el cliente envía el total que vio. El servidor lo recalcula y rechaza si no coincide, si falta la casilla o si pasa el tope. Envía solo la toma ancla.
  - `STATUS`: consulta las predicciones pendientes. Cuando una termina, descarga la imagen al bucket privado. Cuando el ancla termina, envía el resto de vistas.
  - `RETAKE`: "Otra versión", o "Cambiar" con una instrucción de 300 caracteres como máximo.
  - `CHOOSE`: registra la toma como `raxi_assets` con `kind = 'REFERENCE'`, su ángulo y su nivel (`PUBLIC` para la general, `NSFW` para la adulta).
  - "Subir la mía" reutiliza `talent-reference` de M1.
  - El handler no espera a que WaveSpeed termine dentro de la petición: el cliente consulta `STATUS` cada 3 s. Así ninguna llamada se acerca al límite de tiempo de las Edge Functions.
- **Imágenes hacia WaveSpeed:** URLs firmadas del bucket privado que caducan en 15 minutos. Nunca son públicas.
- **Prompts** (módulo puro `sheetPrompts.ts`):
  - `identidad bloqueada (fixed_prompt, si existe)` + `plantilla de la vista` + `instrucción de Cambiar (si la hay)`.
  - Las plantillas generales y las adultas son textos fijos versionados en el código.
  - La plantilla adulta es de **desnudo artístico de referencia anatómica**: de pie, pose neutra, luz de estudio, sin connotación sexual. Luis puede reemplazarla por su propio texto en la interfaz; ese texto se guarda en la creación.
- **Seguridad:**
  - La clave de WaveSpeed nunca sale del servidor ni se registra.
  - Las tomas adultas solo se muestran con el interruptor NSFW encendido y nunca entran en Multimedia ni en la portada.
  - Nada adulto puede llegar a contenido público.
  - El MCP de M4 no podrá lanzar creaciones adultas: esas siempre las lanza Luis desde la interfaz.

**Rama base:** `feat/v11-talento`. **Rama de trabajo:** `feat/v11-creador`.

**Reglas que ninguna tarea puede romper:**
1. Ninguna llamada a WaveSpeed sin una creación aprobada con el clic de Luis y la reserva en el libro de costos.
2. El tope de $10 al mes lo hace cumplir el servidor, no la interfaz.
3. Las pruebas no llaman a WaveSpeed: usan un `fetch` falso.
4. Las pruebas existentes siguen en verde sin tocar sus aserciones.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261118000000_raxi_hq_sheet_creator.sql` (nuevo) | Tablas, RLS, `raxi_ledger_reserve`, `raxi_ledger_settle`, tarifas verificadas |
| `supabase/functions/sheet-creator/sheetPlan.ts` (nuevo) | Vistas, cadena, cotización (puro) |
| `supabase/functions/sheet-creator/sheetPrompts.ts` (nuevo) | Plantillas y armado del prompt (puro) |
| `supabase/functions/sheet-creator/wavespeed.ts` (nuevo) | Cliente de envío y consulta con `fetch` inyectado |
| `supabase/functions/sheet-creator/handler.ts`, `index.ts` (nuevos) | Acciones y cableado de Deno |
| `supabase/functions/talent-reference/handler.ts` (modificar) | Ángulos `BODY_FRONT`, `BODY_SIDE`, `BODY_BACK` |
| `supabase/config.toml` (modificar) | `[functions.sheet-creator] verify_jwt = true` |
| `apps/raxi-hq/src/talent/talentModel.ts` (modificar) | Ángulos nuevos y sus etiquetas |
| `apps/raxi-hq/src/creator/creatorModel.ts`, `SheetCreatorPage.tsx`, `CreadorRoute.tsx`, `creator.css` (nuevos) | Interfaz del creador |
| `apps/raxi-hq/src/talent/TalentProfilePage.tsx` (modificar) | Botón "Crear ficha 360" |
| `apps/raxi-hq/src/auth/AuthRoutes.tsx` (modificar) | Ruta `/talento/:id/creador` |
| `apps/raxi-hq/tests/sheetCreator.test.ts`, `tests/creator.test.tsx` (nuevos); `scripts/test.mjs` (modificar) | Pruebas |

---

### Tarea 0: Rama y línea base
- [ ] `git switch -c feat/v11-creador feat/v11-talento`
- [ ] Ejecuta `npm test`, `npx tsc --noEmit` y `npm run build` en `apps/raxi-hq`, y anota el número de pruebas en verde.

### Tarea 1: Ángulos del cuerpo
- [ ] **Prueba (roja):** `buildTalentProfile` acepta referencias con `BODY_FRONT`, `BODY_SIDE` y `BODY_BACK`, y `talent-reference` acepta esos ángulos y sigue rechazando `HEAD`.
- [ ] Añádelos a `ANGLES` y `ANGLE_LABEL` ("Cuerpo de frente", "Cuerpo de lado", "Cuerpo de espalda") y al `Set` del handler.
- [ ] Verde. Commit: `feat(talento): ángulos de cuerpo para la ficha 360`.

### Tarea 2: Plan de la ficha y cotización (puro)
- [ ] **Pruebas (rojas)** en `tests/sheetCreator.test.ts`:
  - `viewsFor('GENERAL')` devuelve las 6 vistas con `FRONT` como ancla; `viewsFor('ADULT')` devuelve las 3 del cuerpo con `BODY_FRONT` como ancla.
  - `quoteRun({ level: 'GENERAL', uploads: 1, resolution: '1k', price })` = 0.208; con 3 fotos = 0.304; `ADULT` con 1 foto = 0.108.
  - Los totales se redondean a milésimas y se comparan en milésimas enteras, nunca en flotante.
  - Una tarifa con `enabled = false` lanza un error de "modelo no disponible".
  - Más de 3 fotos subidas o ninguna lanza un error.
- [ ] Implementa `sheetPlan.ts`. Verde. Commit.

### Tarea 3: Prompts
- [ ] **Pruebas (rojas):**
  - El prompt empieza por el `fixed_prompt` cuando existe.
  - Las vistas del cuerpo incluyen "headless, cropped at the neck, standing, natural relaxed pose".
  - La instrucción de "Cambiar" se recorta a 300 caracteres y se añade al final.
  - La plantilla adulta por defecto contiene "artistic anatomical reference, neutral standing pose, non-sexual".
  - Un prompt de más de 4000 caracteres se rechaza.
- [ ] Implementa `sheetPrompts.ts`. Verde. Commit.

### Tarea 4: Migración
- [ ] **Pruebas (rojas)** con PGlite (esta migración no usa Vault, así que entra en las pruebas):
  - `raxi_ledger_reserve` acepta reservas hasta $10.000 en el mes y rechaza la que lo supera.
  - Las reservas de otro mes no cuentan.
  - `authenticated` no puede insertar en ninguna tabla nueva.
  - `raxi_ledger_settle` marca una reserva como `SUCCEEDED` o `FAILED`; las fallidas dejan de contar para el tope.
- [ ] Escribe la migración. Siembra `raxi_provider_prices` con `bytedance/seedream-v5.5/edit` (0.020 / 0.020 / 0.035, entrada 0.008, verificada 2026-11-17, `enabled = true`) y `bytedance/seedream-v5.0-pro/edit` (`enabled = false`, sin tarifa hasta verificarla). Verde. Commit.

### Tarea 5: Cliente de WaveSpeed
- [ ] **Pruebas (rojas)** con `fetch` falso:
  - `submit` envía `Authorization: Bearer <clave>` y `{ prompt, images, resolution, output_format: 'png' }`, y devuelve el id.
  - `poll` traduce los estados a `PENDING`, `SUCCEEDED` (con la URL de salida) y `FAILED` (con el mensaje).
  - Ningún error lanzado contiene la clave.
- [ ] Implementa `wavespeed.ts`. Verde. Commit.

### Tarea 6: Handler `sheet-creator`
- [ ] **Pruebas (rojas)** con dependencias falsas:
  - Sin sesión → 401.
  - Modelo fuera del roster → 400.
  - `START` sin la casilla de "no es persona real" → 400.
  - `START` con un total distinto del recalculado → 409 "el costo cambió, vuelve a cotizar".
  - `START` que supera el tope → 402 con el gasto del mes.
  - `START` correcto → reserva el costo de **toda** la ficha y envía **solo** la toma ancla.
  - `STATUS` con el ancla terminada → guarda la imagen y envía las demás vistas con el ancla y las fotos subidas como referencias.
  - `STATUS` con el ancla fallida → no envía nada más y libera la reserva de las tomas no enviadas.
  - `ADULT` sin `FRONT` y `BODY_FRONT` generales elegidos → 400.
  - `RETAKE` cotiza y reserva una sola toma.
  - `CHOOSE` registra `raxi_assets` con `kind = 'REFERENCE'`, su ángulo y `content_level` (`PUBLIC` o `NSFW`).
  - Ninguna respuesta contiene la clave.
- [ ] Implementa `handler.ts`. Verde. Commit.

### Tarea 7: Cableado de Deno
- [ ] `index.ts`:
  - Lee la clave con `raxi_connection_secret`.
  - Crea URLs firmadas de 15 minutos.
  - Descarga la salida de WaveSpeed y la sube a `raxi-hq-private` en `${ws}/sheets/${run}/${view}/${n}.png`.
  - Añade la función a `config.toml`.
- [ ] `npx tsc --noEmit` en verde. Commit.

### Tarea 8: Interfaz del creador
- [ ] **Pruebas (rojas)** en `tests/creator.test.tsx`:
  - El botón "Crear ficha · $0.208" está desactivado hasta subir al menos una foto y marcar la casilla.
  - Con el interruptor NSFW apagado no se muestra ninguna toma adulta.
  - Encenderlo muestra la sección de la ficha adulta, con el modelo Seedream 5.5 preseleccionado.
  - La ficha adulta está desactivada hasta tener `FRONT` y `BODY_FRONT` generales elegidos.
  - Cada vista muestra sus tomas y los botones "Otra versión · $x", "Cambiar", "Subir la mía" y "Elegir".
  - El medidor muestra "Gastado este mes: $x de $10".
- [ ] Implementa `creatorModel.ts`, `SheetCreatorPage.tsx`, `CreadorRoute.tsx` y `creator.css` (solo tokens, sin colores hex nuevos).
- [ ] Añade la ruta y el botón en el perfil de Talento. Verde. Commit.

### Tarea 9: Verificación y staging
- [ ] Ejecuta todas las pruebas, `tsc` y `build`, y haz pruebas de mutación de tres reglas: tope, casilla y ocultar lo adulto.
- [ ] **Solo con la autorización de Luis:** aplica la migración y despliega `sheet-creator` en staging (`zvhxjindgyvtasstfjut`). Producción no se toca.
- [ ] Verifica los permisos con SQL, igual que en M1.
- [ ] **Primera creación real:**
  - Luis crea la ficha general de una modelo desde la interfaz.
  - Se comparan el costo estimado y el cargo real en el panel de WaveSpeed.
  - Si no coinciden, se corrige la tarifa antes de seguir.
- [ ] **Primera ficha adulta:** la lanza Luis. Si Seedream 5.5 rechaza el ancla, se documenta el error y se decide con Luis otro modelo. No se cambia de modelo de forma automática.
- [ ] Actualiza Supermemory y la sección 8 del spec, y abre el PR.

## Fuera de M2
- Fotos de continuidad (M3) y MCP `raxi-creation` (M4).
- Comparar varios modelos a la vez para la cara, como el paso "ver su cara con 3 modelos" de Aria. Se puede añadir después; aquí se elige un modelo por creación.
