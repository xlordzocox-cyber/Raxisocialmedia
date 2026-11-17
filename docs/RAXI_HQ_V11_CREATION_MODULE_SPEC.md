# Raxi HQ v1.1 — Módulo de Creación (enfoque B híbrido) + renovación visual

> **Estado:** PROPUESTA · enfoque B aprobado por Luis el 2026-11-16. La excepción de política de la sección 6 también quedó aprobada por Luis el 2026-11-16 (ver sección 8). El diseño detallado y el plan de implementación siguen pendientes.
> **Revisión 2026-11-16 (Claude):** se agregaron el MCP propio (4.2), la política de referencias (4.3), los datos verificados de WaveSpeed (4.4), los hallazgos de QA de las fichas (2.1), la dirección "agencia" para el diseño (sección 5) y el registro de decisiones (sección 8).
> **Para el agente que ejecute esto (Claude Fable 5.2 en Claude Code):** usa la metodología Superpowers (`obra/superpowers` v7.x): `brainstorming` → diseño aprobado → `writing-plans` → `subagent-driven-development`. **No escribas código hasta que Luis apruebe el diseño.** Respeta `AGENTS.md`, salvo la excepción de la sección 6, que requiere su aprobación explícita.

---

## 0. Prompt de arranque (copiar y pegar en Claude Code con Fable 5.2)

```text
Lee AGENTS.md y docs/RAXI_HQ_V11_CREATION_MODULE_SPEC.md completos.
Usa Superpowers: empieza con brainstorming sobre este spec. Muéstrame el diseño
en bloques cortos para aprobarlo y después escribe el plan en
docs/superpowers/plans/ con writing-plans.
Tienes dos frentes, y deben quedar en planes separados:
  (1) Módulo de Creación híbrido: identidad, continuidad, costos, archivo, QA
      y un MCP propio para que Claude y Codex operen el módulo (sección 4.2).
  (2) Renovación visual de Raxi HQ: que se vea como el centro de operaciones
      de una agencia profesional de producción fotográfica de modelos para
      redes sociales (sección 5).
Reglas: no inventes APIs, modelos ni precios; verifica en documentación oficial.
Nada de secretos en el cliente. Ninguna generación de pago sin mi aprobación
explícita por ejecución. Separa siempre lo que es hecho, inferencia y recomendación.
```

---

## 1. Qué queremos lograr

Raxi HQ tiene que conservar dentro de sí la identidad de los personajes (Raxi Vox, Vesper Corvus) y producir **series coherentes** de fotos, no imágenes sueltas. Aria Studio sigue siendo el generador de las fotos base. Raxi HQ añade todo lo que Aria no ofrece.

**Éxito =** una campaña de 4–6 fotos del mismo momento (misma ropa, lugar y luz) con rostro consistente, un costo real registrado por imagen, assets archivados para siempre en la Asset Library y QA aprobado por Luis antes de publicar.

## 2. Hallazgos de la auditoría del MCP de Aria (2026-11-16, solo lectura)

**Hechos (verificados contra el MCP):**
- 6 herramientas: `modelos`, `mis_personajes`, `mis_creaciones`, `saldo`, `generar_imagen`, `estado_imagen`.
- `generar_imagen` solo acepta `personaje`, `escena`, `formato`, `calidad`, `modelo` y `nsfw`. **No acepta imágenes de referencia, semilla, edición ni "foto anterior".**
- 16 modelos disponibles: 14 por WaveSpeed (con la clave de Luis) y 2 por Magnific (con sus créditos). Saldo regalo: $0.
- Fallo de configuración: `por_defecto = "qwen"`, que no está disponible (requiere Higgsfield). `saldo` reporta Seedream 5.0 Flash. **Hay que indicar siempre el modelo.**
- Aria envuelve el prompt ("Create one new photograph… image 1…") y le suma el texto de identidad del personaje.
- El texto de identidad de `raxi-vox` termina en "…phon" (posible truncado). **Hay que verificarlo en la web de Aria.**
- `saldo` no cuenta lo gastado con claves propias: marca 0 imágenes del mes aunque hubo creaciones.
- Las fichas se devuelven como rutas internas, sin descarga. Los enlaces de las creaciones caducan en 24 h.

