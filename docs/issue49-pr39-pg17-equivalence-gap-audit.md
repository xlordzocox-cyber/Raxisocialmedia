# Raxi HQ — Auditoría de brechas PR #39 / PostgreSQL 17.11

**Fecha:** 2026-11-05  
**Objeto exclusivo:** `public.raxi_workspaces.raxi_workspaces_slug_check` y su diferencia en restauración sintética.  
**Decisión:** **BLOCKED / NOT_VERIFIED / NO_GO_HOSTED_MIGRATION**. Documento de análisis; sin autorización de excepción, Docker, SQL, restauración ni despliegue.

## 1. Resumen ejecutivo

La evidencia existente respalda una hipótesis **acotada y plausible** de equivalencia para la restricción `slug_check`: origen `AND(AND(L,U),R)` frente a restauración `AND(L,U,R)`, manteniendo orden L/U/R. La prueba exhaustiva de lógica de tres valores (27 casos) certifica la asociatividad del operador booleano **para operandos fijos**; no acredita que funciones, collation, errores, configuración ni evaluación real de PostgreSQL sean idénticos bajo todos los entornos.

La captura sintética privada, fijada por SHA-256 `d968dfee0b0e3b09ff70ede2776b8c97a309392487db1586904a53034cefd179`, pasó la atestación offline de **35 referencias por lado y 3 subárboles de operandos**. Cuatro funciones figuran con volatilidad declarada `i`: OID 150 `int4ge`, 1317 `length`, 149 `int4le`, 1254 `textregexeq`. La prueba de propuesta sintética rechazó 62 mutaciones y demostró que el comparador canónico **aún rechaza** la diferencia. Estos PASSES no autorizan renunciar al comparador.

El PR #39 ya se integró a `main` como herramientas diagnósticas; eso **no** implica que la restauración haya pasado. El PR #50 permanece en borrador.

## 2. Matriz de evidencia (estado comprobado versus brecha)

| Control | Evidencia observada | Alcance/limitación | Estado |
| --- | --- | --- | --- |
| Integridad de la muestra | SHA-256 completo comprobado por operador en Windows; lector limitado a 150 KB | Digest identifica bytes; **no** firma del servidor | PASS ACOTADO |
| Forma exacta | `AND(AND(L,U),R)` vs `AND(L,U,R)`; 3 operandos ordenados | Solo el CHECK y muestra fijada, no otras expresiones | PASS ACOTADO |
| AND ternario | 27/27 combinaciones TRUE/FALSE/UNKNOWN | No valida efectos, errores ni semántica de funciones | PASS LÓGICO |
| Referencias tipadas | 35 ocurrencias por lado, identidad/order y bytes de constantes según reporte | Metadatos capturados; no validación independiente de procedencia nativa ni de todas las flags | PASS DE REPORTE |
| Funciones declaradas | Cuatro implementaciones con volatilidad `i` en origen/restauración | `IMMUTABLE` es una declaración; faltan propiedades de `pg_proc` y build atestada | PASS DE REPORTE |
| Plataforma y Datum | Reporte dice PG17.11, x86_64 y binario/pg_config con hashes coincidentes | `datumAssumptionBytes=8` sigue siendo supuesto, no medida nativa | PARCIAL |
| Collation/locale | El reporte coteja OID, provider, encoding, determinismo y versión por ocurrencia | No incluye todos los atributos de locale, reglas, bibliotecas, configuración efectiva/ICU y versión ejecutable | PARCIAL |
| Funciones y operadores | Verificador comprueba firmas, relación operador-implementación, identidades y hashes declarados | Falta atestación independiente del binario y flags completas: strict, leakproof, security definer, lenguaje, proconfig, soporte, etc. | PARCIAL |
| Catálogo canónico integral | Comparador estricto detectó diferencia de constraints y devuelve FAIL; diagnósticos de otros grupos se reportaron iguales en ensayo previo | No hay PASS posrestauración del comparador, aislamiento posterior no ejecutado en último ensayo fallido | BLOCKED |
| Defensas adversariales | 62 rechazos offline, comparador original rechaza el caso aun con modelo positivo | Modelos sintéticos, no pruebas de restauración aceptada | PASS FAIL-CLOSED |
| Supabase Auth/Storage, RLS real | Laboratorio solo usa stubs y datos sintéticos | No cobertura de backups Auth/Storage ni sesiones/JWT/RLS alojadas | NO VERIFICADO |

**Nota de confianza:** “PASS DE REPORTE” se refiere a consistencia de la muestra privada con el verificador fijado; no implica equivalencia operacional del servidor PostgreSQL.

## 3. Brechas prioritarias: qué falta exactamente

**P0 — Bloquean cualquier excepción operativa**

