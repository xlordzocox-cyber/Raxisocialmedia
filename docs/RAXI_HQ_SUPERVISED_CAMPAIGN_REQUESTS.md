# Solicitudes supervisadas desde Campaign Workspace REAL

Issue #58. Base de trabajo `af4187a81c79a4c44334243b893c2f44c5bcfe0a` (PR #57).

## Inventario y alcance

| Pieza | Estado de este incremento |
| --- | --- |
| `CampaignSnapshot` | El contrato canónico procede de `raxi_campaign_snapshot`. El parser comprueba propietario, workspace, procedencia REAL, ideas, revisiones y recibos. La versión y la historia editorial provienen del commit de campañas. |
| Elegibilidad editorial | Campaign Workspace ya muestra el resultado de `evaluateCampaign`. El servidor reutiliza el mismo criterio, incluida la concordancia entre recibo editorial, evento de auditoría y revisión APPROVED vigente. DEMO queda fuera. |
| Identidad | El puerto reutiliza el adaptador B1 de Supabase Auth, con clientes de usuario y servidor separados. La propuesta depende de `raxi_supervised_host_identity` para comprobar `auth.sessions` y propiedad. La integración ejecutada aquí usa cuentas sintéticas. |
| Persistencia de solicitudes | Dos RPC propuestas sobre `raxi_audit_events`, sin segundo ledger. La migración de campañas y Strategy y el RPC de identidad B1 son dependencias. La propuesta queda fuera de `supabase/migrations` y del manifiesto de staging. |
| Runtime Director → Investigador | `raxi_runtime_request` admite trabajo real o simulado con la política, aprobación, reserva y auditoría del runtime. Sus tareas, ejecuciones, leases y recibos quedan fuera del puente. La admisión futura deberá reutilizar estos controles y vincular una autorización propia a cada etapa. |
| Despliegue | Este PR no añade Edge Function, ruta pública ni botón de envío. El estado de staging descrito en el issue es una referencia previa. Las comprobaciones de este PR son locales. |

## Contrato

`preflight` y `submit` son handlers de servidor sin ruta asignada. Aceptan JSON UTF-8 de hasta 4096 bytes y un bearer explícito. El único propósito admitido es `PREPARE_VISUAL_BRIEF` para una foto pública de Instagram Feed. El comando cerrado contiene `workspaceId`, `campaignId`, `strategyRevision`, `deliverableId`, `expectedCampaignVersion`, `requestKey` y `purpose`. `submit` añade `snapshotHash` devuelto por preflight.

- `ELIGIBLE` confirma alcance editorial y devuelve una huella SHA-256 de la evidencia canónica y el borrador. El preflight solo lee. La clave forma parte del borrador y debe fijarse antes de la consulta.
- `INELIGIBLE` bloquea comandos inválidos, identidad no confirmada y requisitos editoriales incumplidos. `STALE` exige volver a leer una versión vigente. `UNKNOWN` cubre dependencias indisponibles, datos canónicos inválidos y confirmaciones que no se pudieron verificar.
- `REQUESTED` con `PENDING_HUMAN_EXECUTION_AUTH` solo se devuelve después de confirmar el recibo de la RPC, su actor, el comando exacto y la huella recalculada. `CONFLICT` cubre reutilización de clave con otro cuerpo o intento con otra clave para el mismo workspace, campaña, revisión, entregable y propósito.
- Si se pierde una respuesta, reenviar el mismo cuerpo y clave. El servidor recupera el recibo histórico incluso si la revisión fue sustituida. Ese recibo conserva su fecha y alcance y no concede elegibilidad actual. Una revisión nueva aprobada admite su propia solicitud.

El hash usa JSON con claves ordenadas y arrays en su orden original. La fila guarda las cuatro piezas exactas de evidencia canónica (campaña, Strategy, recibo y evento editorial). Así la huella sigue siendo verificable tras modificar el workspace. PostgreSQL comprueba pertenencia exacta al snapshot. El tamaño de la evidencia está acotado por los contratos editoriales y por el conjunto cerrado de objetos admitidos. No se envía la evidencia en la respuesta HTTP.