**Inferencias (por confirmar):**
- Varias creaciones separadas por menos de 1 s podrían ser cobros dobles. Hay que revisarlo en el panel de WaveSpeed.
- Repetir en `escena` los rasgos físicos que ya trae la identidad duplica el prompt y puede restar estabilidad.

### 2.1 QA visual de las fichas 360 (revisión de Claude, 2026-11-16)

Luis subió 17 imágenes de ficha: rostro, cuerpo con ropa interior y versiones sin ropa de ambas modelos. Es una revisión visual, no una medición automatizada.

| Modelo | Hallazgo | Impacto | Acción propuesta |
|---|---|---|---|
| Vesper | En los paneles de cuerpo el cabello es castaño y lacio; en los de rostro es negro azabache y ondulado. La cara está cortada y la piel se ve más cálida | **Alto:** usar ese cuerpo como referencia mezcla dos identidades | Regenerar los paneles de cuerpo usando el rostro como referencia, o conseguir en Aria una versión correcta. **Decisión de Luis pendiente.** |
| Vesper | La cruz con piedra roja, los aretes y el labial rojo oscuro aparecen siempre, pero no están en su texto de identidad | Medio | Agregarlos como "accesorios de firma" |
| Raxi | El texto dice "teal blue highlights"; las fotos muestran mechas turquesa con toques lila | Bajo | Ajustar el texto |
| Raxi | Lunar sobre el labio, pecas y un lunar en el muslo aparecen en todas las tomas, pero no están en el texto | Medio | Agregarlos como "marcas distintivas" |
| Raxi | El texto dice "average build, medium bust and hips"; las fotos muestran complexión delgada y atlética | Medio | Ajustar el texto al cuerpo real de la ficha |
| Raxi | Inferencia: el rostro aparenta algo más de 25 años | Bajo | Que Luis decida si se ajusta la edad o el texto |
| Ambas | Los paneles de cuerpo cortan la cara; no hay una imagen que una rostro y cuerpo | Bajo | Agregar al set canónico una toma de cuerpo completo con la cara visible |

Los cambios a los textos de identidad son una **propuesta**. Requieren la aprobación de Luis antes de versionarse (AGENTS.md: no redefinir la identidad sin pedido explícito).

## 3. Matriz de funciones

| Función | Aria (MCP) | Raxi HQ v1.1 |
|---|---|---|
| Identidad del personaje | Sí | **Registro propio versionado** (texto + ficha 360 copiada a la Asset Library) |
| Foto base suelta | Sí | Reutilizar Aria (adaptador existente `src/production/ariaPilot.ts`) |
| Fotos 2…N con continuidad | No | **WaveSpeed directo** con referencias: ficha + foto anterior aprobada |
| Selección de modelo | Sí (con fallo en el predeterminado) | Modelo explícito por orden, según la política de `AGENTS.md` |
| Control del prompt | Parcial | Plantillas propias sin duplicados, versionadas |
| Costo real | No | **Libro de costos** por llamada (proveedor, modelo, precio, job id) |
| Archivo permanente | No (24 h) | Asset Library con Asset ID canónico (sha256) |
| Edición / upscale | No | Magnific (fase posterior) |
| QA + revisión humana | No | Quality Gate de `AGENTS.md` + aprobación de Luis |
| Acceso para agentes (Claude / Codex) | Sí (MCP de Aria) | **MCP propio `raxi-creation`** (sección 4.2) |

## 4. Arquitectura propuesta (enfoque B)

### 4.1 Flujo y restricciones

```
Strategy aprobada → Orden de producción (por serie)
   ├─ Foto base    → Aria MCP (adaptador existente)
   └─ Fotos 2..N   → Edge Function `creation-command` → WaveSpeed API
                        (referencias: ficha 360 + foto anterior aprobada)
→ Recibo (job id, modelo, costo, sha256) → Libro de costos (Supabase)
→ Asset Library (Asset ID) → Quality Gate → Aprobación de Luis
```

