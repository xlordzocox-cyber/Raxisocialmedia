# Raxi HQ — piloto operativo de primera solicitud supervisada (staging)

> **Estado: preparación y lectura; NO autoriza ejecutar SQL alojado, montar endpoints, generar imágenes, gastar créditos ni hacer merge.** Este documento es un runbook de uso, no una migración. El código del PR #59 sigue sin instalarse en staging.

## 1. Qué está confirmado en staging (lectura 2026-11-09)

Proyecto permitido: **`raxi-hq-staging`** (ref `zvhxjindgyvtasstfjut`). **NO consultar ni modificar producción** `raxi-hq` para este piloto.

Lecturas SQL **solo SELECT** mediante conexión autorizada a staging:

| Objeto | Dato verificado |
| --- | --- |
| Campaña | `CAMPAIGN-001`, procedencia `REAL`, estado `PLANNING` |
| Estrategia | Revisión 1 `APPROVED` |
| Entregable | `STRATEGY-ITEM-001`, `INSTAGRAM_FEED`, `PUBLIC_SOCIAL`, `PHOTO`, cantidad 1 |
| Ideas | 2, una `SENT_TO_HQ` y otra `PROPOSED` |
| Auditoría histórica | 8 eventos `CAMPAIGN_COMMAND_COMMITTED` + 2 `IDEA_MANUAL_CREATED` |
| Recibos de solicitud supervisada | 0 `SUPERVISED_CAMPAIGN_REQUESTED` |
| Agentes/tareas | Los metadatos de tablas consultados reportaron 0 filas de `raxi_agent_tasks` |

**Precisión:** `REAL` califica la persistencia/origen de la campaña, **no** prueba agentes en ejecución ni credenciales de proveedores. La estrategia aprobada no equivale a autorizar creación de imagen o publicación. Las cifras son instantáneas; no se deben asumir vigentes sin nuevas lecturas.

## 2. Observabilidad mínima sin implementar otro sistema

Usar primero las tablas y eventos existentes. **No añadir un ledger duplicado, borrar eventos, habilitar triggers de métricas ni activar un servicio nuevo.** Los siguientes SQL son **consultas de lectura**, no mutan filas ni requieren aplicar una migración.

### Estado de campaña y entregables

```sql
select c.external_id campaign_id,c.status campaign_status,c.provenance,
       s.revision,s.status strategy_status,
       d.external_id deliverable_id,d.channel,d.content_level,d.format,d.quantity
from public.raxi_campaigns c
join public.raxi_strategy_revisions s on s.campaign_id=c.id
join public.raxi_strategy_deliverables d on d.strategy_id=s.id
where c.external_id='CAMPAIGN-001'
order by s.revision desc,d.external_id
limit 20;
```

### Auditoría existente, agregada y sin datos del payload

```sql
select action,count(*)::bigint event_count
from public.raxi_audit_events
group by action
order by action;
```

### Recibos supervisados y almacenamiento lógico estimado

```sql
select count(*)::bigint receipt_count,
       coalesce(sum(octet_length(details::text)),0)::bigint details_json_bytes,
       max(occurred_at) last_receipt_at,
       count(*) filter (where occurred_at>=clock_timestamp()-interval '24 hours')::bigint receipts_last_24h
from public.raxi_audit_events
where action='SUPERVISED_CAMPAIGN_REQUESTED';
```

**Limitación:** `details_json_bytes` mide bytes de texto JSONB serializado, **no** uso físico exacto de discos, índices o TOAST. Esta lectura sin filtro de workspace es de **operador/administrador de staging**, no una consulta autorizada para usuarios finales. Jamás mostrar IDs de otros tenants ni payloads de auditoría en un dashboard de usuario. Requiere permisos y autenticación apropiados.

### Contadores de rate limiter, **solo cuando el SQL del PR #59 haya sido aprobado y aplicado**

```sql
select operation,window_start,request_count
from public.raxi_supervised_request_rate_counters
order by operation,window_start desc
limit 50;
```

