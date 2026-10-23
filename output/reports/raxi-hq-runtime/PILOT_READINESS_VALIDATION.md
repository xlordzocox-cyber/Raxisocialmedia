# Preparación de agentes — evidencia local

Fecha: 22/10/2026. Base main `8e906d499a703f6db95681870cce13eb244232db`; rama `feature/raxi-hq-agent-pilot-readiness`. Árbol inicial limpio, fast-forward sin descartes. Git y API de GitHub confirmaron PR #12, #13 y #14 integrados.

## Comprobaciones

- Instalación reproducible: `npm ci --ignore-scripts --no-audit`, PASS. No ejecución de scripts de instalación de paquetes.
- Main: build y typecheck PASS; 356/356 pruebas de aplicación y 1/1 guard de staging separado, cero omitidas.
- Auditoría: `npm audit --json`, cero vulnerabilidades reportadas.
- Rama de preparación: build y typecheck PASS; **368/368 pruebas de aplicación + 1/1 guard de staging = 369/369**, cero fallos, canceladas u omitidas. La suite completa terminó en 157.818,6474 ms. Se recuperaron los logs finales de la ejecución terminada; no fue necesario repetirla tras cambios exclusivamente documentales.
- Regresiones nuevas: presupuesto offline de dos etapas, límite de entrada/salida, techo humano, redondeo por etapa, enteros/positividad y caducidad exacta. La salida no autoriza ejecución.
- Regresiones conservadas: campañas y Strategy montados, REAL/DEMO, cuentas, idempotencia, rollback, respuesta perdida, revocación REAL/simulación en ambos sentidos, lease, coste superior a reserva, recibos inciertos, expiración sin elevar MOCK, cuatro fuentes máximas/Unicode/escapes/SHA-256 y exclusión visual de simulaciones.

## Límites de evidencia

No hay prueba IA auténtica: todos los proveedores contactados por los tests son fixtures o transportes locales. No hubo llamadas OpenAI, generaciones Aria, SQL aplicado, workers activados, infraestructura creada ni datos de producción escritos.

Supabase CLI: listar proyectos falló por transporte; SELECT con referencia explícita no se ejecutó por falta de IPv6. Es un bloqueo de esa conexión, no evidencia de caída de Supabase. Luis informó una consulta independiente exitosa: cuatro migraciones, primera idea REAL y auditoría presentes, cero campañas/agentes activos y únicamente `create-real-idea` desplegada. Esta evidencia externa no acredita una comparación completa de filas por Codex ni pruebas nuevas de Auth alojado, permisos RLS entre cuentas, escritura Edge o trabajadores. Navegador: inicialización fallida antes de leer la página; no hubo QA visual interactivo acreditado. Sí se ejecutaron las regresiones de componentes montados.

Supermemory devolvió el documento de decisión existente sin modificación. Aria respondió a `mis_personajes`; eso acredita conexión MCP de Codex, no integración ejecutora de HQ ni permiso para generar. La disponibilidad del modelo en la cuenta API permanece sin comprobar. Los precios se consultaron en documentación pública oficial; no se compró ningún servicio para cotizar.

## Revisión del cambio

Solo un módulo de planificación sin red/credenciales/estado mutable, pruebas y documentación. No cambia SQL, permisos, frontend, activación de proveedores o configuración del host. La cotización tiene vencimiento y no se usa como aprobación humana ni límite de facturación. Antes de una llamada auténtica faltan medición completa de tokens, conservación de recibos/uso ante fallo de decodificación, configuración de facturación y despliegue aislado autorizado.

Los cuatro archivos publicados son `server/agent-runtime/pilotBudget.ts`, `apps/raxi-hq/tests/agentRuntime.test.ts`, `docs/RAXI_HQ_AGENT_PILOT_READINESS.md` y este informe. `.validation/` está ignorado y sin archivos rastreados: logs, consultas SELECT, transportes auxiliares, mensajes de commit/PR y respuestas de herramientas permanecen locales. El control del diff staged rechaza rutas temporales, entornos privados y patrones de secretos; pasó en los cuatro archivos. `git diff --cached --check` también pasó. Es una revisión local del cambio y patrones, no una auditoría de un servicio desplegado.
