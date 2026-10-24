# Contratos del host supervisado — evidencia

Base main `01aa6155a45cbe5e4b66f8ab2035b9d7899e78a9`, merge de #16 confirmado por Git y API GitHub. Rama nueva `feature/raxi-hq-supervised-host-contracts` en checkout separado, limpio antes de editar. Las diez eliminaciones locales JPEG del checkout original se conservan y no forman parte de este diff.

## Cobertura

Se reutilizan el validador `taskSpec`, tipos de etapa/repositorio y `runOne`, el proveedor `simulatedProvider`, `inspectSupervisedPreflight` y la proyección Office existentes. La revisión detectó que regex podía convertir provider/model ausentes o no textuales en strings implícitos. Se añadió el chequeo de tipo al validador común y una regresión, evitando duplicarlo en la política nueva. No se modifica el coordinador, proveedor, preflight o proyección. Los únicos adaptadores ejecutados son fixtures explícitos en el archivo de tests, sin Auth/SQL/Supabase o red.

Regresiones nuevas: identidad anónima/ajena/caducada; capacidad ausente; falsa procedencia de Auth; aprobación rechazada/revocada, de otro actor/tarea/workspace, digest/presupuesto/proveedor/modelo o versión incompatible; aprobación caducada mientras se espera identidad; política deshabilitada, real o vencida; reserva teórica/saldo y topes de tokens; scope digest estable y vinculado; mutación asíncrona; orden/estados inválidos y duplicación de intentos; resultado incierto, recibo conservado y ausencia de retries; claims concurrentes en memoria; conflicto/ausencia/coincidencia de conciliación sin borrar comando; revocación antes del despacho con cero llamadas simuladas; cambio de cuenta; Director → Investigador simulado sin actividad REAL en Office.

Durante el desarrollo se corrigió una aserción que esperaba rechazo asíncrono en lugar del error sincrónico de validación de ID, sin relajar el control. Una ejecución posterior quedó interrumpida antes del resumen y no se contó como PASS. La recuperación ejecutó de nuevo toda la cadena sobre el código final: **55/55 pruebas enfocadas PASS**, incluidas en el corredor completo, sin sumarlas dos veces.

## Comandos reales y resultados

Desde `apps/raxi-hq`, con `NODE_USE_SYSTEM_CA=1` y sin desactivar TLS:

- `npm ci --ignore-scripts --no-audit`: PASS, 166 paquetes, lockfile sin cambios.
- `npm run build`: PASS, incluida comprobación del bundle existente y compilación servidor/frontend.
- `npm run typecheck`: PASS.
- `npm test`: **498/498 PASS**, cero fallos, canceladas u omitidas; duración 109.671,9627 ms.
- `node --test tests/stagingSafety.test.mjs`: **1/1 PASS**. Total: **499/499 PASS**.
- Suite enfocada `supervisedHostContracts.test`: **55/55 PASS**, ya incluida en las 498.
- `npm audit --json`: **0 vulnerabilidades**.
- `git diff --cached --check` e inspección local de patrones de secretos/rutas temporales: PASS en los seis archivos previstos. Se revisaron admisión, scopes/digest, procedencia, estados, retención e imposibilidad de habilitar real desde el input. Esta revisión local no acredita una auditoría de servicio desplegado.

Logs locales ignorados: `.validation/recovery-install.log`, `recovery-build.log`, `recovery-typecheck.log`, `recovery-tests.log`, `recovery-guard.log`, `recovery-focused.log` y `recovery-audit.json`. No se incorporan auxiliares, credenciales ni dependencias al commit. Las regresiones y comandos quedan versionados para reproducir los resultados.

Los tests completos existentes utilizan PGlite y propuestas SQL previas en bases locales nuevas; este incremento no escribe ni cambia SQL, no ejecuta CLI Supabase ni aplica migraciones. No se ejecuta el runner de staging alojado. Los fixtures y el journal en memoria no prueban autenticación alojada, RLS real, contención entre conexiones físicas ni persistencia duradera.

## Límites y funciones desactivadas

`LOCAL_CONTRACT_ONLY` / `SIMULATED` / `liveEnabled:false` no autorizan gasto. La reserva inspeccionada no es un asiento contable y MATCHED_LOCAL no confirma un commit. Ningún host, endpoint, proveedor real, trabajador, cron, botón UI o servicio se habilita. No hay nuevas credenciales, publicación social ni escrituras de producción. Creación de rama y PR en borrador son los únicos efectos GitHub autorizados de entrega.
