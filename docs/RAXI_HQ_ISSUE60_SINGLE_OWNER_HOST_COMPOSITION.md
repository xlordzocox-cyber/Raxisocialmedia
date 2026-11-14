# Raxi HQ · Issue #60 — ensamblaje del host de autenticación, NO publicado

**Estado:** desarrollo en borrador, no desplegado. PR dependiente del PR #68. Diseño **privado de propietario humano único**; no se necesita una segunda cuenta real.

## Alcance de esta etapa

Se añade `server/agent-runtime/stagingAuthHostComposition.ts`, un constructor **server-only** del diagnóstico ya preparado en PR #68. No hay endpoint, listener, cron, scheduler, service, tarea de agente, binding a `runOne`, API de proveedor ni llamada de generación.

El constructor:
- Exige URL **exacta** de Supabase staging `https://zvhxjindgyvtasstfjut.supabase.co`. Niega producción y otros proyectos.
- Recibe una **publishable key** y una **credencial privilegiada** distintas, exclusivamente en el futuro contexto servidor. No incorpora ni lee los valores desde este repositorio ni pasa la credencial privilegiada al cliente de usuario.
- Construye dos puertos independientes mediante fábricas inyectadas. Requiere `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false` en ambos clientes.
- Verifica `getClaims(token)`, `getUser(token)`, proyecto, identidad de sesión, propiedad y vigencia mediante `supabaseSupervisedAuth` y la RPC `raxi_supervised_host_identity` del PR #59.
- Requiere las tres banderas `liveEnabled`, `providersEnabled` y `actionsEnabled` en `false`; nunca abre `prepare`, `approve`, `execute`, `revoke`, `runOne` ni `raxi_supervised_host_command`.

## Validación

`apps/raxi-hq/tests/stagingHostComposition.test.ts` prueba con puertos y JWT **sintéticos**: dueño permitido, sesión revocada denegada sin caché, actor extranjero simulado denegado, workspace ajeno, payloads con comandos, credenciales reusadas o ausentes, proyecto incorrecto y banderas activas. La prueba **NO es una prueba alojada con JWT real ni con proveedor IA**.

Nueva GitHub Action solo de CI local: TypeScript, suite integral, build Vite y auditoría npm. No usa secretos, SQL remoto, Vercel ni Supabase hospedado.

## Próxima secuencia segura

1. Obtener CI PASS y revisión independiente de los cambios, sin merge automático.
2. Un futuro PR diferente implementará el *adapter real* a la SDK Supabase en Node y una ruta de diagnóstico, con pruebas de autenticación bajo sesión única. Ese PR necesitará autorización específica antes de alojar o proporcionar credenciales en el servidor.
3. Comprobar revocación **con otra sesión del mismo propietario** (navegador/perfil aislado) sin interrumpir la sesión principal. Comprobar que la RPC de identidad rechaza la sesión revocada inmediatamente; no inferir garantía de revocación de un JWT por validación criptográfica sola.
4. Diseñar después una única tarea REAL de texto para el Director, con aprobación humana persistente, modelo/proveedor seleccionado, precio y presupuesto máximo, expiración y capacidad de revocar; sin ejecución automática del Investigador.
5. Activar providers / ejecutar el piloto solo con autorización independiente y verificaciones efectivas de recibos/eventos `AGENT_EXECUTOR / VERIFIED / simulated=false`.

**Reglas vigentes:** producción fuera de alcance; cero nuevas migraciones, host público, credenciales, proveedores, ejecuciones, consumos facturables o publicaciones en este cambio.

### Fuentes de diseño

- Supabase Auth sessions: https://supabase.com/docs/guides/auth/sessions
- Supabase JavaScript getClaims: https://supabase.com/docs/reference/javascript/auth-getclaims
- Vercel Node.js Functions: https://vercel.com/docs/functions/runtimes/node-js
- Issues relacionados: #60, PR #68 y PR #69.
