# Preparación de agentes — evidencia local

Fecha: 22/10/2026. Base main `8e906d499a703f6db95681870cce13eb244232db`; rama `feature/raxi-hq-agent-pilot-readiness`. Árbol inicial limpio, fast-forward sin descartes. Git y API de GitHub confirmaron PR #12, #13 y #14 integrados.

## Comprobaciones

- Instalación reproducible: `npm ci --ignore-scripts --no-audit`, PASS. No ejecución de scripts de instalación de paquetes.
- Main: build y typecheck PASS; 356/356 pruebas de aplicación y 1/1 guard de staging separado, cero omitidas.
- Auditoría: `npm audit --json`, cero vulnerabilidades reportadas.
- Commit inicial `3dc276e`: build y typecheck PASS; **368/368 pruebas de aplicación + 1/1 guard de staging = 369/369**, cero fallos, canceladas u omitidas. La suite completa terminó en 157.818,6474 ms. Se recuperaron los logs finales de la ejecución terminada; no fue necesario repetirla tras cambios exclusivamente documentales de aquella entrega. El correctivo P2 posterior se valida de nuevo abajo.
- Regresiones nuevas: presupuesto offline de dos etapas, límite de entrada/salida, techo humano, redondeo por etapa, enteros/positividad y caducidad exacta. La salida no autoriza ejecución.
- Regresiones conservadas: campañas y Strategy montados, REAL/DEMO, cuentas, idempotencia, rollback, respuesta perdida, revocación REAL/simulación en ambos sentidos, lease, coste superior a reserva, recibos inciertos, expiración sin elevar MOCK, cuatro fuentes máximas/Unicode/escapes/SHA-256 y exclusión visual de simulaciones.

## Límites de evidencia

No hay prueba IA auténtica: todos los proveedores contactados por los tests son fixtures o transportes locales. No hubo llamadas OpenAI, generaciones Aria, SQL aplicado, workers activados, infraestructura creada ni datos de producción escritos.

Supabase CLI: listar proyectos falló por transporte; SELECT con referencia explícita no se ejecutó por falta de IPv6. Es un bloqueo de esa conexión, no evidencia de caída de Supabase. Luis informó una consulta independiente exitosa: cuatro migraciones, primera idea REAL y auditoría presentes, cero campañas/agentes activos y únicamente `create-real-idea` desplegada. Esta evidencia externa no acredita una comparación completa de filas por Codex ni pruebas nuevas de Auth alojado, permisos RLS entre cuentas, escritura Edge o trabajadores. Navegador: inicialización fallida antes de leer la página; no hubo QA visual interactivo acreditado. Sí se ejecutaron las regresiones de componentes montados.

Supermemory devolvió el documento de decisión existente sin modificación. Aria respondió a `mis_personajes`; eso acredita conexión MCP de Codex, no integración ejecutora de HQ ni permiso para generar. La disponibilidad del modelo en la cuenta API permanece sin comprobar. Los precios se consultaron en documentación pública oficial; no se compró ningún servicio para cotizar.

## Revisión del cambio

Solo un módulo de planificación sin red/credenciales/estado mutable, pruebas y documentación. No cambia SQL, permisos, frontend, activación de proveedores o configuración del host. La cotización tiene vencimiento y no se usa como aprobación humana ni límite de facturación. Antes de una llamada auténtica faltan medición completa de tokens, conservación de recibos/uso ante fallo de decodificación, configuración de facturación y despliegue aislado autorizado.

Los cuatro archivos publicados son `server/agent-runtime/pilotBudget.ts`, `apps/raxi-hq/tests/agentRuntime.test.ts`, `docs/RAXI_HQ_AGENT_PILOT_READINESS.md` y este informe. `.validation/` está ignorado y sin archivos rastreados: logs, consultas SELECT, transportes auxiliares, mensajes de commit/PR y respuestas de herramientas permanecen locales. El control del diff staged rechaza rutas temporales, entornos privados y patrones de secretos; pasó en los cuatro archivos. `git diff --cached --check` también pasó. Es una revisión local del cambio y patrones, no una auditoría de un servicio desplegado.

## Correctivo P2 — reloj confiable del proceso (23/10/2026)

Hallazgo: una entrada `now` elegida por el solicitante permitía reutilizar una cotización vencida. Se eliminó del tipo público y se cerró la validación de campos; una carga JSON con `now` se rechaza. `Date.now()` es la única hora de evaluación, obtenida dentro del proceso. También se comprueba finitud de las fechas de la cotización y su orden. No se expone mecanismo de inyección o sustitución del reloj en el módulo productivo.

Regresiones deterministas con mocks limitados al contexto de cada prueba: milisegundo anterior y frontera exacta de `checkedAt`, último milisegundo válido, `expiresAt` exacto y posterior, reloj inválido/infinito, intento de revivir una cotización vencida enviando una fecha antigua/vencida/inválida/nula y rechazo de `now` incluso durante vigencia legítima. Se mantienen los casos de dos etapas, redondeo al alza, tokens y presupuesto, y las salidas `UNAUTHORIZED_PLANNING_ONLY` / `liveEnabled:false`.

Validación nueva del correctivo: build y typecheck PASS; **377/377 pruebas de aplicación + 1/1 guard de staging = 378/378**, cero fallos, canceladas u omitidas; suite completa en 115.375,1714 ms. Auditoría de dependencias: cero vulnerabilidades. Diff y control local de patrones de secretos PASS en los cuatro archivos; `.validation` sigue excluido. Logs locales `p2-clock-build.log`, `p2-clock-typecheck.log`, `p2-clock-tests.log`, `p2-clock-guard.log` y `p2-clock-audit.json`. La cotización no se ha prorrogado ni usado para habilitar gasto. No se modifican SQL, proveedores, despliegues, workers ni producción.
