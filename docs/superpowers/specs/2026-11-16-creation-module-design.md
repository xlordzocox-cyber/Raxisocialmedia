# Módulo de Creación + MCP `raxi-creation` — Diseño

> **Estado:** diseño APROBADO por Luis el 2026-11-16 (brainstorming Superpowers).
> **Origen:** `docs/RAXI_HQ_V11_CREATION_MODULE_SPEC.md` (enfoque B). Donde este documento sea más concreto que el spec, manda este documento.
> **Siguiente paso:** `writing-plans` → `docs/superpowers/plans/`. No hay código escrito.

## 1. Decisiones tomadas en el brainstorming

| Tema | Decisión de Luis |
|---|---|
| Piloto | Dos series a la vez: Raxi en Instagram y Vesper en FanView |
| Ficha de Vesper | Luis la regenera en Aria y sube la versión corregida con ropa |
| Aprobación de pago | Una orden por serie completa (modelo, nº de fotos, techo de costo) |
| Tope mensual | $10 USD, aplicado por el servidor |

## 2. Alcance

**Dentro:** identidad versionada, importación de la foto base de Aria, orden de serie, generación de fotos 2..N en WaveSpeed con referencias, archivo permanente, libro de costos, QA de identidad, MCP propio.

**Fuera (YAGNI):** edición, upscale, video, creación de fichas, generación de la foto base fuera de Aria.

**Contenido:** rige `AGENTS.md` (adulto no explícito). Solo se cargan fichas con ropa como referencias. Cambiar esa regla es decisión de Luis y requiere editar `AGENTS.md` antes; este diseño no la cambia.

**Criterio de éxito:** cada serie piloto tiene 4–6 fotos del mismo momento con rostro consistente, costo real registrado por foto, assets archivados con Asset ID y aprobación final de Luis.

## 3. Flujo de una serie

1. La foto base se genera en Aria (flujo actual) y se importa al módulo: bytes, sha256, Asset ID.
2. Luis aprueba la foto base como base de la serie.
3. Un agente prepara la orden de serie: personaje, versión de identidad, modelo explícito, número de fotos, escenas y techo de costo.
4. Luis aprueba la orden en el panel de Raxi HQ, con su sesión. **El MCP no expone ninguna herramienta de aprobación.**
5. El módulo genera las fotos 2..N en WaveSpeed, archiva cada una y registra su costo real.
6. Quality Gate de `AGENTS.md` + aprobación final de Luis.

**Referencias de cada foto:** ficha con ropa de la identidad bloqueada + la foto base aprobada. No se encadena la foto N-1 (cambio respecto del spec): encadenar acumula deriva de identidad y no encaja con aprobar la serie completa.

## 4. Componentes

- **Supabase (tablas, RLS activo, escritura solo por service role):**
  - identidad versionada por personaje (texto, marcas, referencias, bloqueada/aprobada);
  - series y órdenes (con `executionApproval`, techo y estado);
  - generaciones (prompt, referencias, job id de WaveSpeed, sha256, Asset ID, estado);
  - libro de costos (proveedor, modelo, precio real, job id).
- **Storage:** un bucket privado para referencias y resultados; acceso por enlaces firmados de corta duración.
- **Edge Function `creation-command`:** toda la lógica de dominio y el cliente de WaveSpeed. La clave vive como secreto de Supabase.
- **Edge Function `raxi-creation` (MCP):** capa delgada sobre la misma lógica compartida (`supabase/functions/_shared`). Herramientas: `personajes`, `ficha`, `cotizar`, `generar_continuidad`, `estado`, `serie`, `qa_identidad`, `cancelar`.
- **Vista en Raxi HQ:** series, continuidad, costo y aprobación (su diseño visual pertenece al frente 2).

**Por qué el MCP vive en Supabase y no en Vercel:** Raxi HQ es una app Vite (no Next.js) y el patrón Edge Function ya existe (`campaign-command`). Supabase documenta servidores MCP en Edge Functions.

