# Etapa A — validación local y revisión de seguridad

Base: `8c05866733dffde2f1f90f99f89b904e80305d01`, merge de #18. Rama aislada `feature/raxi-hq-supervised-host-stage-a`. **No hay ejecución REAL habilitada.**

Correctivo posterior de integridad del journal: [evidencia P2](SUPERVISED_HOST_STAGE_A_P2_JOURNAL.md). Los resultados siguientes corresponden a la entrega original de etapa A.

## Resultados finales

Desde apps/raxi-hq:

| Comando / revisión | Resultado |
| --- | --- |
| npm ci --ignore-scripts --no-audit | PASS, lockfile sin cambios |
| npm test | **538/538 PASS**, 0 fallos/canceladas/omitidas |
| Regresiones nuevas de etapa A | **14 PASS**, incluidas en las 538, no sumar dos veces |
| npm run build | PASS, bundle de campañas y TypeScript servidor/frontend incluidos |
| npm run typecheck | PASS |
| node --test tests/stagingSafety.test.mjs | **1/1 PASS**, guard local; no conexión alojada |
| Total | **539 PASS** |
| npm audit --json | **0 vulnerabilidades** |
| Diff / patrones locales de secretos staged | PASS; sin credenciales, env, dependencias o temporales incorporados |
| Oficina e histórico #18 | Sin modificaciones; sus regresiones existentes permanecen en la suite |
| Checkout original | Diez eliminaciones JPEG conservadas; comparación binaria de git status sin diferencias |

Logs ignorados: host-final-tests.log, host-final-build.log, host-final-typecheck.log, host-final-guard.log y host-audit.json dentro de .validation. No se incluyen auxiliares ni datos de prueba en el commit.

Una ejecución inicial enfocada detectó dos errores del fixture: intentaba reclamar otro Director mientras el anterior seguía activo, y crear un trigger de fallo con el rol de aplicación. Se conservaron las restricciones: el fixture cierra explícitamente su intento anterior como incierto y solo instala el trigger de prueba con el rol administrador, restaurando service_role antes del recorrido. No se relajaron permisos ni índices para hacer pasar las pruebas.

## Alcance de las 14 regresiones nuevas

1. Handler: identidad fixture válida frente a sesión desconocida, anónimo, falso SUPABASE_AUTH, actor/propietario ajeno, expiración, permisos inyectados, proveedor real y etapa inválida. Confirmación manual obligatoria.
2. Director e Investigador: dos tareas, aprobaciones y reservas; Director COMPLETED no crea/encola Investigador.
3. Dependencia: Director inexistente o resultado modificado y aprobación de otra tarea no permiten continuar.
4. Preparación/aprobación/claim concurrentes: una reserva y un efecto simulado; payload distinto bajo la misma clave es conflicto.
5. Presupuesto insuficiente y política modificada/vencida: rechazo atómico, sin aprobación parcial ni llamada.
6. Revocación en dispatch: **cero llamadas**; un dispatch aceptado conserva CLAIMED y no produce ACK/RUNNING.
7. Journal: replay exacto, huella canónica y versión; conflictos de payload, versión y falsa evidencia REAL rechazados.
8. Confirmación de dispatch perdida, reapertura de la base desde disco y lease vencido: no se repite proveedor ni run.
9. Fallo de journal tras el step: rollback de estado y evento juntos; recibo ACK ya confirmado sobrevive a reapertura.
10. Cuentas/roles/claves: rechazo de propietario ajeno, RPC anónima y reutilización incompatible de clave de ejecución.
11. Una llamada simulada seguida de pérdida de confirmación final: se recupera el commit canónico tras reinicio sin repetir efecto.
12. Fallo antes de commit final: UNKNOWN y recibo ya confirmado; UNAVAILABLE no se convierte en MISSING ni en autorización de retry.
13. Cambio a política REAL rechazado: **cero llamadas**. Proveedor simulado permitido: **cero solicitudes fetch**.
14. Validación SQL directa: expiración ausente, tipos coercionados y campos de autoridad adicionales rechazados antes de insertar.

Los reintentos de persistencia usan el mismo identificador de operación y contenido. Ninguna prueba realiza llamadas a OpenAI, Aria ni proveedores externos. El coste de la simulación es cero; las reservas de tests son unidades ficticias.