## Frontera de seguridad

Las RPC son `SECURITY INVOKER` con `search_path` vacío y ejecución exclusiva de `service_role`. La política existente de lectura de auditoría sigue limitada al propietario. No se amplían grants del navegador. El servidor privilegiado es parte de la base de confianza y debe proporcionar el resultado validado y la evidencia exacta. El SQL añade comprobaciones de sesión, propiedad, pertenencia de evidencia, versión y CAS, pero el código editorial se mantiene en el único evaluador del Campaign Workspace.

El commit usa el mismo bloqueo de fila del workspace que los commits de campaña y de idea REAL. Vuelve a comprobar sesión y replay tras esperar por el bloqueo, compara el snapshot completo salvo `serverTime` e inserta una fila con identidad y hora de servidor. Dos índices únicos protegen la clave y el alcance editorial. El trigger rechaza UPDATE/DELETE de esos recibos y la conversión por UPDATE de otro evento a ese tipo. El rol propietario de la base sigue siendo privilegiado. La fila no cambia la versión de campaña ni crea tareas, aprobaciones de ejecución, reservas, activos ni publicaciones.

El mecanismo de revocación verifica existencia y vigencia de sesión junto con el JWT. No acredita cancelación retroactiva de una transacción ya confirmada ni todas las políticas de refresco del proveedor. Antes de habilitar el endpoint se debe probar revocación con Auth alojado y JWT aún vigente. [Sesiones de Supabase](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

## Evidencia y reproducción

Desde `apps/raxi-hq`:

```text
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
node scripts/verify-staging-preparation.mjs
npm audit
```

La suite usa PostgreSQL aislado mediante PGlite y datos sintéticos. Las pruebas del puente cubren límite de entrada y campos inyectados, identidad y workspace ajenos, revocación antes del commit, Strategy incompatible o sustituida, evidencia editorial alterada, conflicto de versión y CAS, duplicados concurrentes, pérdida de respuesta, conciliación tras recrear el handler y digest incompatible. También comprueban auditoría inmutable, aislamiento por roles y cero tareas, eventos de agentes, activos, trabajos de producción y planes de publicación. El caso de concurrencia solapa dos primeras solicitudes antes del commit, con una conexión SQL serializada. La contención entre conexiones físicas y la recuperación tras reiniciar el servidor PostgreSQL quedan pendientes.

QA en Chrome con `npm run dev -- --host 127.0.0.1 --port 5182 --strictPort` y `/tests/manual/supervisedCampaignRequests.html`. Se observó el entregable sintético elegible con Strategy aprobada y el motivo de bloqueo con Strategy en revisión. El panel mantuvo el requisito de autorización humana separada y carece de acción de envío. El fixture solo monta el Workspace y usa repositorios locales.

## Antes de habilitar la ruta

Revisar la propuesta y el plan de reversión antes de cualquier aplicación remota. Validar roles y RLS en PostgreSQL 17 aislado, contención física y sesiones reales de ensayo. Verificar la identidad del proyecto de destino y bloquear producción antes de configurar el host. Definir rate limiting, timeouts y política de retención de recibos. Antes de una integración visual, añadir confirmación explícita y estado de operación ligado a cuenta, workspace y sesión. Retirar respuestas de generaciones anteriores al desmontar o cerrar sesión y conservar la clave del comando incierto para conciliar al volver con la misma cuenta. La UI futura debe mostrar `UNKNOWN` hasta confirmar y no crear otra clave automáticamente.

La futura autorización de ejecución debe referenciar la solicitud persistida y una revisión aún vigente, especificar proveedor, modelo, tope, expiración y revocación. Aria Studio permanece como proveedor visual canónico. La entrega del Director no inicia ni autoriza al Investigador.

La reversión de este PR es de código. Para una aplicación futura, retirar primero el acceso a la ruta y a las RPC, preservar los recibos históricos y mantener su protección contra alteración. Cualquier retirada posterior de objetos requiere revisión y autorización.