## 5. Reglas aplicadas por el servidor

1. Sin orden aprobada vigente, `generar_continuidad` solo cotiza.
2. Nunca se supera el techo de la orden ni el tope mensual de $10 USD.
3. Idempotencia por orden + número de toma: el mismo pedido nunca cobra dos veces.
4. Las referencias de la identidad bloqueada se adjuntan siempre; el agente no puede quitarlas.
5. Nada se reporta como listo sin sha256 y Asset ID.
6. Autenticación obligatoria en el MCP y registro de cada llamada (quién, herramienta, costo).
7. La clave de WaveSpeed nunca llega al cliente, al repo ni a los logs.

## 6. Errores

- Fallo o timeout de WaveSpeed: la toma queda `FAILED`/`TIMED_OUT` con su job id; reintentar reutiliza la misma clave de idempotencia y consulta primero el job existente.
- Costo real mayor que el cotizado: se registra, la serie se detiene y se informa a Luis.
- Identidad sin bloquear (caso Vesper hasta corregir su ficha): la orden se rechaza.

## 7. Pruebas

TDD (rojo → verde → refactor) con WaveSpeed simulado para toda la lógica: presupuesto, idempotencia, aprobación, referencias obligatorias y RLS. Una sola generación real de pago al final, con aprobación explícita de Luis.

## 8. Pendiente de verificar al escribir el plan (no inventar)

- Autenticación de MCP en Edge Functions: dos páginas de la documentación de Supabase no coinciden (una dice "próximamente", otra describe OAuth con `withOAuthProtectedResource`).
- WaveSpeed: precio directo por modelo, semilla, webhooks, máximo de referencias por endpoint `/edit` y política de contenido.
- Cómo se enlaza el Asset ID de Storage con `content/asset-library/ASSET_CATALOG.json`.
- Límite de Storage del plan Free de Supabase.

## 9. Primeras tareas del plan

1. Aplicar en `AGENTS.md` la excepción aprobada (sección 6 del spec), en un commit propio.
2. Actualizar `apps/raxi-hq/src/adapters/aria/README.md`.
3. Luis: segunda clave de WaveSpeed como secreto de Supabase; ficha corregida de Vesper.

## 10. Corrección de base (2026-11-16, tras revisar `feat/claude-team-office`)

**Hecho verificado:** la app que funciona hoy en staging vive en la rama `feat/claude-team-office` (65 archivos y +5,693 líneas por delante de `main`). Este diseño y el spec se escribieron mirando `main`, donde esas piezas no existen. El plan debe partir de `feat/claude-team-office`.

Piezas que ya existen ahí y que el módulo **reutiliza en vez de duplicar**:

| Ya existe | Uso en el módulo |
|---|---|
| Bucket privado `raxi-hq-private` + tabla `raxi_assets` (sha256, ruta por workspace) | Archivo de las fotos generadas. **No se crea otro bucket ni otra tabla de assets** |
| `raxi_portfolio_collections` / `raxi_portfolio_items` + RPC auditada `raxi_portfolio_decide` | Cada serie es una colección; cada foto, un ítem con su QA y decisión de Luis |
| `raxi_archive_requests` + Edge Function `raxi-archive-aria` | Importación de la foto base de Aria (ya descarga, verifica y calcula sha256) |
| Edge Function `raxi-agent-runner` y el pipeline de campaña | Punto de integración de los agentes; por estudiar al escribir el plan |
| `metadata.content_level` (`PUBLIC` / `NSFW` / `EXPLICIT`) en Multimedia | Clasificar cada foto generada; lo no público nunca aparece en superficies de Instagram |

Esto sustituye lo dicho en la sección 4 sobre un bucket nuevo y una tabla de generaciones con Asset ID propio. Tablas realmente nuevas: identidad versionada, órdenes de serie y libro de costos.
