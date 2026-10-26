# PR #19 — P2: integridad del journal

Hallazgo revisado: [discussion_r4372147740](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/19#discussion_r4372147740), sobre commit `27cb3f29c043bda39f468482b8403587f6559a3e`. El checkout y los cambios locales previos se conservaron.

## Frontera corregida

El replay confiaba en payload.command y devolvía confirmation sin comprobar su digest. La conciliación lo presentaba como FOUND. El rol de aplicación también podía actualizar/borrar esos eventos.

Se añade una validación compartida SQL invoker: recalcula el SHA-256 del comando usando la misma representación jsonb que la persistencia, comprueba la huella de la confirmación completa y valida identidades/versión. Para finish se contrasta resultado, coste y recibo con el run canónico. La recuperación del repositorio usa esa validación antes de acceder a cualquier copia del evento, sin implementar otro serializador de JSON en TypeScript.

La corrupción se distingue con SQLSTATE P1901: replay/confirmation rechazan y reconcile devuelve CONFLICT, nunca FOUND. La indisponibilidad conserva UNAVAILABLE y un registro ausente conserva MISSING. No se modifica la semántica del comando pendiente ni se autoriza retry de proveedor.

Un trigger bloquea UPDATE/DELETE del journal y cambios de clasificación que intenten eludirlo, incluso con service_role. Otros eventos conservan sus permisos de UPDATE/DELETE. TRUNCATE se revoca del rol de aplicación porque omite los triggers por fila. El administrador sigue pudiendo administrar el esquema; no se promete protección contra quien puede desactivar controles y reescribir todos los datos/hashes.

## Revisión independiente recuperada

Journal p2 review dejó una observación parcial: proteger únicamente el hash del comando y los campos de finish no protegía toda confirmation de ack/unknown. La revisión independiente no emitió un veredicto final porque alcanzó el límite de uso. No se presenta como auditoría independiente completada.

Se reprodujo esa observación con una prueba nueva: antes del segundo ajuste falló con Missing expected rejection. Después de persistir y verificar confirmationDigest, la misma prueba pasa. No se inició otra ejecución de revisión independiente ni un proveedor del runtime.

## Regresiones

- Finish confirmado: manipular el comando persistido, reiniciar la base local y rechazar replay SQL directo, replay del repositorio, confirmation y conciliación. El resultado canónico del run permanece intacto y el proveedor no se repite.
- Digest ausente, nulo o alterado, confirmación modificada y comando inválido: CONFLICT/rechazo, sin devolver una confirmación falsa.
- Alterar resultado/recibo/coste de confirmaciones dispatch/ack/unknown también se rechaza; restaurar el evento intacto permite su replay histórico.
- UPDATE, DELETE, cambio de clasificación y TRUNCATE rechazados para el journal; el rol de aplicación no puede desactivar el trigger. UPDATE y DELETE de otros eventos siguen funcionando.
- Coste legítimamente nulo se mantiene nulo; no se inventa coste cero y su replay sigue siendo válido.
- Las regresiones previas conservan versiones, idempotencia, concurrencia local, revocación y recuperación tras cierre/reapertura en disco.

La inyección de corrupción desactiva temporalmente el trigger **solo como administrador del fixture local**. Ninguna operación equivalente se expone en el handler ni se ejecuta en Supabase alojado.

## Verificación

Validación final del 25 de octubre de 2026, sobre los seis archivos de este correctivo:

| Validación | Resultado |
| --- | --- |
| Suite completa: mismos 16 entrypoints de scripts/test.mjs, bundle y comprobación del artefacto Edge | 542/542 PASS; 0 fallos, cancelaciones u omisiones; 191698 ms |
| Integración del host incluida en la suite | 18/18 PASS, incluidos los cuatro bloques nuevos de integridad |
| npm run build | PASS |
| npm run typecheck | PASS |
| node --test tests/stagingSafety.test.mjs | 1/1 PASS; sin conexión alojada |
| npm audit --json | 0 vulnerabilidades en todas las severidades |
| Diff/check y escaneo de secretos staged | PASS; seis archivos, sin credenciales o temporales |
| Estado del checkout original comparado con su baseline | Sin cambios; conserva las diez eliminaciones locales |

Total: **543/543 pruebas PASS** contando el guard separado. Las ejecuciones anteriores interrumpidas no cuentan como PASS. Para el cierre se utilizó el runner existente con los mismos entrypoints, bundle/check y pruebas, limitando únicamente la concurrencia de node:test a 1 mediante un auxiliar ignorado en .validation y NODE_OPTIONS=--max-old-space-size=512; no cambia la configuración del repositorio. La cadena de suite, build, typecheck y guard terminó con código 0; la auditoría independiente también terminó con código 0.

Los logs locales permanecen ignorados en apps/raxi-hq/.validation. Huellas SHA-256 para identificar la evidencia sin versionar auxiliares:

| Log | SHA-256 |
| --- | --- |
| journal-p2-final-tests.log | 84d7672a63ca63713929b019eca91b65a13fa85344b7286c5ffe0d938e0d1531 |
| journal-p2-final-build.log | 515033af7e8a6227a45337fb4691c4b7b7712e4de0981d8522807299b850f1e7 |
| journal-p2-final-typecheck.log | bbe04f6e49318f343e677d30ecba84d350ae7a6da455c741dd6ac3032ba7eb72 |
| journal-p2-final-guard.log | 13ab3819fa237c704731e4b889b511eec1718d9fff7fe74742a2f270431e0c08 |
| journal-p2-final-audit.json | de3ed797396926da2095388a1a7b5798ea3bfd58fef3098cf052238a431ff691 |

No se incorporan logs temporales, credenciales ni auxiliares. No se modifican Guardian, el observador histórico, la UI, el coordinador, las migraciones o proveedores. Las diez eliminaciones de imágenes del checkout original se conservan.

## Límites

Toda persistencia probada es PostgreSQL embebido local (PGlite); no acredita Auth/RLS alojados, conexiones físicas independientes o corte eléctrico. La revisión de seguridad comprende trazado del hallazgo, regresiones de manipulación, permisos y privilegios, diff manual, patrones staged de secretos y auditoría npm. No se afirma una ejecución del servicio Codex Security ni una aprobación de producción.

La nueva huella se exige en todas las lecturas; un registro antiguo sin ella no se acepta ni se repara automáticamente. Los bloqueos de staging/REAL y la reversión conservadora de etapa A permanecen vigentes.
