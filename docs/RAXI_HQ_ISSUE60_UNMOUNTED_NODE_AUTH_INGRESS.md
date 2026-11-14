# Raxi HQ · Issue #60 — entrada de diagnóstico Auth de Node (SIN PUBLICAR)

**Estado:** código no montado; PR en borrador. Solo preparación y QA offline. No existe una nueva ruta accesible en Vercel ni se ha autorizado desplegar el host.

## Decisión de alcance

Raxi HQ tiene **una sola cuenta humana de propietario**. Su sesión real en Android aprobó 4 de 4 comprobaciones del frontend del PR #69. Esa evidencia **NO acredita** todavía la sesión revocada ni un diagnóstico hospedado del host Node.

## Contrato de entrada

`apps/raxi-hq/server/stagingNodeAuthIngress.ts` recibe por inyección el handler Auth-only del PR #71, la **URL HTTPS exacta de la Preview** y un port de admisión independiente. El archivo NO reside bajo `api/`, NO exporta la firma de una función Vercel ni crea listeners, endpoints, workers, cron, proveedores o acciones. Única ruta lógica prevista: `/api/raxi-hq/runtime-auth-readiness`. Esta ruta **no está publicada ni registrada**.

Verificaciones fail-closed antes del Auth:
- URL de solicitud con origen aprobado exacto, ruta exacta y sin query ni fragmento. `approvedOrigin` requiere HTTPS, un dominio de Preview `raxi-hq-staging-...` dentro del equipo de Vercel configurado; no acepta wildcard. La aprobación del origen **y su correspondencia con el deployment ID** debe hacerla el operador durante el futuro despliegue.
- Solo `POST`, `Origin` exacto, `Sec-Fetch-Site: same-origin` cuando esté presente. No se emiten encabezados CORS. El `Origin` es una defensa adicional, NO autentica por sí mismo: Bearer JWT firmado, usuario, sesión y ownership siguen siendo obligatorios.
- Solo JSON; formato `Bearer` acotado; `Content-Length` declarado superior a 256 bytes denegado. El handler real del PR #68 aplica límite de **256 bytes al flujo real** aunque se omita `Content-Length`.
- Se requiere `TrustedIngressContext.rateKey`, construido **por una fuente confiable del servidor**, y un `admission.admit(rateKey)` explícito. Los encabezados `X-Forwarded-For` y `X-Real-IP` del cliente NO definen el rateKey; jamás confiar en ellos sin un proxy controlado. Si no hay identidad confiable o falla el control, se rechaza; si se excede la cuota, 429. Este código **NO implementa todavía** un limitador persistente compartido: deberá conectarse a un almacén/servicio real y probarse antes de publicar.
- No se propagan `Set-Cookie`, `Access-Control-Allow-Origin` ni otros encabezados accidentales del handler subyacente; respuesta `no-store`, `nosniff`, `no-referrer`, `CORP same-origin`, `CSP default-src 'none'`.

## Límites que no deben confundirse con garantías E2E

El ingreso solo inspecciona un objeto `Request`. Una **futura ruta Node** debe construir `Request.url` desde el origen confiable de Vercel y comprobar cabeceras de proxy bajo sus reglas; no reutilizar `Host`, `Origin` o `X-Forwarded-Host` como prueba de autoridad. Debe configurarse SSO/protección de Preview, WAF o límites de ingreso relevantes, limitador transaccional con cuota, límite de concurrencia, timeout y observabilidad sin tokens. Si el almacenamiento del rate limiter falla, la ruta debe permanecer cerrada.

La **secret key server-only** de Supabase no se añade al repositorio ni al build web. No se crean credenciales ni env vars en esta etapa. Proveedores y `runOne` continúan desconectados.

## Validación y siguiente gate

`apps/raxi-hq/tests/stagingNodeAuthIngress.test.ts` prueba con fixtures: origin/cross-origin, path y query, GET/OPTIONS, JSON/Bearer inválidos, longitudes, ausencia/caída del limitador, rechazo por cuota, inyección de encabezados proxy y salida CORS cerrada. Además compone el Auth probe real con un flujo >256 bytes y verifica que no contacte identidad.

Workflow `raxi-hq-node-auth-ingress-qa.yml` ejecuta TypeScript, suite completa, Vite build y auditoría npm, sin deploy.

**Orden posterior:** revisión independiente de HEAD exacto → resolver hallazgos → registrar la rama base encadenada (#68 → #70 → #71 → PR actual) → solicitar autorización distinta si se desea **montar y publicar** un endpoint diagnóstico en una Preview aislada → probar la revocación desde otra sesión de la **misma cuenta**, manteniendo la sesión principal intacta → recién entonces plantear piloto real Director IA, con proveedor/modelo, tope de coste, segunda autorización persistente, vigencia, recibos y control de apagado. Nunca publicar ni gastar automáticamente.

**Sin autorización en este cambio:** producción, SQL, edición de secretos, servicio HTTP, despliegue Vercel, operaciones reales de agentes, cron, publicaciones, Aria Studio, FanView o crédito de proveedores.

Referencias: [Issue #60](https://github.com/xlordzocox-cyber/Raxisocialmedia/issues/60), PRs #68, #69, #70, #71; [Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [sessions](https://supabase.com/docs/guides/auth/sessions).
