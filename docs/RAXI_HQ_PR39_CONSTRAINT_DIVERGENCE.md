# PR #39 — investigación de raxi_workspaces_slug_check

**2026-10-29 — TEXTUAL_CAUSE_IDENTIFIED / NATIVE_EQUIVALENCE_PENDING.**
El tercer ensayo comunicado por Luis terminó en **FAIL controlado (1)** en
`12cc2becbc8a2e9b7c3e220e46e9e650c91add9e`. Sus 23 negativas offline y preflight
pasaron; los dos contenedores fueron eliminados según la evidencia del usuario.
Esta investigación no ejecuta Docker, SQL ni `--run-local`.

## Fuente y reproducción de las huellas

Objeto: `public.raxi_workspaces / raxi_workspaces_slug_check`.
Origen: `supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql`,
CREATE TABLE iniciado en línea 3, SHA-256 LF
`e0f0a828b5d4f31960f2153ad910bb84a399a449754db8761057e91047cd7ba0`.
Ninguna de las otras seis fuentes sustituye esta restricción.

La columna es `text NOT NULL`. La restricción combina longitud **BETWEEN 2 AND 64**
(ambos extremos inclusivos) con una expresión regular que restringe los caracteres
a letras ASCII minúsculas, cifras y guion. Se conserva el literal íntegro en memoria
desde la fuente revisada; no se imprime su definición completa ni el literal.

`reviewedSlugDefinitions` deriva dos representaciones a partir de esa fuente,
después de que el preflight verifica las siete huellas. El fingerprint usa exactamente
el mismo SHA-256 de la cadena JSON canónica que el diagnóstico anterior:

| Forma construida offline | SHA-256 esperado | SHA corto comunicado del ensayo |
| --- | --- | --- |
| BETWEEN expandido: AND interior de dos límites, AND exterior con regex | `484099262f84bef44dbc17b3c3292c3df561faece4b1c6739ece1d73ff915215` | `484099262f84` origen |
| Los mismos tres operandos en un AND plano, sin reordenarlos | `1efa6e7fdbc4893674beb7afe880eea3bfbfb9fb36ff4b84c740eb72eaa91dcf` | `1efa6e7fdbc4` restaurado |

Esto reproduce **exactamente ambos fingerprints cortos observados** sin ejecutar
PostgreSQL. Los SHA completos anteriores pertenecen a las representaciones
construidas, no a una nueva captura del ensayo nativo eliminado. Una coincidencia
de huellas cortas no sustituye la inspección de identidades resueltas.

## Mecanismo sustentado por PostgreSQL 17

1. `transformAExprBetween` construye un AND con las comparaciones inclusivas de
   los dos extremos. Esta expansión ocurre durante análisis de expresiones,
   después del análisis gramatical inicial.
2. `pg_get_constraintdef` reconstruye texto del árbol almacenado: no devuelve el
   DDL original. `ruleutils.c` puede representar separadamente los dos niveles AND.
3. `pg_dump` obtiene los CHECK mediante `pg_get_constraintdef(c.oid)` y almacena
   ese DDL en el archivo custom. No transporta directamente el árbol `conbin`.
4. `pg_restore` envía SQL al servidor destino. La gramática `makeAndExpr` aplana
   un AND ya presente en el operando izquierdo al leer la cadena de AND.
   Así puede almacenarse un AND plano que se deparsea de otra forma.

La discrepancia textual observada encaja exactamente en este mecanismo, sin
cambiar los límites, el literal, los operandos ni su orden en las dos formas
construidas. **Todavía no se acredita equivalencia semántica del catálogo real**:
no se conservaron aquí sus definiciones completas, árboles ni objetos resueltos.

