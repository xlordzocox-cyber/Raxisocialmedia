# Issue #60 — Runtime REAL en la oficina principal (incremento apilado)

**Estado:** DRAFT / NO-GO. Base: PR #61 (commit `b34a610d1af2c5b345438e5ede83d645091d8063` al crear la rama). **No integra ni despliega runtime alojado.**

## Problema confirmado

`App.tsx` dibuja la oficina grande mediante `hqStore` y el origen `disconnectedLiveSource` para Munder. `RuntimeOfficePanel` tiene un `RuntimeOfficeStore` independiente y, si existen agentes, crea un *segundo canvas*. Por tanto, el estado del runtime no llegaba al Dock, Inspector o escena principal.

## Solución implementada

1. `RuntimeOfficePanel` conserva validación del snapshot mediante `projectRuntime(raw, owner, workspace)` y obtiene el resultado **solo leyendo** `raxi_runtime_office`. Su nuevo callback opcional `onRuntimeSnapshot` envía `{owner,workspace}` y la `HQState` ya validada. Cuando hay error, desconexión, desmontaje o cambio de sesión, emite `null`.
2. Cuando hay un receptor principal, `RealIdeaCenter` establece `renderCanvas=false` para **no renderizar otro OfficeScene**. El panel de estado permanece.
3. `mainOfficeSource` selecciona la proyección runtime únicamente si: Campus REAL, identidad del usuario/propietario coincidente, workspace idéntico al confirmado en `RealIdeaStore` para el usuario autenticado, modo `LIVE_READ_ONLY`, fuente `runtime`, `connection=CONNECTED`, `mockMode=false`. En cualquier otro caso retorna *sin mutar* la proyección original de `hqStore`, que permanece desconectada si Munder no tiene proveedor.
4. `App` usa el estado seleccionado **en el único OfficeScene principal** y en `AgentDock`, `AgentInspector`, `AgentTaskBoard`, `HandoffTimeline`, `AgentSignalsPanel`, eventos y diagnósticos. Los controles de ejecución continúan deshabilitados; sin writes.
5. `App` se suscribe al snapshot canónico de `RealIdeaStore` y permite runtime únicamente durante `ready`/`saving` con workspace ya validado y propietario autenticado. El callback vuelve a leer ese store al recibir eventos; ignora envíos atrasados de un workspace distinto o en Campus DEMO. Cambios de workspace, salida o vuelta a Campus DEMO descartan selección/snapshot de runtime. Click en agente/evento durante runtime nunca invoca `hqStore.selectAgent/selectEvent` de Munder, evitando contaminación cruzada.
6. `ExecutionObserverPanel` conserva su fuente histórica/observadora original, **no se falsea** como ejecución activa.

## Reglas de veracidad

- Cero eventos runtime => cero agentes atribuidos a runtime.
- Un evento `RUNTIME_DISPATCH_AUTHORIZED` verificado significa **WAITING / despacho autorizado**; no significa proveedor activo.
- Un ACK de proveedor verificado y lease actual permite `RUNNING`; completado/vencido no vuelve a movimiento.
- La ruta animada es una representación de una transición real, no una ubicación física.
- Desconexión o sesión ajena nunca conserva avatares activos.
- No hay creación de tareas, generación, gasto, publicación, acceso a Fanvue ni activación de proveedores.

## Evidencia de QA focalizada ejecutada

- En el archivo exacto de PR #61 `runtimeOfficeStore.ts` (Git blob `4d7e5bf25dbc0f120c745f5a2afc6a1e4acb1e28`) se ejecutaron **9/9 pruebas locales focalizadas PASS** y compilación TypeScript aislada PASS.
- En `mainOfficeSource.ts` (Git blob `7492cacd9cf3cfa000e6c82742e558a31baf0ba2`) se ejecutaron **9/9 pruebas locales focalizadas PASS** y TypeScript aislado PASS, incluyendo usuario ajeno, entorno DEMO, desconexión, `mockMode`, workspace vacío, selección antigua y respeto de reproducción histórica.
- **NO son** la suite oficial `npm test`, ni `tsc -b` completo, ni `vite build` del proyecto. No se dispone de un checkout completo con dependencias en el entorno de QA. Esos gates permanecen pendientes.
- Pruebas adicionales añadidas a `agentRuntime.test.ts` para escenario React y el encaminamiento de `RuntimeOfficePanel` sin segundo canvas; **pendientes de ejecución de la suite oficial**.

## Correctivo posterior · alcance y validación pendiente (14-nov-2026)

- `mainOfficeSource` ahora **exige** `activeWorkspaceId` verificado y compara exactamente `owner` y `workspace`, además de los filtros originales de fuente, conexión, MOCK e histórico. Un callback con scope de otro workspace no puede reemplazar la oficina principal.
- `App` usa `useSyncExternalStore` para observar el workspace REAL autenticado. Se preserva la visualización mientras una idea se guarda en el mismo workspace previamente validado, pero no mientras la identidad o el workspace sean desconocidos o estén recargándose.
- `onRuntimeSnapshot` consulta el estado vigente de `RealIdeaStore` al entregar cada snapshot y rechaza scopes anteriores, sesiones ajenas y Campus DEMO. Un efecto limpia snapshots retenidos al cambiar el contexto.
- Se ampliaron los casos de `agentRuntime.test.ts`: workspace distinto, workspace aún no confirmado, antiguo workspace, propietario distinto y helper de scope. **Las pruebas añadidas no se declaran PASS hasta su ejecución.**
- Los **9/9 PASS anteriores** de `mainOfficeSource.ts` corresponden al blob **anterior** `7492cacd9cf3cfa000e6c82742e558a31baf0ba2`, no a este correctivo. Typecheck del proyecto, suite completa, build, QA de navegador y revisión independiente siguen pendientes.
- No se cambian contratos SQL, Supabase, Vercel, migraciones, permisos de proveedores ni ejecución real.

## Prerrequisitos para activar

1. Completar QA e inspección independiente de los PR #59, #61 y este cambio.
2. Aplicar (solo con autorización nueva) SQL canónico de runtime, RPC `raxi_runtime_office`, receipts, RLS/grants y host de ejecución, y validar su despliegue por SHA exacto **en staging únicamente**.
3. Autorizar por separado una única ejecución real de texto (proveedor/modelo, techo de coste, expiración, identidad) y observarla en el canvas principal.
4. Validar reconexión, desplazamiento y parada en navegador real, con evidencia visual y auditoría. No habilitar trabajo nocturno ni publicar.

**NO-GO:** No merge automático, migraciones remotas, Edge deploy, service_role, providers, gasto o producción a partir de este PR.
