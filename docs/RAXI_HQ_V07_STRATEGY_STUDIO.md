# Raxi HQ v0.7 — Strategy Studio, Fase 2

Strategy Studio convierte el Campaign Brief de [Fase 1](RAXI_HQ_V07_CAMPAIGN_WORKSPACE.md) en una propuesta editorial que Luis puede revisar y aprobar. No produce contenido ni activa servicios externos. `CampaignRecord / PLANNING` habilita la edición, pero **no** equivale a una aprobación de Strategy.

## Contratos y sesión

Los contratos viven en `apps/raxi-hq/src/campaigns/strategyContracts.ts`. `CampaignStrategyInput` exige audiencia, necesidad, concepto, narrativa, dirección visual, tono, respuesta deseada, criterios de éxito y una matriz de entregables; las notas son opcionales. La audiencia y los criterios son decisiones escritas por Luis, no inferencias de datos o promesas de alcance. Cada `StrategyDeliverable` indica canal, nivel editorial, formato, cantidad, propósito y enfoque creativo para una producción futura. No representa un asset existente, prompt, fecha de publicación ni reserva de publicación.

`CampaignSession.strategies` conserva las revisiones junto con campañas, decisiones y auditoría en una sola proyección de memoria de sesión. La revisión actual es la última de cada campaña. Si falta, la interfaz deriva “No iniciada”; no se crea una estrategia ficticia. El Campaign Brief sigue visible y de solo lectura.

## Matriz y validación

La matriz usa los seis canales y cuatro niveles editoriales canónicos existentes. Cada fila debe emplear un canal y un nivel autorizados por su Campaign Brief. Instagram solo admite `PUBLIC_SOCIAL` o `TEASER`; `TEASER` usa el nivel `TEASER`; FanView Feed y Chat usan exclusivamente sus respectivos niveles privados. Así, ninguna pieza privada se asigna a un canal público. Si el brief no contiene ninguna pareja compatible, la UI lo explica y no ofrece un formulario imposible de guardar. Los formatos `PHOTO`, `CAROUSEL`, `SHORT_VIDEO`, `STORY` y `CHAT_PHOTO` solo describen piezas por producir.

Se exige propósito y enfoque por fila; cantidades enteras de 1 a 30; máximo 12 filas y 30 piezas en total. No hay truncamiento silencioso. La validación rechaza IDs duplicados, arrays dispersos, índices heredados, accesores, cambios de longitud, valores desconocidos y controles invisibles. Los campos editoriales aceptan texto multilínea con LF; no se interpreta HTML. React escapa lo introducido.

## Revisión humana y evidencia

Estados de Strategy: `DRAFT → IN_REVIEW → CHANGES_REQUESTED` o `APPROVED`. Solicitar cambios exige motivo. Desde `CHANGES_REQUESTED` se inicia una nueva revisión `DRAFT` confirmada. Una estrategia `APPROVED` también puede iniciar una revisión nueva, pero solo con confirmación y motivo explícitos. El nuevo borrador no hereda aprobación. Cada campaña admite hasta 10 revisiones.

Cada revisión distingue `revisionReason` (motivo de apertura de esa revisión) de `changeReason` (cambios solicitados durante ella). Abrir una revisión tras una aprobación exige el primero; solicitar cambios registra el segundo sin borrar el primero. Ambos se conservan en el historial de sesión y se muestran con etiquetas separadas. Guardar o enviar el borrador mantiene su motivo de apertura; las revisiones aprobadas anteriores permanecen intactas.

La aprobación exige campaña `PLANNING`, revisión actual `IN_REVIEW` y confirmación humana explícita. Registra `approvedAt` y `approvedBy: LUIS`. La revisión aprobada y sus entregables se conservan como snapshot histórico inmutable; editar exige crear otra revisión. Toda operación usa el clock inyectable al ejecutar la acción, valida cronología y publica campaña, estrategia y auditoría de manera atómica. Los eventos `STRATEGY_CREATED`, `STRATEGY_UPDATED`, `STRATEGY_SUBMITTED`, `STRATEGY_CHANGES_REQUESTED`, `STRATEGY_APPROVED` y `STRATEGY_REVISION_STARTED` llevan campaña, revisión, actor y timestamp, sin datos privados innecesarios.

Las confirmaciones de la UI están ligadas a campaña, revisión y acción. Cambiar la selección las descarta; una confirmación antigua no puede aprobar ni alterar otra campaña. `BLOCKED` y `CANCELED` muestran la estrategia en modo lectura. Reanudar `PLANNING` permite continuar; el guard está también en el reducer.

## Alcance y conexiones futuras

La capacidad sigue siendo `WRITE_INTERNAL`: estado React en memoria mientras la página permanezca abierta. No hay backend, persistencia web, `fetch` externo, generación de imágenes, assets, captions, hashtags, analytics, calendario ni publicación. Aria Studio, Munder, GitHub y Supermemory no reciben escrituras runtime. Assets y producción en Aria quedan para una fase posterior y requerirán sus propias decisiones y controles; aprobar Strategy no las inicia.

La política [RAXI GUARDIAN](security/RAXI_GUARDIAN.md) está activa. Su [guardián automático de ejecución](security/RAXI_GUARDIAN_STATUS.md) **no** está activo en el entorno verificado.