La tabla **no existe en staging hasta una migración autorizada**. Si no existe, se informa `NOT_DEPLOYED`; no se simulan contadores. Los contadores indican **admisiones** por ventana/identidad, **no** número histórico de respuestas 429. Los errores 503 cuando falla la base **tampoco** pueden inferirse del SQL: requerirán contadores agregados del perímetro/host alojado, sin bearer tokens, payload de comandos ni claves.

### Métricas que quedarán pendientes hasta montar el endpoint

- Número de HTTP `429` y `503`, latencia, errores de validación de identidad y fallos de RPC, **agregados** por operación, sin identificadores privados.
- Alertas sobre tasas de error o almacenamiento tras medir una línea base; **no inventar umbrales** ni afirmar que alertas ya están activas.
- Estado explícito `NOT_DEPLOYED / DISABLED / HEALTHY / DEGRADED` según evidencias reales, nunca `HEALTHY` por carecer de eventos.

## 3. Política provisional de conservación (sin purga)

1. Los recibos `SUPERVISED_CAMPAIGN_REQUESTED` ya están diseñados como **inmutables** en la propuesta del PR #59. No modificar, borrar, truncar, anonimizar silenciosamente ni alterar su relación con `requestKey`.
2. **Sin borrado automático y sin plazo aprobado** mientras no exista política de archivo, restauración y verificación de integridad. No fingir una retención formal ilimitada ni garantizar durabilidad de backups no comprobados.
3. Para una futura política formal se requiere: responsable, base de conservación, periodo, almacenamiento cifrado, procedimiento de exportación/restauración, evidencias de checksum, permisos, costo y autorización humana. No retener secretos ni tokens en `details`.
4. Mantener contadores operativos separados del ledger inmutable; una eventual limpieza de contadores se tratará como cambio independiente con QA y revisión. **No tocar los cuatro Docker labs históricos.**

## 4. Ruta corta hacia el primer uso supervisado

**Ya completo:** campaña persistida, Strategy v1 aprobada, un entregable Instagram público PHOTO, tablas de auditoría históricas, propuesta SQL y handler PR #59 con pruebas PGlite/local (902/902) y ensayo PG17.11 sintético de cuotas/ventana con dos sesiones. La observabilidad básica de campaña está disponible con consultas existentes.

**Falta antes del primer `REQUESTED` real alojado:**

1. Revisión especializada de seguridad del `service_role`, frontera entre Auth y SQL `p_evidence`, revocación, operabilidad y bypass; Codex code review sin hallazgos **no** equivale a esta revisión.
2. Aprobar el presupuesto de evidencia (240/256 KiB) y límites experimentales 30 preflights, 60 replays, 3 submits por minuto; documentar excepciones/operador.
3. Diseñar/habilitar límite de ingress **antes de Auth**, protección frente a tokens inválidos y ruta server-only deshabilitada por defecto. No pasar `service_role` al navegador.
4. Plan de despliegue y rollback **exclusivamente staging**: migración fijada, identidad real JWT firmada, sesión actual y revocada, scope, RLS, rutas/desmontaje e informes de QA. **Requiere autorización separada del usuario antes de ejecutar SQL o habilitar una ruta alojada.**
5. Con los gates aprobados, hacer **una solicitud manual** para `CAMPAIGN-001` / Strategy 1 / `STRATEGY-ITEM-001`, `PREPARE_VISUAL_BRIEF`, y comprobar **exactamente un** recibo `REQUESTED / PENDING_HUMAN_EXECUTION_AUTH`. Reintento solo con la **misma** `requestKey` si la respuesta es incierta. Verificar cero tareas automáticas, imágenes, publicaciones, pagos o proveedores.
6. La generación de fotos, revisión QA de imagen y publicación serían **etapas posteriores con autorizaciones independientes**; el recibo nunca equivale a aprobación de costo o proveedor.

## 5. Principio de producto: usable antes que burocrático

El usuario puede revisar y administrar ideas/campañas/estrategias en el flujo REAL existente. No hay razón para crear otra campaña demo; **usar `CAMPAIGN-001` como piloto único**. El puente del PR #59 está desarrollado y validado localmente pero **desmontado y no migrado**. La siguiente inversión de ingeniería debe concentrarse en el despliegue mínimo supervisado, el control de acceso y la experiencia de confirmar un recibo, **no en crear un dashboard complejo de métricas o más laboratorios por defecto**.
