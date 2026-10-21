# PR #13 — procedencia de expiración y tamaño del resultado

Base: `040a2d88d7b4de6120b36cd0d4b18f91173a4216`. Propuesta local: no se aplica SQL ni se activa un worker o proveedor.

## Expiración

`raxi_runtime_claim` bloquea y recupera el run activo vencido. Su valor `simulated`, no la política vigente, determina MOCK/UNVERIFIED o AGENT_EXECUTOR/VERIFIED. La evidencia REAL verifica exclusivamente el hecho operativo persistido de expiración del lease; no acredita una respuesta del proveedor. `operationalReceiptOnly` y `providerAcknowledged` explicitan esa diferencia, incluso si expiró antes de obtener recibo.

Evento y auditoría conservan run, tarea, agente, etapa e intento; la auditoría conserva el recibo existente. El run queda UNKNOWN, la tarea BLOCKED, el perfil desconectado y la reserva intacta. Otro claim no repite el evento ni autoriza otra llamada. No se cambia la autorización original.

Las cuatro regresiones combinan REAL/SIMULATED con ejecución reclamada/reconocida. Cambian después la política al modo opuesto y la deshabilitan: la recuperación conserva la procedencia original. Consultan SQL como propietario y montan `RuntimeOfficePanel` en StrictMode. SIMULATED produce cero agentes, tareas o eventos en HQ/Pixi y ningún canvas; REAL muestra el agente bloqueado, nunca RUNNING. Los recibos REAL de estas pruebas son fixtures locales, no ejecución IA auténtica.

## Contrato de tamaño

El presupuesto completo es **196608 bytes (192 KiB)** del texto JSONB codificado en UTF-8. Incluye claves, metadatos, delimitadores, espacios de JSONB, resumen, IDs de citas y todas las fuentes verificadas. SQL usa `octet_length(convert_to(p_result::text,'UTF8'))`; `runtimeResultBytes` mide la misma representación para el subconjunto canónico de cadenas, booleanos, arrays y objetos. El orden de las claves no cambia el tamaño. No se utiliza longitud de caracteres como sustituto de bytes.

Límites públicos por campo (unidades UTF-16, como los límites anteriores de contenido y resumen):

| Campo | Máximo |
| --- | ---: |
| Resumen | 6000 |
| Fuentes | 4 |
| Contenido original por fuente | 3000 |
| ID por fuente | 128 |
| URL HTTPS por fuente | 2048 |
| Fecha de captura interpretable | 64 |
| SHA-256 hexadecimal | 64 exactos |

Solo se aceptan los cinco campos declarados de cada fuente. Las cadenas deben ser Unicode válido representable por PostgreSQL: se rechazan NUL y sustitutos aislados, conservando pares válidos/emoji. Se comprueban hash, host y citas como antes. No se recodifica ni trunca contenido. Todas las fuentes verificadas se persisten, incluidas las no citadas; `sourceIds` sigue identificando únicamente las citadas.

Incluso suponiendo seis bytes JSON por unidad UTF-16 en todos los campos, cuatro fuentes completas, IDs repetidos en citas y 1024 bytes de claves/metadatos, el máximo es 167392 bytes: menor que 196608. Una respuesta conforme a todos los límites individuales cabe en el presupuesto completo. Los números o propiedades arbitrarias no forman parte del resultado canónico.

Las regresiones guardan cuatro fuentes con contenido/ID/URL/fecha máximos y resumen máximo en ASCII, Unicode/emoji, controles escapados y comillas/barras/nuevas líneas. Comparan byte por byte el cálculo de servidor con PostgreSQL y recuperan los campos intactos. También verifican el presupuesto exacto -1/0/+1 con Unicode y escapes; el fixture SQL de frontera aísla el límite de bytes y no representa una salida pública del proveedor. Una respuesta inválida conserva recibo, coste conocido, reserva y UNKNOWN/BLOCKED; el siguiente intento no llama al proveedor. Metadatos inválidos se rechazan antes del proveedor.

## Validación y límites

Resultado final: **352/352 PASS**, cero fallos, canceladas u omitidas. Son las 339 pruebas anteriores más 13 regresiones nuevas: cuatro de expiración SQL/panel, cuatro de resultados máximos, tres de frontera de bytes, una matriz de contrato inválido/conservación y una de fuentes verificadas no citadas. Build y typecheck frontend/servidor PASS. Auditoría npm: **0 vulnerabilidades**. Escáner de secretos de aplicación/build: único literal de nombre de campo del SDK, sin valor de credencial. Diff sin errores de whitespace.

Las pruebas se ejecutan en PostgreSQL embebido PGlite, con componentes React montados y proyección HQ que consume la misma escena Pixi. No acreditan conexiones PostgreSQL físicas independientes, Auth alojado ni llamadas IA auténticas. No cambian la primera idea ni su auditoría de producción.

La protección anterior de política/versionado, admisión antes del proveedor, presupuestos, lease, aislamiento e incertidumbre permanece vigente. El despacho y HTTP siguen sin ser atómicos; no se promete cancelar una llamada ya admitida.

PR #12 permanece separado en `76073c1`; consulta de esta corrección: abierto, revisión Codex Running, sin hallazgos publicados. No se modifica el verificador LF/CRLF compartido.