**Restricciones de diseño:**
- La clave de WaveSpeed vive **solo en el servidor** (secret de Supabase / server runtime), nunca en el cliente ni en el repo.
- Cada ejecución de pago necesita una orden concreta con proveedor, modelo y techo de precio, más la **aprobación explícita de Luis** (patrón actual `executionApproval`).
- Límite de presupuesto por serie y por mes (reutilizar el patrón de `server/agent-runtime/pilotBudget.ts`).
- Idempotencia por `jobId` para evitar cobros dobles: es el hallazgo de la sección 2.
- **No copiar nada interno de Aria.** Solo se usa su MCP público y lo que Luis ve como usuario.

### 4.2 MCP propio `raxi-creation` (nuevo)

Objetivo: que Claude y Codex operen el Módulo de Creación de forma directa, igual que hoy usan el MCP de Aria, pero con las reglas aplicadas **en el servidor**. Un agente no debe poder saltárselas.

Herramientas mínimas (YAGNI: nada más hasta que se necesite):

| Herramienta | Qué hace | Cobra |
|---|---|---|
| `personajes` | Lista personajes con su versión de identidad bloqueada | No |
| `ficha` | Texto de identidad, marcas distintivas y referencias canónicas de un personaje | No |
| `cotizar` | Precio de una foto o serie antes de generar (modelo + resolución + nº de referencias) | No |
| `generar_continuidad` | Foto N de una serie: personaje + escena + referencias (ficha + foto anterior aprobada) + modelo explícito + `orderId` | Sí |
| `estado` | Estado de una generación (job id, costo, sha256, Asset ID) | No |
| `serie` | Lista las fotos de una serie con su linaje y su estado de QA | No |
| `qa_identidad` | Compara una foto con la ficha bloqueada y devuelve puntaje y problemas (lo revisa Claude con visión; lo decide Luis) | Solo tokens |
| `cancelar` | Cancela trabajo pendiente | No |

Reglas aplicadas por el servidor:
1. Sin una orden con `executionApproval` vigente, `generar_continuidad` solo cotiza.
2. Nunca supera el techo de la orden ni el presupuesto mensual (`pilotBudget`).
3. Siempre adjunta las referencias de la identidad bloqueada. El agente no puede quitarlas.
4. Idempotencia por `orderId` + número de toma: el mismo pedido nunca cobra dos veces.
5. Nada se reporta como listo hasta tener sha256 y Asset ID en la Asset Library.
6. Token obligatorio. Registro de cada llamada: quién, herramienta, costo.

**Decisión de diseño pendiente (resolver en el brainstorming con datos verificados):** dónde vive el MCP.
- Opción A: Supabase Edge Function junto a `creation-command`, reutilizando `supabase/functions/_shared`.
- Opción B: ruta `/api/mcp` en la app de Vercel con [`mcp-handler`](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel), que Vercel documenta como adaptador oficial con autenticación.
- Hay que verificar en la documentación oficial cuál admite Streamable HTTP + autenticación con menos piezas nuevas. No elegir de memoria.

### 4.3 Política de referencias

- **Corrección (2026-11-17):** la regla anterior citaba el `AGENTS.md` de `main`. El vigente en `feat/claude-team-office` permite NSFW en el feed de Fanvue y EXPLICIT en el chatting (decisión de Luis del 2026-11-15). Cada personaje tiene una **ficha general** (con ropa) y puede tener una **ficha adulta** (NSFW), separadas por nivel. La adulta solo se usa como referencia para Fanvue y se oculta por defecto tras un interruptor NSFW.
- **NSFW en el creador de Raxi HQ:** modelo por defecto Seedream 5.5 (`bytedance/seedream-v5.5/edit`), decisión de Luis del 2026-11-17.
- Las referencias viven en un bucket privado. Las fotos finales se sirven con enlaces firmados de corta duración.
- Ningún texto de identidad cambia sin la aprobación de Luis (ver 2.1).

