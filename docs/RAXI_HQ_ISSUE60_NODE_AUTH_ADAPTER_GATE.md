# Raxi HQ · Issue #60 · Adaptador Supabase Node de autenticación (NO desplegado)

**Estado:** PR en borrador. Solo código y pruebas offline. **No es un endpoint, no es un worker y no ejecuta agentes.**

## Decisión de producto

Raxi HQ pertenece a **una sola cuenta humana administradora**. No se requiere crear un segundo usuario. Las pruebas negativas de un actor distinto siguen siendo útiles como fixtures de seguridad, pero no se etiquetan como E2E alojado con una segunda cuenta.

## Ubicación y límite de confianza

- `apps/raxi-hq/server/stagingSupabaseNodeAdapter.ts` está intencionadamente **fuera de `src/`**. Solo Node.js. No se importará en UI, rutas Vite ni funciones Edge. Usa `@supabase/supabase-js` ya fijado a la versión `2.118.0` del proyecto, sin instalar dependencias nuevas.
- `createUnpublishedStagingNodeAuthProbe` recibe explícitamente una URL, una **publishable key** y una **secret key** de Supabase. El archivo **no lee variables de entorno** ni contiene valores reales. La secret key debe tener formato `sb_secret_`; las claves heredadas requieren análisis separado. Nunca incluir claves en cliente, build público, logs, GitHub o ChatGPT.
- El constructor heredado de PR #70 comprueba URL exacta `https://zvhxjindgyvtasstfjut.supabase.co`, clientes independientes y flags `liveEnabled=false`, `providersEnabled=false`, `actionsEnabled=false`. Ninguna excepción por "modo desarrollador".
- Ambos clientes SDK usan `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false`. El cliente con publishable key ejecuta `auth.getClaims(token)` (verificación JWT) y `auth.getUser(token)` (consulta Auth actual). El segundo, con secret key, solo puede ejecutar la **RPC allowlist** `raxi_supervised_host_identity`, que confirma `auth.sessions`, actor y propiedad del workspace en cada llamada. La cabecera Bearer del usuario nunca se convierte en sesión del cliente privilegiado.
- Las respuestas son genéricas y no incluyen JWT, clave, UID, UUID de sesión ni detalles internos. La función heredada rechaza verbos y cuerpos no autorizados.

## Pruebas y alcance de evidencia

`apps/raxi-hq/tests/stagingSupabaseNodeAdapter.test.ts` emplea un SDK **falso inyectado** y claims sintéticos, sin red. Casos: propietario, identidad ajena sintética, workspace ajeno, sesión revocada sintética, claims vencidos/anónimos/invalidos, payloads maliciosos, credenciales reutilizadas o erróneas, proyecto no permitido, y un mismo SDK indebidamente reutilizado. Se requiere `tsconfig.host.json` en typecheck/build, además de la suite completa y auditoría.

**No afirmar:** prueba con JWT firmado de Supabase para el host Node, revocación hospedada, compatibilidad de una ruta desplegada ni que el Director IA ya esté trabajando. El botón Android de PR #69 ya mostró 4/4 resultados correctos para su sesión, pero su endpoint es distinto de este adaptador.

## Gates posteriores

1. CI completo y revisión independiente del HEAD final; resolver todos los hallazgos. Mantener PR en **DRAFT / NO-GO**.
2. Diseñar una ruta Node **separada**, protegida por autenticación, control de ingreso, tiempo/tasa, límites de cuerpo, no-store y sin CORS permisivo; verificar configuración de Vercel y despliegue solo previa autorización específica de URL/commit/entorno. Este PR no publica esa ruta.
3. Probar desde **una segunda sesión de la misma cuenta** en un perfil aislado, sin cerrar la sesión principal, y comprobar revocación contra la RPC del servidor; no copiar JWT ni secretos a chat o GitHub.
4. Autorizar independientemente primer piloto Director IA `TEXT` **real**: proveedor/modelo exactos, tope de costo, expiración, permiso humano persistido, ejecución manual, revocación y recibos de ejecución `AGENT_EXECUTOR / VERIFIED / simulated=false`. No iniciar Investigador automáticamente.
5. Solo eventos verificados pueden mover al agente REAL en Pixi. Cero eventos = cero movimientos atribuidos a trabajo real. DEMO permanece separado.

**No autorizado ni realizado por este PR:** SQL remoto, Vercel/Edge, production, service_role en frontend, endpoint, provider, ejecución, publicaciones, gastos, agenda/nocturnos, tareas o creación de usuarios.

## Referencias

- Supabase [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [sessions](https://supabase.com/docs/guides/auth/sessions) y [keys](https://supabase.com/docs/guides/api/api-keys)
- Raxi HQ Issue #60 y PRs #68/#69/#70.
