# Raxi HQ v1.1 — Módulo de Creación (enfoque B híbrido) + renovación visual

> **Estado:** PROPUESTA · enfoque B aprobado por Luis el 2026-11-16. El diseño detallado y el plan de implementación están pendientes.
> **Para el agente que ejecute esto (Claude Fable 5.2 en Claude Code):** usa la metodología Superpowers (`obra/superpowers` v7.x): `brainstorming` → diseño aprobado → `writing-plans` → `subagent-driven-development`. **No escribas código hasta que Luis apruebe el diseño.** Respeta `AGENTS.md`, salvo la excepción de la sección 6, que requiere su aprobación explícita.

---

## 0. Prompt de arranque (copiar y pegar en Claude Code con Fable 5.2)

```text
Lee AGENTS.md y docs/RAXI_HQ_V11_CREATION_MODULE_SPEC.md completos.
Usa Superpowers: empieza con brainstorming sobre este spec. Muéstrame el diseño
en bloques cortos para aprobarlo y después escribe el plan en
docs/superpowers/plans/ con writing-plans.
Tienes dos frentes, y deben quedar en planes separados:
  (1) Módulo de Creación híbrido: identidad, continuidad, costos, archivo y QA.
  (2) Renovación visual de Raxi HQ: sistema de diseño y estética.
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

## 4. Arquitectura propuesta (enfoque B)

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

**Por verificar antes de diseñar (no inventar):** API oficial de WaveSpeed. Concretamente: endpoints, si permite varias imágenes de referencia por modelo, semilla, polling o webhooks, y precios actuales.

## 5. Renovación visual de Raxi HQ (frente 2)

**Estado actual (hechos del código, `apps/raxi-hq`):**
- `src/design/tokens.css` solo define 5 variables (`--bg`, `--panel`, `--ink`, `--muted`, `--accent`).
- Hay **217 colores hex únicos escritos a mano** entre `global.css` y `campus.css`. No existe una escala de tokens.
- Bug: `var(--text)` se usa en `.task-board-filters select` pero no está definida.
- Fuente: `'Segoe UI'`, que solo existe en Windows. En macOS y móvil cae a una genérica.
- No hay escala tipográfica, de espaciado ni de radios. Cada panel (`human-attention`, `agent-signals`, `task-board`…) define sus propios valores.
- La identidad visual existente que vale la pena conservar: fondo navy oscuro, acento cian `#35e7ff`, morado secundario en Ideas y el Campus con edificios y estética gamer.

**Objetivo:** que Raxi HQ se sienta como un **centro de mando creativo premium y coherente**, no como una suma de paneles. Debe mantener su ADN (oscuro, cian, gamer y agentes) con más jerarquía, aire y consistencia.

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

## 7. Riesgos

- **Deriva de identidad entre proveedores.** Mitigación: QA de rostro obligatorio y referencias fijas.
- **Costos.** Mitigación: techo por orden, presupuesto mensual e idempotencia.
- **Fuga de claves.** Mitigación: solo en el servidor, sin registrarlas en logs.
- **Términos de uso de Aria/WaveSpeed.** Revisarlos antes de producción.
- **Contenido.** Las reglas de contenido adulto no explícito de `AGENTS.md` siguen vigentes.
