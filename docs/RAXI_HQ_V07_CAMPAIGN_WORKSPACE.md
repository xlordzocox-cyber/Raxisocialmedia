# Raxi HQ v0.7 — Campaign Workspace, Fase 1

Esta fase añade un control humano entre el handoff del Centro de Ideas y la creación de una campaña editorial interna:

```text
IdeaHandoffToHQ → Operations Inbox → PENDING
                                  ├─ REJECTED (motivo de Luis; no campaña)
                                  └─ Campaign Brief → confirmación de Luis
                                                       → ACCEPTED + CampaignRecord / DRAFT
                                                       → Campaign Workspace
```

## Límite de contratos

`src/domain/campaigns.ts` conserva `CampaignSnapshot`, la proyección histórica del Office MOCK v0.5. No es el contrato del Campaign Workspace ni se migra implícitamente. Los contratos nuevos viven en `src/campaigns/`: `CampaignDecision`, `CampaignBriefInput`, `CampaignRecord` y `CampaignContentLevel`.

Un `IdeaHandoffToHQ` sigue siendo una propuesta. Su registro y `provenance` (`MOCK`, `MOCK_SESSION_MODIFIED` o `LOCAL_SESSION`) permanecen en la bandeja después de decidir. El modo `LIVE_READ_ONLY` del Office es independiente y nunca convierte una campaña en LIVE. Cada `CampaignRecord` conserva `sourceIdeaId`, `sourceHandoffSentAt` y esa provenance.

## Decisión y brief

La decisión comienza en `PENDING`. Rechazar requiere un motivo explícito y registra `REJECTED`, sin crear campaña. “Crear campaña” solo abre el brief; el registro se crea tras la segunda confirmación “Crear campaña interna”. El título y los canales sugeridos pueden venir prellenados del handoff, pero son editables. Objetivo, mensaje clave y al menos un nivel editorial deben completarse; se requiere al menos un canal. Canales y niveles editoriales son campos distintos.

La validación exige texto de una línea para el título y admite únicamente saltos LF en objetivo, mensaje clave, CTA, notas y motivo de rechazo. No normaliza controles ni fechas inválidas. Las colecciones están acotadas y deben ser densas y propias. Los IDs son seguros y secuenciales (`CAMPAIGN-001` en adelante, máximo 100). Los timestamps proceden de un clock inyectable que se consulta solo en acciones.

## Sesión, atomicidad y auditoría

`campaignSession.ts` es un reducer puro de memoria de sesión. La confirmación valida brief, ID, `CampaignRecord`, colección y `CampaignDecision` antes de publicar un estado nuevo. Si algo falla, ni la decisión ni la campaña cambian. `sourceIdeaId` solo puede producir una campaña; un segundo intento se rechaza. La auditoría local con actor `LUIS` e IDs deterministas registra aceptación, rechazo, creación y transiciones. No se envía a un servicio externo.

La campaña nace en `DRAFT`. Las únicas transiciones son `DRAFT → PLANNING`, `PLANNING → BLOCKED`, `BLOCKED → PLANNING` y cualquiera de esos estados a `CANCELED`. `CANCELED` es terminal. El workspace muestra conteos, lista, selección y detalle. Brief figura como disponible; Strategy, Assets, Copy, QA, Planner, Publishing y Analytics son rótulos **PRÓXIMAMENTE**, sin acciones.

La capacidad de esta fase es `WRITE_INTERNAL`: estado React en memoria mientras la página siga abierta. No hay backend, base de datos, `localStorage` ni `sessionStorage`; recargar puede perder decisiones y campañas. La interfaz lo advierte. Tampoco hay assets, captions, hashtags, calendario, publicación, métricas, tareas nuevas para agentes ni llamadas runtime a Aria, Munder, GitHub o Supermemory.

RAXI GUARDIAN (`docs/security/RAXI_GUARDIAN.md`) permanece como política de seguridad canónica. Las referencias de evidencia son texto no confiable: React las escapa y no las convierte en enlaces, HTML o instrucciones.
