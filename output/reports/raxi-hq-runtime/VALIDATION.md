# Preparación de ensayo y primer runtime — 2026-10-21

Segunda corrección P1 del PR #13: [expiración y resultado serializado](P1_EXPIRY_RESULT_SIZE.md), **352/352 PASS**, build/typecheck PASS y npm audit 0. Incluye regresiones SQL, panel React montado/proyección Pixi, cuatro fuentes máximas, Unicode/escapes y límites exactos; sin ejecución IA auténtica ni despliegues.

Actualización P1 del PR #13: [revocación de política](P1_POLICY_REVOCATION.md), **339/339 PASS**. Los resultados de 332 que siguen corresponden al incremento original.

## Estado recuperado

Checkout inicialmente limpio en `feature/raxi-hq-v1.0-campaign-strategy-persistence`, HEAD `27a7efe`. Se verificó que estaba integrado en origin/main y main avanzó únicamente por fast-forward a `43b1ec3213c52b74ad0006c4499790533815bf40`. No se descartaron cambios ni quedaron commits locales fuera de ese historial.

La comprobación remota de solo lectura comparó primera idea, su registro de creación/auditoría, conteos y las cuatro migraciones con la evidencia previa: PASS, sin diferencias. El navegador autenticado sigue mostrando la idea original y auditoría 2. No hubo escrituras de aceptación en producción.

## Validación de base y staging

Se detectó una regresión de checkout Windows: comparación LF/CRLF del bundle generado. Ambos PR incluyen la misma corrección mínima del verificador, sin modificar el bundle ni aceptar cambios semánticos. Build/typecheck y 321/321 pruebas existentes PASS tras corregir la comparación. No se afirma que el build original sin esa corrección pasara después del checkout.

PR de ensayo separado: `feature/raxi-hq-staging-readiness`, commit `76073c196bc440e841a5a75179d8508ba3582c49`, PR #12. Incluye runner alojado opt-in y una prueba local de su guard PASS. No se ha ejecutado el runner contra ningún proyecto. Auth alojado, concurrencia física y aceptación remota continúan pendientes de autorización de coste/entorno.

## Runtime: resultados locales

- `npm run build`: PASS, incluye TypeScript del servidor y bundle frontend.
- `npm run typecheck`: PASS, frontend y `server/agent-runtime`.
- `npm test`: **332/332 PASS**, 321 existentes y once pruebas nuevas.
- `npm audit --audit-level=low`: cero vulnerabilidades.
- Escáner de aplicación: único literal de nombre de campo del SDK conocido y comprobado, sin credencial. Comprobación del bundle no encuentra endpoint de OpenAI, secreto de fixture ni RPC de claim del worker.
- Revisión de fronteras: Auth/propietario, autorización humana, reserva transaccional de presupuesto, permisos invoker, leases null-safe, recibos obligatorios, identidades/etapas fijadas por servidor, índices de exclusión de intentos activos y separación navegador/servidor. Esta revisión local no sustituye una auditoría externa.

Pruebas nuevas: handler autenticado de fixture → SQL real de propuesta sobre **las cuatro migraciones de v0.9** → Director/Investigador simulados → resultado persistido → proyección de oficina; replay, continuación tras reinicio, presupuesto, actor ajeno, expiración y trabajador tardío, incertidumbre sin segundo cargo, proveedor live deshabilitado sin llamadas de red, contenido externo malicioso sin permisos, fuentes/hashes y panel React en Strict Mode. El resultado simulado no crea agentes reales ni eventos VERIFIED. PGlite usa una sola conexión; contención física sigue pendiente de ensayo.

## QA

Inspección del Campus REAL autenticado: tarjetas/detalle existentes intactos, campañas sin lectura confirmada y aviso de despliegue pendiente. Nuevo panel propio claramente separado de Munder, sin agentes ejecutándose y con solicitud deshabilitada. La captura [runtime no desplegado](runtime-disabled.png) acredita ese estado; no acredita una ejecución IA auténtica.

QA de cierre: escritorio 1440 px y móviles 390/320 px, sin desbordamiento horizontal (ancho de documento igual al ancho disponible en las tres medidas). Se inspeccionó la legibilidad y el botón deshabilitado en [móvil](runtime-mobile-disabled.png), restaurando después el viewport del usuario. La proyección simulada permanece excluida de agentes REAL en las pruebas; no se poblaron fixtures en producción para capturar imágenes.

## Recuperación y cierre del runtime

Antes de editar se recuperó la rama independiente con 18 archivos versionables preparados, sin cambios adicionales fuera del índice; no se encontraron 24 archivos versionables pendientes ni se descartó material. Se conservaron auxiliares y logs ignorados. La regresión financiera estaba implementada y se repitió: lease insuficiente evita contactar al proveedor, un coste de fixture de 100 frente a reserva 10 queda registrado y la política se deshabilita. Son cantidades simuladas, no cargos reales. La ejecución final volvió a confirmar **332/332 PASS**, build y typecheck correctos, npm audit cero vulnerabilidades y archivos preparados sin credenciales. No se modificó código del PR #12 para este cierre.

Consulta de revisión del PR #12, HEAD `76073c1`: Codex figura Running; no hay reviews ni hallazgos publicados en el momento de la consulta. [Estado remoto consultado](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/12#issuecomment-6321332210). No se afirma que haya aprobado ni que esa revisión haya terminado.

## Límites y conexiones pendientes

No se creó Supabase de ensayo, no se aplicó la quinta migración ni el SQL de runtime, no se desplegaron funciones o workers, no se invocó IA de pago ni Aria. El SQL de runtime está fuera de `migrations/` y requiere revisión. El núcleo servidor se monta por composición; faltan host/cola y verificador Auth real de ese host. El botón de solicitud aún no habilita el formulario humano de producción.

Primera prueba auténtica propuesta: dos llamadas de texto con proveedor/modelo a elegir, máximo 256 tokens de salida por llamada, sin búsqueda externa, una tarea y cota monetaria previamente cotizada/aprobada. Faltan proyecto aislado, host, secretos, cuenta API con facturación/límite y autorización humana. Investigación externa requerirá además recuperador seguro de fuentes. La reserva de aplicación no sustituye el límite de facturación del proveedor. Véase `docs/RAXI_HQ_FIRST_AGENT_RUNTIME.md`.