## Revisión de seguridad del diff

Revisión local manual de los cambios y sus dependencias, regresiones adversariales, inspección staged de patrones de secretos y auditoría npm. **No es una ejecución del servicio Codex Security ni una certificación de seguridad del host alojado.**

| Frontera | Control inspeccionado | Límite |
| --- | --- | --- |
| Identidad | Puerto confiable, LOCAL_FIXTURE obligatorio, no actor desde cuerpo, vigencia y propietario | No valida JWT alojado; no etiquetarlo como Supabase Auth |
| Entrada | Método/tipo de contenido, UTF-8 y tamaño, allowlist por acción, validador taskSpec común | Handler sin listener ni rutas públicas |
| Autoridad / dinero | Políticas locales, modo simulated obligatorio, aprobaciones por tarea y reserva transaccional | No facturación ni reserva real de dinero |
| SQL | SECURITY INVOKER, search_path vacío, RPC restringidas a service_role y comprobación explícita de propietario | No se han probado grants/RLS en Supabase alojado |
| Journal | Versión y clave única, cambios atómicos, datos canónicos y exclusión de lease_token de eventos/respuestas | No garantiza recuperar una respuesta jamás persistida |
| Ejecución | Un runOne manual, proveedor simulado fijo, sin continuación automática | Sin host activo, worker, publicación o proveedores facturables |
| Procedencia | MOCK/UNVERIFIED y LOCAL_FIXTURE; dispatch no significa procesamiento activo | Las pruebas son simuladas, nunca aceptación REAL |
| Privacidad | Sin secretos ni rutas de conexión; eventos/resultado limitados al propietario local de ensayo | Bandeja de archivos no implementada; ACL Windows pendiente si se propone |

Guardian automático sigue inactivo y sus reglas no cambian. El alcance de revisión cubre el handler, repositorio/journal local, contrato extendido, las dos propuestas SQL y pruebas; el resto de la suite comprueba regresiones existentes. No se afirma una auditoría exhaustiva del repositorio.

## Metodología y aceptación

| Incremento | Do | Done when | Verify | Checkpoint |
| --- | --- | --- | --- | --- |
| A local | Handlers, admisión independiente y journal usando entidades existentes | Pruebas locales pasan, respuesta distingue LOCAL de alojado y REAL sigue inhabilitado | Comandos anteriores, todos con exit 0 | Revisión humana del PR en borrador antes de integrar |

EARS: CUANDO se repite exactamente una operación, EL SISTEMA DEBERÁ conservar una sola reserva/run y devolver su confirmación. CUANDO se revoca antes del dispatch, EL SISTEMA DEBERÁ realizar cero llamadas. CUANDO el journal está inaccesible, EL SISTEMA DEBERÁ conservar incertidumbre y no autorizar retries. CUANDO termina Director, EL SISTEMA DEBERÁ esperar una tarea/aprobación independiente del Investigador.

## Limitaciones y reversión

PGlite utiliza PostgreSQL embebido. La concurrencia probada son llamadas concurrentes contra esa instancia; no demuestra locks entre conexiones físicas o procesos independientes. Los ensayos en disco realizan cierre/reapertura controlados, no corte eléctrico ni crash del sistema operativo. Auth y aprobación humana son fixtures explícitos.

No se implementó una bandeja de archivos sin acreditar su aislamiento/retención en Windows. El recibo que no llegó al primer commit podría perderse ante caída del proceso: permanece UNKNOWN, sin repetición automática. Esto **bloquea una llamada facturable** hasta revisar una solución y probarla.

No se aplicó SQL, migración o dato a un servidor alojado. Antes de B: staging autorizado, revisión de esquema y privilegios, cuentas auténticas, sesiones/revocación y concurrencia física. Antes de C: captura duradera de evidencia, transporte/preflight real, medidor, cotización vigente, proveedor/modelo y autorización explícita del coste. No se reusan precios caducados.

Reversión: mantener el host sin montar; retirar su composición impediría nuevas solicitudes. Conservar journal y reservas para conciliación; nunca borrar intentos inciertos ni ejecutar downgrade destructivo. Las propuestas SQL no exigen cambios en producción. Detalle del diseño y dependencias: [contratos de etapa A](../../../docs/RAXI_HQ_SUPERVISED_HOST_STAGE_A.md).