1. **Procedencia y captura nativa comprobable**: demostrar que source y restore provienen de la imagen/binario PG17.11 fijados, lecturas consistentes del `pg_catalog` real, sin DDL concurrente, con registro de entorno; los hashes autodeclarados no bastan.
2. **Contexto de ejecución completo**: acreditar PG build, arquitectura efectiva/Datum, encoding, provider/collation/locale/versión de bibliotecas y flags funcionales que afectan evaluación.
3. **Equivalencia solo para los átomos exactos**: garantizar igualdad de argumentos, implementadores, tratamiento de NULL, errores relevantes y ausencia de dependencia de orden/efectos; rechazar funciones o nodos no cubiertos. No usar pruebas finitas de valores de `slug` como prueba universal.
4. **Catálogo fuera del CHECK**: revalidar estructura completa (RLS, ACL, tablas, funciones, índices, triggers, roles/permisos) y aislamiento por usuario tras restauración, con fallo explícito ante diferencias inesperadas. El último intento nativo terminó FAIL antes de aislamiento posrestauración.
5. **Revisión separada del cambio de política**: una excepción excepcional y estrecha necesita diseño versionado, pruebas negativas, segunda revisión y aprobación específica. Nunca activarla por detectar un patrón de texto o un booleano de cliente.

**P1 — Mejora de evidencia/aseguramiento**

- Preservar trazabilidad de `pg_get_constraintdef`, `conbin`, bindings por posición, transacción/snapshot y huellas de las siete fuentes SQL; no registrar árboles crudos ni valores privados en logs.
- Comparar por ejecución todos los objetos canónicos, no solo siete categorías de metadatos de la restricción.
- Revisar las premisas del argumento de asociatividad: PostgreSQL no asegura orden físico de evaluación de `AND`; no prometer equivalencia de tiempos, errores o efectos secundarios.
- Reejecutar regresiones negativas al SHA exacto de toda propuesta; asegurar que el comparador estricto permanece inalterado hasta decisión humana.

## 4. Alternativas y recomendación

| Alternativa | Beneficio | Riesgo/costo | Recomendación |
| --- | --- | --- | --- |
| A. Conservar FAIL y documentar | Máxima seguridad y no requiere tocar migraciones | No levanta bloqueo de recuperación | **AHORA** |
| B. Política excepcional por constraint, forma, build y evidencia pinneadas | Podría resolver este caso sin aceptar diferencias arbitrarias | Complejidad de mantenimiento, riesgo de falsos positivos; exige P0 y revisión independiente | Solo después de P0 |
| C. Rediseñar DDL/restore para reproducir la misma representación canónica | Evita autorizar árboles distintos si funciona reproduciblemente | Modifica SQL/flujo de restauración y rompe huellas fijadas; nueva revisión, migraciones y ensayos | Investigar **sin cambiar fuentes** como alternativa a B |
| D. Ignorar constraints, normalizar paréntesis o comparar únicamente metadatos | Menor esfuerzo aparente | Omite cambios reales, puede ocultar vulnerabilidades | **DESCARTADA** |

**Recomendación:** A por ahora. Investigar primero C **como experimento aislado de diseño**, porque una restauración con fingerprints exactamente iguales sería más simple que mantener un bypass estructural. Si C no es viable y se satisfacen los P0, evaluar B como política nueva, limitada y aprobada. No editar las siete fuentes SQL del manifiesto para “hacer pasar” el test sin una decisión explícita.

## 5. Secuencia propuesta sin autorización implícita

1. **Offline, sin Docker ni SQL:** revisar los esquemas de campos de `scripts/pr39-pg17-structural-attestation.mjs`, el resolvedor OID y la consulta de contexto. Marcar cada atributo como capturado, autodeclarado, supuesto o ausente. Esa revisión está reflejada en la matriz anterior y puede auditarse en código.
2. **Diseño offline:** escribir especificación de captura nativa completa y comparador diferenciado (propuesta solamente), con límites por constraint, build, SHA y ausencia de campos desconocidos; incluir casos adversariales de collation, flags y cambios en ambos lados. Ningún código de aceptación todavía.
3. **Puerta de autorización separada:** de ser necesario, pedir autorización explícita para un ensayo adicional de **dos contenedores locales efímeros**, sin red ni puertos, sin tocar el contenedor de campañas; solo fixture sintético, consultas `SELECT` permitidas y evidencia no sensible. La autorización no cubre staging.
4. **QA y revisión independiente:** verificar resultados nativos, comparador canónico completo, negativos y revisión Codex en el SHA exacto; si algo falla, mantener FAIL.
5. **Decisión humana diferenciada:** aprobar o rechazar la política excepcional local; **nunca** confundirla con permiso para SQL remoto, B2, proveedores o despliegue.

## 6. No-go y criterios para cerrar el punto 2

Se podrá cerrar la investigación de **la discrepancia específica** cuando exista evidencia reproducible para P0, decisión sobre A/B/C y revisión independiente. Un PASS de una excepción local **no** autoriza recuperación hosted ni verifica Auth/Storage. Hasta entonces:

`decision=BLOCKED; semanticEquivalence=NOT_VERIFIED; allowCatalogPass=false; NO_GO_HOSTED_MIGRATION`.

**Fuentes revisadas:** `docs/RAXI_HQ_PR39_PG17_PINNED_STRUCTURAL_ATTESTATION.md`, `docs/RAXI_HQ_PR39_PG17_OID_BINDING_CAPTURE_PLAN.md`, `docs/RAXI_HQ_PR39_STRUCTURAL_EQUIVALENCE_PROPOSAL.md`, `scripts/pr39-pg17-structural-attestation.mjs`, `scripts/pr39-pg17-oid-binding-resolver.mjs`, `scripts/pr39-local-synthetic-recovery.mjs` y resultados del operador del 2026-11-05.
