# MCP `raxi-creation` — Fase 1 (solo lectura) — Plan de implementación

> **Para quien ejecute esto (Claude Code):** usa `superpowers:subagent-driven-development` (o `executing-plans`), en orden y con TDD: prueba en rojo, código, verde. Cada paso lleva casilla `- [ ]`. Respeta `AGENTS.md`.
> **Estado:** PLAN PROPUESTO (2026-11-18). Diseño: Claude Doc «MCP raxi-creation — Diseño v2» (https://claude.ai/artifact/XeteWjoogCkwmMmL3dVjYA). Luis pidió seguir con el MCP; el plan requiere su visto bueno antes de ejecutarse.
> **Rama:** `feat/v11-mcp`, creada desde `feat/v11-continuidad` (commit `4c17d39`).

## Objetivo

Un servidor MCP remoto, `raxi-creation`, en una Edge Function de Supabase **staging** (`zvhxjindgyvtasstfjut`). Luis lo conecta como conector personalizado en claude.ai y Claude puede **leer** Raxi HQ sin gastar nada:

| Herramienta | Qué devuelve |
|---|---|
| `personajes` | Personajes del workspace con su versión de identidad bloqueada |
| `identidad` | Texto fijo bloqueado (`fixed_prompt`) y versión de un personaje |
| `fotos` | Tomas recientes de Recrear: id, personaje, canal, estado, costo y fecha |
| `ver_foto` | La imagen de una toma, para que Claude haga el QA |
| `presupuesto` | Gastado este mes frente al tope de $10 |

La Fase 2 (preparar, generar, elegir y descartar, con presupuesto semanal) y la sección «Objetivos y muestras» de la Fototeca tendrán un plan propio. **No entran aquí.**

## Decisiones que este plan implementa (Luis, 2026-11-18)

- **Inicio de sesión:** OAuth con la cuenta de Raxi HQ de Luis, mediante el servidor OAuth 2.1 de Supabase con registro dinámico de clientes. No se usan tokens fijos.
- **Solo nivel público:** el MCP solo lee y muestra contenido `PUBLIC`. Lo de Fanvue (`NSFW`/`EXPLICIT`) no existe para el MCP.
- **Sin herramientas peligrosas:** nada de escribir, aprobar, claves, Conexiones, borrar ni publicar.
- **Producción no se toca:** `jrkefsylpfriiqefcmzq` queda fuera. Todo va a staging y solo con la autorización de Luis.

## Hechos verificados (2026-11-18)

**Supabase, documentación oficial**
- Fuentes: [Deploy MCP servers](https://supabase.com/docs/guides/ai-tools/byo-mcp) y [OAuth 2.1 server, getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started).
- **Paquetes:**
  - `npm:@modelcontextprotocol/server@^2.0.0` (`createMcpHandler`, `McpServer`).
  - `npm:@supabase/middleware@1` (`pipeline`).
  - `npm:@supabase/server@1`, versión 1.6.0 o superior (`withOAuthProtectedResource`, `withSupabase`).
  - `npm:zod@^4.3.6`.
- **Cadena de middleware:** `pipeline([withOAuthProtectedResource(), withSupabase({ auth: 'user' })], handler)`.
  - El primero sirve el descubrimiento OAuth y añade el `WWW-Authenticate` en las respuestas 401.
  - El segundo verifica el token del usuario y entrega un cliente `supabase` sujeto a RLS.
- **Sin estado:** `createMcpHandler` se crea en cada petición; MCP sampling no está soportado.
- **`config.toml`:**
  - La función lleva `verify_jwt = false`, porque verifica el token ella misma.
  - Se añade `[auth.oauth_server]` con `enabled = true`, `authorization_url_path = "/oauth/consent"` y `allow_dynamic_registration = true`.
- **Requisitos:**
  - El proyecto debe firmar los JWT con **ES256 o RS256**; los tokens HS256 se rechazan.
  - Supabase CLI 2.117.0 o superior.
  - Una página de consentimiento en el frontend, con el **Site URL** de Auth apuntando a su origen.
- **Disponibilidad:** el servidor OAuth 2.1 está en beta, disponible en todos los planes, sin cargo aparte.
- **Página de consentimiento (supabase-js):**
  - Métodos: `supabase.auth.oauth.getAuthorizationDetails(authorizationId)`, `approveAuthorization(authorizationId)` y `denyAuthorization(authorizationId)`.
  - `getAuthorizationDetails` devuelve dos formas: los detalles a consentir, o un `redirect_url` si ya hubo consentimiento.

**Claude, documentación oficial**
- Fuentes: [conectores con MCP remoto](https://support.claude.com/en/articles/11503834) y [añadir un conector personalizado](https://claude.com/docs/connectors/custom/remote-mcp).
- Admite Streamable HTTP y servidores con OAuth.
- El conector se añade desde claude.ai en la web; en la app móvil se usa, pero no se puede añadir.

**Raxi HQ staging (consultado por SQL el 2026-11-18)**
- **RLS de lectura `owner_read`** para `authenticated`, en `raxi_character_profiles`, `raxi_identity_versions`, `raxi_recreations`, `raxi_sheet_takes`, `raxi_assets` y `raxi_audit_events`. El dueño del workspace lee lo suyo; el cliente con el token de Luis basta para las lecturas.
- **El bucket `raxi-hq-private` no tiene políticas en `storage.objects`.** El usuario no puede descargar con su token. `ver_foto` comprueba primero la propiedad leyendo la fila con el cliente del usuario (RLS) y después descarga con la service role, **solo esa ruta**.
- **Columnas de `raxi_recreations`:** `id, workspace_id, character_id, channel, level, objective_path, identity_version, ref_asset_ids, ref_paths, style, scene, prompt, prompt_cost_mills, variants, model, resolution, ceiling_mills, attested_not_real, created_by, created_at, adult_text`.
- **`raxi_audit_events.actor_kind`** acepta `HUMAN`, `AGENT`, `SYSTEM` y `CODEX`. El MCP registra con `AGENT` y `actor_user_id = auth.uid()`.
- **Ya existe:** `raxi_sheet_month_spend` (RPC) para el gasto del mes.
- **Front-end:** la app es Vite + `react-router-dom` 7.18.4 + `@supabase/supabase-js` 2.118.0, y ya tiene `src/auth/AuthRoutes.tsx`.

**Pendiente de verificar (no inventar; parar y preguntar si falla)**
1. Que staging firme los JWT con claves asimétricas. Si sigue con HS256, rotar a ES256 lo decide Luis. Antes de rotar hay que confirmar en la documentación de Supabase qué pasa con las funciones con `verify_jwt = true` y con las sesiones abiertas.
2. El Site URL actual de Auth en staging. Cambiarlo afecta los enlaces de los correos de inicio de sesión: primero se confirma qué valor tiene.
3. El tamaño máximo de imagen que Claude acepta en un resultado de herramienta MCP. Las tomas pesan unos 3 MB en PNG. Se mide con una prueba real; el plan prevé reducir a JPEG de 1024 px como máximo.
4. Que `@supabase/server` y `@modelcontextprotocol/server` 2.x funcionen en el runtime de Edge Functions de staging. Se comprueba con un despliegue mínimo (Tarea 2) antes de escribir las herramientas.

## Tareas

### Tarea 0 — Requisitos en el panel de Supabase (Luis, con Claude guiando)
- [ ] Revisar en *Project Settings → JWT Keys* si staging usa claves asimétricas. Anotar el resultado aquí.
- [ ] Revisar en *Authentication → URL Configuration* el Site URL y las Redirect URLs actuales. Anotarlos aquí.
- [ ] Si los dos puntos anteriores están bien, activar en *Authentication → OAuth Server* el servidor OAuth 2.1 y el registro dinámico de clientes, con la ruta de autorización `/oauth/consent`.
- [ ] Si algo no cuadra, **parar** y presentarle opciones a Luis. No se rota ninguna clave ni se cambia el Site URL sin su visto bueno explícito.

### Tarea 1 — Configuración en el repo
- [ ] `supabase/config.toml`: añadir `[functions.raxi-creation]` con `verify_jwt = false` y un comentario que explique que la función verifica el token ella misma.
- [ ] `supabase/config.toml`: añadir `[auth.oauth_server]` con `enabled = true`, `authorization_url_path = "/oauth/consent"` y `allow_dynamic_registration = true`.
- [ ] Commit propio.

### Tarea 2 — Esqueleto que se despliega (prueba de vida)
- [ ] Crear `supabase/functions/raxi-creation/index.ts` con la cadena `pipeline([withOAuthProtectedResource(), withSupabase({ auth: 'user' })], handler)` y una sola herramienta, `whoami`, que devuelve el id del usuario.
- [ ] Desplegar en staging (con autorización de Luis) y comprobar con `curl`:
  - una llamada sin token responde 401 con `WWW-Authenticate`;
  - el documento de descubrimiento de recurso protegido responde.
- [ ] Si el runtime rechaza los paquetes, parar y documentar el error.

### Tarea 3 — Lógica de herramientas, pura y probada (TDD)
- [ ] Crear `supabase/functions/raxi-creation/tools.ts`. Las funciones reciben un objeto `deps` inyectable, igual que `sheet-creator/deps.ts`, para probarlas sin red.
- [ ] Escribir las pruebas `supabase/functions/raxi-creation/tools.test.ts`, en rojo primero, con `deps` simulados:
  1. `personajes` lista solo los personajes del workspace con su versión bloqueada, o «sin identidad bloqueada».
  2. `identidad` devuelve el `fixed_prompt` vigente. Rechaza un personaje que no exista o no sea del usuario.
  3. `fotos` devuelve solo tomas de recreaciones con `level = 'PUBLIC'`. Una toma `NSFW` o `EXPLICIT` nunca aparece, ni por filtro ni por id. Admite un límite de 1 a 20 (10 por defecto).
  4. `ver_foto` con el id de una toma `PUBLIC` del usuario devuelve un bloque `image`. Con una toma `NSFW`/`EXPLICIT`, ajena o inexistente, responde el mismo error genérico «No encontré esa foto», sin revelar si existe.
  5. `ver_foto` solo descarga la ruta guardada en la fila de la toma. Nunca acepta una ruta enviada por el cliente.
  6. `presupuesto` devuelve el gasto del mes (`raxi_sheet_month_spend`) y el tope de $10 en dólares, con 3 decimales.
  7. Cada llamada registra en `raxi_audit_events` la acción `MCP_<HERRAMIENTA>`, `actor_kind = 'AGENT'` y los argumentos resumidos, sin imágenes ni secretos.
  8. Ningún texto de salida contiene claves, tokens ni la URL firmada de Storage.
- [ ] Implementar `tools.ts` hasta poner las pruebas en verde.
- [ ] Commit.

### Tarea 4 — `deps` reales
- [ ] Crear `supabase/functions/raxi-creation/deps.ts`.
- [ ] Lecturas con el cliente del usuario que entrega `withSupabase`, sujeto a RLS.
- [ ] Descarga de `ver_foto` con un cliente de service role creado en el servidor, solo después de que la lectura con RLS confirme la toma.
- [ ] Reducción de imagen: si el resultado supera el límite medido en el punto 3 de «Pendiente de verificar», convertir a JPEG de 1024 px como máximo por el lado largo. La librería se elige tras comprobar que funciona en Edge Functions; registrar aquí la elegida y por qué.
- [ ] Pruebas de integración con PGlite, como en `sheet-creator`, para `fotos` y para el filtro `PUBLIC`.
- [ ] Commit.

### Tarea 5 — Registrar las herramientas en el servidor MCP
- [ ] En `index.ts`, sustituir `whoami` por las 5 herramientas, con esquemas `zod`, descripciones en español y la anotación `readOnlyHint: true`.
- [ ] `instructions` del servidor: «Raxi HQ (staging). Solo lectura y solo contenido público.»
- [ ] Prueba de humo local con `supabase functions serve` si el entorno lo permite; si no, se pasa directamente a la Tarea 7.
- [ ] Commit.

### Tarea 6 — Página de consentimiento en Raxi HQ
- [ ] Crear la ruta `/oauth/consent` en `apps/raxi-hq` y un componente `src/auth/OAuthConsentPage.tsx`.
  - Sin sesión: enviar a inicio de sesión y volver después con el mismo `authorization_id`.
  - Con sesión: llamar a `getAuthorizationDetails`. Si devuelve `redirect_url`, redirigir sin preguntar.
  - Si devuelve detalles: mostrar el nombre del cliente, los permisos pedidos y una advertencia clara («Claude podrá ver tus personajes y fotos públicas»), con los botones **Aprobar** y **Rechazar**.
  - Al decidir, llamar a `approveAuthorization` o `denyAuthorization` y redirigir a la URL devuelta.
- [ ] Pruebas con `react-test-renderer`: sin sesión, con detalles, con `redirect_url` y con error.
- [ ] Estilo coherente con el rediseño «editorial de agencia».
- [ ] `npm run typecheck` y `node scripts/test.mjs` en verde.
- [ ] Commit.

### Tarea 7 — Despliegue en staging (requiere autorización de Luis)
- [ ] Desplegar `raxi-creation` con **todos** sus archivos y verificar con `get_edge_function` contra el repo, igual que con `sheet-creator`.
- [ ] Publicar la página de consentimiento en el preview de Vercel (`raxi-hq-staging`) y confirmar que el Site URL apunta a ese origen (Tarea 0).
- [ ] Commit y push de la rama.

### Tarea 8 — Conexión y prueba real (Luis + Claude)
- [ ] Luis añade el conector desde claude.ai en la web: Configuración → Conectores → Añadir personalizado, con la URL `https://zvhxjindgyvtasstfjut.supabase.co/functions/v1/raxi-creation`.
- [ ] Luis inicia sesión y aprueba en la página de consentimiento.
- [ ] Claude prueba, una por una:
  - `personajes`;
  - `identidad` de Vesper (debe ser la v4);
  - `fotos`;
  - `ver_foto` de la toma del pasillo del castillo;
  - `presupuesto`.
- [ ] Prueba negativa: pedir una toma de nivel Fanvue debe devolver «No encontré esa foto».
- [ ] Prueba de revocación: Luis revoca el acceso y la siguiente llamada falla con 401.
- [ ] Comprobar en `raxi_audit_events` que hay una fila por llamada.
- [ ] Probar el conector desde la app móvil.

## Criterio de terminado
- Las 5 herramientas funcionan desde claude.ai (web y móvil) con el login de Luis.
- No hay ningún camino para leer contenido no público.
- Toda llamada queda registrada.
- Las pruebas y el `typecheck` están en verde.
- La función está desplegada en staging y verificada contra el repo.
- Producción no se tocó.

## Fuera de alcance
Fase 2 (presupuesto semanal y generación), «Objetivos y muestras» en la Fototeca, series y campañas, Raxi Vox (no tiene texto fijo en staging) y producción.