### 4.4 API de WaveSpeed: verificado vs. pendiente

**Verificado en la documentación de WaveSpeed (2026-11-16):**
- Los modelos con referencias usan endpoints `/edit`: por ejemplo, `POST https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.0-pro/edit`, con un arreglo `images` y autenticación `Bearer`.
- [Seedream 5.0 Pro Edit admite hasta 10 imágenes de referencia](https://wavespeed.ai/models/bytedance/seedream-v5.0-pro/edit/llms.txt).
- La llamada devuelve un id de predicción. El resultado se consulta en `GET /api/v3/predictions/{id}/result`; [WaveSpeed recomienda consultar cada ~2 s](https://wavespeed.ai/models/bytedance/seedream-v5.5/edit).

**Sigue pendiente (no inventar):** semilla, webhooks, el precio directo por modelo y si coincide con el que muestra Aria, y la política de contenido de WaveSpeed. También, por cada modelo candidato, el máximo de referencias en su endpoint `/edit`.

## 5. Renovación visual de Raxi HQ (frente 2)

**Estado actual (hechos del código, `apps/raxi-hq`):**
- `src/design/tokens.css` solo define 5 variables (`--bg`, `--panel`, `--ink`, `--muted`, `--accent`).
- Hay **217 colores hex únicos escritos a mano** entre `global.css` y `campus.css`. No existe una escala de tokens.
- Bug: `var(--text)` se usa en `.task-board-filters select` pero no está definida.
- Fuente: `'Segoe UI'`, que solo existe en Windows. En macOS y móvil cae a una genérica.
- No hay escala tipográfica, de espaciado ni de radios. Cada panel (`human-attention`, `agent-signals`, `task-board`…) define sus propios valores.
- La identidad visual existente que vale la pena conservar: fondo navy oscuro, acento cian `#35e7ff`, morado secundario en Ideas y el Campus con edificios y estética gamer.

**Objetivo:** que Raxi HQ se sienta como un **centro de mando creativo premium y coherente**, no como una suma de paneles. Debe mantener su ADN (oscuro, cian, gamer y agentes) con más jerarquía, aire y consistencia.

**Dirección pedida por Luis (2026-11-16):** que Raxi HQ se vea **profesional, como la plataforma de una compañía o agencia de marketing especializada en producción fotográfica de modelos para redes sociales**. Implicaciones para el diseño:
- Lenguaje de agencia: "Talento" (los personajes), "Producción" (series y sesiones), "Equipo" (los agentes como especialistas: Dirección, Creativa, Producción, QA, Copy, Distribución), "Clientes y canales" (Instagram, FanView) y "Resultados".
- Una portada tipo agencia: identidad de marca, servicios, portafolio de talento con fichas, proceso de producción, equipo y métricas clave.
- Presentación del talento al estilo de una agencia de modelos: una ficha profesional por personaje (look, marcas, assets aprobados, campañas).
- El Campus/oficina PixiJS se queda como diferenciador ("el estudio en vivo"), pero deja de ser la primera impresión.
- Raxi HQ es una herramienta interna. Si alguna vista se vuelve pública, los personajes deben identificarse como creados con IA.
- Fable debe proponer 2–3 direcciones visuales (por ejemplo: editorial oscuro de agencia, estudio fotográfico minimalista, centro de mando premium) en bloques cortos, **antes** de aplicar nada.

**Alcance pedido a Fable:**
1. Sistema de tokens completo en `tokens.css`: color semántico (superficies, bordes, estados, acento por zona), tipografía, espaciado, radios, sombras y movimiento. Migrar los hex sueltos a tokens.
2. Fuente multiplataforma (web font o stack del sistema), con una escala tipográfica clara.
3. Componentes base consistentes: botón, tarjeta, panel, badge de estado, métrica y formulario.
4. Una vista nueva para el Módulo de Creación: series, continuidad entre fotos, costo y aprobación.
5. Accesibilidad: mantener los focos visibles y los objetivos de 44 px que ya existen. Contraste AA.
6. Proponer 2–3 direcciones estéticas en bloques cortos **antes** de aplicar. Luis elige una.

**Fuera de alcance:** reescribir la escena PixiJS de la oficina y cambiar los flujos de datos o de autorización.

## 6. Cambio de política necesario (requiere aprobación explícita)

`AGENTS.md` dice hoy que Aria Studio es el único servicio autorizado para generar fotos de Raxi. El enfoque B necesita esta excepción:

> "Las fotos de continuidad (2..N de una serie cuya foto base salió de Aria) pueden generarse con WaveSpeed directo desde el Módulo de Creación de Raxi HQ, usando la ficha 360 y la foto anterior aprobada como referencias. Rigen las mismas reglas de aprobación por ejecución, costo verificable y Quality Gate."

`src/adapters/aria/README.md` ("no image generation from HQ") también debe actualizarse cuando el adaptador esté aprobado.

**Estado: APROBADA por Luis el 2026-11-16.** En sus palabras, cambiar la regla "para usarla en paralelo cuando sea necesario en lo que armamos todo". Interpretación vigente: rige el enfoque B (Aria para la foto base, WaveSpeed directo para la continuidad), con Aria siempre disponible en paralelo. Aplicar este texto en `AGENTS.md` es la primera tarea del plan de implementación, en un commit propio y revisable.

## 7. Riesgos

- **Deriva de identidad entre proveedores.** Mitigación: QA de rostro obligatorio y referencias fijas.
- **Costos.** Mitigación: techo por orden, presupuesto mensual e idempotencia.
- **Fuga de claves.** Mitigación: solo en el servidor, sin registrarlas en logs.
- **Términos de uso de Aria/WaveSpeed.** Revisarlos antes de producción.
- **Contenido.** Rigen los niveles por superficie de `AGENTS.md` (público, NSFW para el feed de Fanvue, EXPLICIT para el chatting) y nunca se baja de nivel (4.3).
- **Ficha de Vesper inconsistente** (cabello castaño en los paneles de cuerpo). Mitigación: no bloquear su identidad hasta corregirla (2.1).
- **El MCP propio como superficie de ataque.** Mitigación: token, reglas en el servidor, registro de llamadas y tope de gasto (4.2).

## 8. Registro de decisiones

| Fecha | Decisión | Estado |
|---|---|---|
| 2026-11-16 | Enfoque B híbrido: Aria para la foto base, WaveSpeed directo para la continuidad | Aprobada por Luis |
| 2026-11-16 | Excepción de política de la sección 6, con Aria en paralelo cuando sea necesario | Aprobada por Luis; pendiente aplicarla en `AGENTS.md` |
| 2026-11-16 | MCP propio `raxi-creation` para que Claude y Codex operen el módulo | Pedida por Luis; el diseño se decide en el brainstorming |
| 2026-11-16 | Dirección visual "agencia profesional de producción fotográfica de modelos para redes" | Pedida por Luis; las direcciones concretas se proponen en el brainstorming |
| 2026-11-16 | Corrección de la ficha de Vesper (regenerar o conseguirla de Aria) | Pendiente de decisión de Luis |
| 2026-11-16 | Ajustes a los textos de identidad (2.1) | Propuesta; pendiente de aprobación |
| 2026-11-16 | Ejecutor: Claude Fable 5.2 con la metodología Superpowers | Pedido por Luis |
| 2026-11-17 | Fichas 360 general y adulta, interruptor NSFW apagado por defecto, Seedream 5.5 por defecto para NSFW en Raxi HQ | Aprobada por Luis; aplicada en `AGENTS.md` de `feat/v11-agencia` |
| 2026-11-17 | Creador de ficha 360 propio en Raxi HQ (M2), inspirado en el flujo de Aria | Pedido por Luis |
| 2026-11-17 | Vesper mantiene el cabello negro azabache | Decisión de Luis |

Plan de referencia previo (no rector): "Raxi Studio — Plan de creación y MCP propio" en Claude Docs. Donde difiera, manda este spec.