Fuentes primarias consultadas:
[parse_expr.c / transformAExprBetween](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/parser/parse_expr.c),
[gram.y / makeAndExpr](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/parser/gram.y),
[ruleutils.c](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/ruleutils.c),
[pg_dump.c / getTableAttrs](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/bin/pg_dump/pg_dump.c),
[funciones de información PG17](https://www.postgresql.org/docs/17/functions-info.html),
[collations PG17](https://www.postgresql.org/docs/17/catalog-pg-collation.html).

## Flujo y configuración examinados

- Origen: bootstrap sintético verificado → cuatro bases → runtime → A → B,
  cada envío a psql en una conexión separada; luego datos sintéticos e inspector.
- Exportación: custom/public/no-owner. Destino: bootstrap y mismos UUID sintéticos
  de Auth para FK → eliminación del public desechable → restore transaccional.
- Ambos usan `postgres:17` ya cacheado, network none y tmpfs según los guards del
  PR. No existe copia de Auth administrado ni de bytes Storage reales.
- El restore utiliza otra sesión; los ajustes de sesión del dump no son una prueba
  de que las consultas posteriores tengan idéntico contexto. Ni el bootstrap ni
  esta revisión cambian la restricción o la configuración del servidor.
- Search path, standard_conforming_strings, encoding, locales, tipos, funciones,
  operadores, collation y flags de validación **no fueron medidos en esta tarea**.
  No se atribuye a ellos la causa ni se afirma haberlos descartado nativamente.

## Corrección aplicada y propuesta mínima pendiente

Este commit añade diagnóstico, pruebas y endurecimiento del comparador:

- Clasifica solamente el par de textos completos derivados de la fuente revisada,
  para el objeto exacto. Nunca acepta prefijos SHA ni equivalencias generales.
- Imprime `BETWEEN_EXPANSION_AND_REGROUPING_CANDIDATE` y
  `SEMANTIC_EQUIVALENCE_NOT_VERIFIED`; **mantiene FAIL**.
- Unifica el gate comprobado por pruebas y ejecutor con comparación estricta de
  metadatos crudos y hashes canónicos. RLS, ACL, funciones, tablas, índices,
  triggers y constraints siguen comparándose; no se omiten ni ordenan de nuevo.
- Exige claves del inspector y tipos/elementos de metadatos. Dos catálogos idénticos
  pero malformados no pueden producir PASS por omisión de ACL/índices/flags.
- Prepara una consulta SELECT adicional para el próximo ensayo expresamente
  autorizado: flags CHECK/columna, ajustes y objetos resueltos (operadores,
  funciones/volatilidad, tipos y collations, incluido locale/reglas ICU).
  Solo se imprimen categorías y fingerprints, nunca cuerpos, árboles ni filas Auth.

La consulta usa el formato interno `pg_node_tree` para localizar referencias;
**no está validada nativamente y no es un parser semántico portable**. Campos
ausentes/malformados detienen el diagnóstico. Metadatos idénticos tampoco conceden
PASS: no prueban por sí solos equivalencia de expresiones ni del entorno completo.

**Propuesta futura, NO implementada:** una vez confirmados los objetos resueltos y
aprobada explícitamente la política de comparación, introducir una proyección
estructural local para este CHECK que aplane únicamente nodos AND asociados,
manteniendo orden y multiplicidad de operandos, constantes, tipos, coerciones,
collation y flags. Comparar esas estructuras estrictamente. No tocar las siete
fuentes, no reordenar operandos, no quitar casts y no aceptar `pg_get_constraintdef`
pretty o texto normalizado como única prueba. Todos los demás campos del catálogo
seguirían exactos. La evaluación de datos de frontera/NULL sería un complemento,
nunca una demostración universal de equivalencia.

Hasta entonces la corrección no convierte el ensayo en PASS. El siguiente
`--run-local` requiere **nueva autorización específica**, aun después de review.

## Evidencia offline y riesgos

- `node scripts/test-pr39-local-recovery.mjs`: **79 casos negativos PASS**;
  además, coincidencia de las dos huellas, identidad de fixtures válidos y
  clasificación de cambios resueltos comprobadas. Sin Docker/red/SQL.
- Preflight sin flags: PASS, siete fuentes/bootstrap/PR38 NO-GO intactos.
- `node --check` de los cuatro scripts: PASS. `git diff --check`: PASS.
- Revisión independiente Codex local: confirmó causa textual y retención del FAIL;
  sus hallazgos de campos omitidos/arrays malformados se corrigieron y verificaron.
- No se ejecutaron build, suite completa de la app ni pruebas SQL: el cambio está
  en scripts de diagnóstico offline y preparación de un SELECT, no en la aplicación.

Logs locales ignorados en `apps/raxi-hq/.validation`:

| Evidencia | SHA-256 |
| --- | --- |
| `pr39-constraint-offline.log` | `87c9f934bc6d4750a222d9b58d83d6fb3f86031d54ba281248f0bcab45fa9f53` |
| `pr39-constraint-preflight.log` | `d538f42d73c7404add987ae25aea46a60b9238bb6925cac43c1d4f622692246f` |

Negativas: cambio de rango, inclusión/exclusión, regex, AND/OR, función, operador,
cast/collation, catálogo faltante/duplicado/malformado, ACL/políticas/columnas/índices/
triggers/roles, hash divergente y pareja reconocida con resumen canónico idéntico.
Todo ello debe fallar. La clasificación de causas nunca concede autorización.

**Estado final requerido:** PR #39 abierto; ensayo nativo pendiente, último resultado
nativo FAIL. NO_GO_HOSTED_MIGRATION inalterado. Sin merge, SQL alojado, B2,
proveedores, contenedores ejecutados ni cambios en Guardian/observador/OpenGym.

## P1 posterior al cuarto ensayo — procedencia de locale PG17

**Base del correctivo: `59805f66369ca754bb2abd072cb66d66a49eb230`.**
Evidencia del usuario: preflight PASS; persistió la discrepancia del CHECK con
`BETWEEN_EXPANSION_AND_REGROUPING_CANDIDATE` y
`SEMANTIC_EQUIVALENCE_NOT_VERIFIED`. El diagnóstico adicional se interrumpió por
`unrecognized configuration parameter "lc_collate"`, resultado 1; ambos
contenedores desechables se limpiaron. **Resultado nativo del cuarto ensayo: FAIL.**

### Causa y cambio mínimo

La consulta incorporada en la revisión anterior confundía atributos de creación de
la base de datos con GUC de sesión: `current_setting` no es la procedencia válida
de LC_COLLATE/LC_CTYPE en PG17. El fallo ocurrió antes de poder obtener todo el
contexto y no demuestra una diferencia semántica adicional del CHECK.

El SELECT ahora lee **`pg_catalog.pg_database` filtrado por
`d.datname = pg_catalog.current_database()`**, sin consultar otra base ni sustituir
valores faltantes por datos inventados. Contrato JSON, dentro de `settings`:

| Clave | Procedencia PostgreSQL 17 | Contrato |
| --- | --- | --- |
| `lcCollate` | `d.datcollate` | Conservada, string |
| `lcCtype` | `d.datctype` | Conservada, string |
| `localeProvider` | `d.datlocprovider` | Nueva; `b` builtin, `c` libc o `i` ICU |
| `locale` | `d.datlocale` | Nueva; string o null (libc usa datcollate/datctype) |
| `icuRules` | `d.daticurules` | Nueva; string o null |
| `collationVersion` | `d.datcollversion` | Nueva; string o null; versión **registrada** |

Se conservan searchPath, strings, encoding y version desde los cuatro GUC
documentados existentes. `summarizeSlugContexts` exige las diez claves de settings;
el fixture y todos sus consumidores conocidos se actualizaron explícitamente.
Un contexto antiguo sin las nuevas claves se rechaza, no se completa por defecto.
Las siete categorías externas del resumen y sus fingerprints no cambian.

`collationVersion` no acredita la versión efectiva actual de la biblioteca del
sistema. No se añadió una consulta de versión efectiva ni se afirmó verificarla.
Los metadatos de objetos collation individuales (incluidos colllocale y collicurules)
se conservan separados de los metadatos de la base actual.

### Auditoría estática del SELECT completo

Se contrastaron las columnas de pg_database, pg_collation, pg_constraint,
pg_attribute, pg_class, pg_namespace, pg_operator, pg_proc y pg_type con los
catálogos oficiales de **PostgreSQL 17**. Los nuevos nombres datlocale y
colllocale no se sustituyen por sus nombres de PG16; no se utiliza conenforced
de PG18. No se identificó otro parámetro o columna inexistente en esta revisión.

Referencias específicas:
[pg_database PG17](https://www.postgresql.org/docs/17/catalog-pg-database.html),
[pg_collation PG17](https://www.postgresql.org/docs/17/catalog-pg-collation.html),
[configuración de cliente PG17](https://www.postgresql.org/docs/17/runtime-config-client.html),
[pg_constraint PG17](https://www.postgresql.org/docs/17/catalog-pg-constraint.html),
[pg_attribute PG17](https://www.postgresql.org/docs/17/catalog-pg-attribute.html),
[pg_class PG17](https://www.postgresql.org/docs/17/catalog-pg-class.html),
[pg_namespace PG17](https://www.postgresql.org/docs/17/catalog-pg-namespace.html),
[pg_operator PG17](https://www.postgresql.org/docs/17/catalog-pg-operator.html),
[pg_proc PG17](https://www.postgresql.org/docs/17/catalog-pg-proc.html),
[pg_type PG17](https://www.postgresql.org/docs/17/catalog-pg-type.html).

### Validaciones del correctivo y riesgos pendientes

- Suite offline: **103 negativas PASS** (79 anteriores + 14 del contrato SQL +
  10 del contexto nuevo). Además, casos válidos de los tres proveedores,
  nullable y detección de cambios de metadatos comprobados.
- Contrato SQL estático: rechaza GUC inexistente (también missing_ok), procedencia
  errónea, filtro ausente/ajeno, catálogo no cualificado, columnas de otra versión,
  campos desconocidos, comentarios que oculten procedencia y sentencias múltiples.
- Preflight sin flags PASS; siete fuentes, bootstrap y manifest intactos; las
  autorizaciones alojadas permanecen falsas. Sintaxis y diff PASS.
- Revisión independiente Codex local: ejecutó las 103 negativas offline y revisó
  el SELECT/contrato; sin hallazgos P1/P2 nuevos en el correctivo.
- No Docker, SQL, `--run-local` nativo, B2, proveedores ni modificaciones alojadas.
  No se ejecutaron build ni suite de la app: no hay cambios de aplicación.

Huellas SHA-256 de esta validación (logs ignorados en apps/raxi-hq/.validation):
`pr39-pg17-p1-offline.log`:
`1429253972be7b1d1abf60fd45bfedc2fdd34c984cef1b5c58c34520483853ed`;
`pr39-pg17-p1-preflight.log`:
`d538f42d73c7404add987ae25aea46a60b9238bb6925cac43c1d4f622692246f`.

El contrato offline es una inspección acotada de la consulta conocida, **no un
parser SQL ni una prueba de ejecución**. El SELECT corregido sigue pendiente de
ensayo nativo expresamente autorizado. `pg_node_tree` sigue siendo formato interno;
los metadatos coincidentes siguen sin conceder equivalencia semántica. La
clasificación del CHECK, el comparador estricto, el FAIL por discrepancia y el
finally de limpieza no se modificaron. PR abierto/en borrador, sin merge.

## Quinto ensayo comunicado y propuesta siguiente

El usuario probó `fe52230687eaf310f8ea7226d417192a1fc54765`: preflight PASS,
ambas huellas y clasificación previas persistieron; los siete grupos de contexto
reportaron IDENTICAL_METADATA. El comparador retuvo FAIL (1), equivalencia
NOT_VERIFIED y limpieza correcta. La corrección de locale no supone equivalencia
del CHECK. No se ejecutó una nueva prueba nativa en esta investigación.

Ver [propuesta estructural acotada](RAXI_HQ_PR39_STRUCTURAL_EQUIVALENCE_PROPOSAL.md):
evidencia confirmada frente a árboles aún no capturados, mecanismo recomendado,
justificación lógica limitada, riesgos, alternativas y modelo offline sintético.
No hay política de equivalencia habilitada; el comparador original no cambia.
