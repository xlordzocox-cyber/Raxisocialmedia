# PR #39 — propuesta estructural acotada, no habilitada

**2026-10-29 · base fe52230687eaf310f8ea7226d417192a1fc54765**
**Decisión actual: BLOCKED para equivalencia nativa y PASS del catálogo.**
Este documento no es una política aprobada ni autoriza capturas, SQL, Docker,
instalaciones, proveedores, B2 o cambios alojados. El comparador original y su
limpieza permanecen intactos. No hay integración de la especificación offline
con el ejecutor nativo ni el runtime.

## 1. Evidencia confirmada y frontera de conocimiento

El usuario comunicó un quinto ensayo autorizado en la base indicada: preflight
PASS; `raxi_workspaces_slug_check` difiere con huellas cortas `484099262f84` y
`1efa6e7fdbc4`; clasificación BETWEEN_EXPANSION_AND_REGROUPING_CANDIDATE;
equivalencia NOT_VERIFIED. Los siete grupos de contexto dieron IDENTICAL_METADATA.
El gate retuvo **FAIL (1)** y ambos contenedores se limpiaron. No se repitió el
ensayo en esta tarea. Es evidencia comunicada, no una captura nueva del agente.

La fuente revisada exige slug text NOT NULL, longitud inclusiva 2..64 y patrón
ASCII acotado. El análisis anterior reprodujo las dos representaciones textuales
desde la fuente y confirmó el mecanismo de expansión/reparsing en código PG17.
Las siete fuentes y sus huellas siguen intactas.

**Los árboles nativos completos y ordenados NO están disponibles aquí.** El
SELECT existente obtiene identidades mediante regexp y agregados DISTINCT/UNION.
Eso pierde posición, multiplicidad y asociación de cada referencia a su nodo.
Incluso una lista idéntica de funciones/operadores puede describir expresiones
distintas: intercambiar argumentos o enlazar otro cast puede mantener esos grupos.
Los hashes cortos tampoco revelan el árbol ni prueban ausencia de otras diferencias.

## 2. Estructura esperada: hipótesis verificable, no árbol observado

Para esta fuente, el candidato a investigar es:

```text
origen esperado                 restauración esperada
AND                             AND
├─ AND                          ├─ L
│  ├─ L                         ├─ U
│  └─ U                         └─ R
└─ R

L = comparación inclusiva inferior(length(slug), constante int4 2)
U = comparación inclusiva superior(length(slug), constante int4 64)
R = operador regex(slug, constante text íntegra de la fuente revisada)
```

No se conoce aún el contenido nativo de cada L/U/R. Se deben comprobar los
dos usos de length, los tres usos de la variable, las tres constantes y sus
respectivos vínculos/flags. No basta comparar nombres SQL o contar funciones.
Si un árbol real difiere de este candidato, la regla no se aplica.

## 3. Mecanismo mínimo recomendado

**Recomendación: proyección tipada completa, ligada a una build exacta de PG17,
con una única regla de forma; todavía sin adaptador ni activación.**

Primero obtener bajo autorización independiente dos capturas íntegras de los CHECK
y sus bindings por posición, solo en el laboratorio. Ligarlas a versión exacta,
build/imagen, commit y siete huellas, identidad de cada contenedor/base/tabla/
constraint, sesión de inspección y hash completo del archivo restaurado. Conservar
los árboles y valores solo en memoria protegida; registrar únicamente IDs,
categorías y fingerprints. La captura debe ser consistente, con ausencia de DDL
concurrente demostrada o snapshot/bloqueo apropiado durante el ensayo autorizado.

Un extractor confiable deberá recorrer nodos reales con esquema cerrado:

| Nodo esperado | Información que no puede perderse |
| --- | --- |
| BoolExpr | tag exacto, boolop, lista de argumentos ordenada, location |
| OpExpr | opno/opfuncid originales, implementación resuelta, tipo de resultado, opretset, opcollid/inputcollid, argumentos, location |
| FuncExpr | funcid e implementación resuelta, tipo de resultado, funcretset, funcvariadic, funcformat, funccollid/inputcollid, argumentos, location |
| Var | varno/varattno, tipo/typmod/collation, varlevelsup, varnullingrels, referencias sintácticas y relación/columna ligadas, location |
| Const | tipo/typmod/collation, constlen/constbyval/constisnull, valor íntegro tipado y codificación, location |

Los OID locales se conservan para auditoría y se ligan a identidades cualificadas
completas; **no se comparan OID entre bases como prueba de identidad**. Resolución
por nodo/posición, sin DISTINCT que borre duplicados. Incluir definición/build y
flags relevantes de implementación, configuración/SECURITY DEFINER, strictness,
volatilidad, retorno set/parallel/leakproof y soporte; collation con proveedor,
locale, reglas, versión registrada y verificación efectiva cuando proceda.
Una coincidencia de nombres o firmas no basta si cambió la implementación.

No se ignoran campos porque PG los omita del query jumble. `equal()` puede ignorar
referencias sintácticas de Var y aceptar opfuncid cero: esta propuesta exige
conservar esos datos y resolver cualquier diferencia explícitamente. Casts,
RelabelType, CoerceViaIO, dominios o tags desconocidos se rechazan en la versión
inicial; **no se eliminan**. Su eventual soporte requiere otra revisión.

El extractor preferible desde el punto de vista de fidelidad es una sonda local
versionada que use los lectores/nodos propios de PG17. Su disponibilidad, posible
compilación/carga y permisos **no están comprobados ni autorizados**. No se
instala ni se crea una función SQL en este incremento. Un decodificador externo
de conbin es alternativa sin carga del servidor, pero exige gramática completa
para este subconjunto, todos los campos, límites, rechazo de entradas parciales
y fixtures nativos verificados de la build exacta; no regex de sustitución.
Si ninguna opción puede auditarse, la alternativa segura es conservar FAIL.

### Única transformación que podría aprobarse posteriormente

Solo para `public.raxi_workspaces.raxi_workspaces_slug_check` y una política
versionada revisada por humanos: dos nodos AND anidados a la izquierda con
aridades 2/2 frente a un AND de aridad 3; lista resultante exactamente `[L,U,R]`.
Cada subárbol debe corresponder al contrato tipado esperado de esta fuente y
coincidir **íntegramente** entre capturas. Mantener orden y multiplicidad de nodos,
argumentos y referencias. No ordenar, fusionar, deduplicar ni aplanar recursivamente.
Conservar registro del AND retirado; no suprimir flags o atributos desconocidos.

Las locations también se conservan. La especificación inicial exige -1 en los
AND y coincidencia exacta de las demás; una captura con otros valores se rechaza.
Si se necesita tratar coordenadas como datos no semánticos, habrá que aprobar
esa excepción separadamente y conservarlas en el rastro de auditoría. No se
excluyen silenciosamente para fabricar una coincidencia.

**Justificación lógica limitada:** para tres resultados booleanos fijos, AND vale
FALSE si alguno es FALSE; si no, UNKNOWN si alguno es UNKNOWN; en otro caso TRUE.
Esta caracterización no depende de agrupar a izquierda o en una lista. No usa
conmutatividad ni valores representativos de slug. Pero presupone que son los
mismos átomos tipados, sin efectos, dependencias cambiantes o errores nuevos.
No demuestra que esos presupuestos se cumplan en las capturas reales.

No se promete orden físico de evaluación: PostgreSQL no lo garantiza para AND,
incluso antes de esta propuesta. Para requisitos sobre tiempos, efectos laterales
o secuencias observables de errores, esta justificación no es suficiente. La
política inicial debe rechazar funciones no probadas, volátiles/estables, SRF,
collations/implementaciones no verificadas o expresiones arbitrarias.

Después se requiere verificar que ningún otro campo del catálogo difiere,
mantener RLS/ACL/tablas/funciones/índices/triggers/flags exactos, validar nativamente
la extracción y negativas, y obtener aprobación humana de la política **y** de
su activación. Metadatos iguales, un booleano del modelo o una etiqueta enviada
por el cliente nunca otorgan autorización. Hoy todos esos gates siguen cerrados.

## 4. Especificación ejecutable exclusivamente offline

Nuevo archivo: `scripts/test-pr39-slug-structure-proposal.mjs`.

```powershell
node scripts/test-pr39-slug-structure-proposal.mjs
```

Contiene un modelo cerrado y sintético, no un parser SQL/pg_node_tree, extractor
real ni política aprobada. Los nombres son ilustrativos; el patrón usa bytes
ficticios marcados como SYNTHETIC, no la constante regex nativa. Los campos del
modelo son una proyección didáctica parcial, no una transcripción completa de
primnodes.h. Esto no acredita tipos, bytes, flags ni árboles de una base real.

La única coincidencia positiva devuelve OFFLINE_RULE_SHAPE_ONLY, decision BLOCKED,
allowCatalogPass false, nativeValidated false y semanticEquivalence NOT_VERIFIED.
El ejecutable rechaza provenance nativa, aprobación inyectada y argumentos CLI.
El gate original real sigue rechazando el par de definiciones observado aun
después de la coincidencia del modelo. No se importa en el ejecutor nativo.

Negativas incluyen orden/multiplicidad/aridad, OR/NOT, tags distintos como
DistinctExpr/NullIfExpr, cast añadido, funciones/operadores/implementaciones,
constantes/bounds/bytes/NULL/tipo/typmod/longitud/byval/codificación, coercion,
collations, flags, scope/columna, locations, herencia y metadatos desconocidos.
También se rechazan ambos lados alterados a la vez, aprobación/provenance falsa,
ciclos, getters, símbolos, propiedades ocultas, valores no JSON, NaN/Infinity que
se convertirían en null, undefined, arrays dispersos y cero negativo.

## 5. Falsos positivos posibles y alternativas descartadas

| Atajo | Riesgo | Disposición |
| --- | --- | --- |
| Siete grupos iguales | Pérdida de posición y multiplicidad | No habilita equivalencia |
| Hash corto o identidad textual | Colisión/truncamiento o bindings distintos | Hash solo diagnóstico; comparar registros completos |
| Quitar paréntesis/casts con regex | Cambia precedencia/coerción/NULL | Prohibido |
| Aplanar cualquier AND | Admite otro árbol, efectos o nodos ocultos | Solo la forma exacta, aún no aprobada |
| Ordenar/deduplicar operandos | Pierde orden, ocurrencias y condiciones | Prohibido |
| Algunos valores de slug | Cobertura finita no universal | Solo complemento futuro, no prueba |
| pg_get_constraintdef pretty / texto fijo | No demuestra el árbol ni bindings | Útil diagnóstico, insuficiente |
| Desactivar CHECK / modificar fuente | Debilita seguridad o invalida fuentes | Prohibido |
| Usar este fixture como captura real | Fabrica evidencia | Prohibido; modelo siempre BLOCKED |

La versión registrada de collation no demuestra la biblioteca efectiva. La
proyección omitida/maliciosa, un extractor comprometido, un catálogo modificado
durante captura o un formato interno cambiado pueden fabricar igualdad aparente.
Requieren procedencia confiable, inventario de campos por build y snapshot
consistente; comparar JSON no resuelve por sí solo esos riesgos.

Límites conservadores también causan falsos negativos (locations diferentes,
árbol ya plano en origen, otra asociación equivalente, casts legítimos o versión
desconocida). Se prefiere STOP frente a ampliar la regla sin evidencia.

## 6. Próximo experimento propuesto y criterios de aceptación

**No ejecutado ni autorizado aquí.** Obtener primero capturas completas y
bindings por posición en un ensayo local específicamente aprobado. Si requieren
una sonda/instalación, presentar antes su código, permisos y reversión. Ningún
cambio de política, código de aceptación ni SQL alojado está incluido.

- WHEN una captura sea incompleta/no confiable, el analizador SHALL detenerse.
- WHEN un operando, flag, binding o multiplicidad difiera, SHALL conservar FAIL.
- WHEN el árbol no tenga exactamente la forma prevista, SHALL conservar FAIL.
- WHEN el modelo sintético coincida, el catálogo SHALL seguir BLOCKED/FAIL.
- UNTIL política aprobada, validación nativa y autorización humana estén presentes,
  el comparador SHALL permanecer inalterado.
- IF se propone activación futura, SHALL existir revisión independiente, todas
  las negativas nativas, evidencia del resto del catálogo exacto y reversión que
  restaure la comparación estricta sin alterar las siete fuentes.

Fuentes primarias: [primnodes.h PG17](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/include/nodes/primnodes.h),
[transformAExprBetween](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/parser/parse_expr.c),
[makeAndExpr](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/parser/gram.y),
[lógica SQL PG17](https://www.postgresql.org/docs/17/functions-logical.html).
REL_17_STABLE es referencia metodológica; antes de una extracción real deberá
fijarse el commit/build exacto, no confiar en una rama mutable.

## 7. Validación de esta propuesta, no del motor PostgreSQL

| Validación ejecutada | Resultado |
| --- | --- |
| `node scripts/test-pr39-local-recovery.mjs` | 103 negativas offline PASS, preflight incluido |
| `node scripts/test-pr39-slug-structure-proposal.mjs` | 62 negativas offline PASS; modelo positivo BLOCKED |
| `node scripts/pr39-local-synthetic-recovery.mjs` (sin flags) | Preflight offline PASS; sin Docker/red/SQL |
| `node --check` del nuevo archivo | PASS |
| `git diff --check` | PASS |
| Diff protegido frente a fe52230 | Vacío en runner, comparador, diagnóstico, tests previos, siete fuentes, manifest, server y apps |
| Revisión independiente Codex local | 103 + 62 negativas verificadas; sin P1/P2 nuevos ni bypass |

Son **165 casos negativos**, no pruebas de equivalencia PostgreSQL. Los asserts
positivos solo verifican contratos/modelos. No se ejecutó suite de la app, build,
parser SQL real ni validación nativa, y no se instaló software. El código nuevo
es un test opt-in sin exportaciones, no una biblioteca de aceptación.

Logs ignorados en apps/raxi-hq/.validation, SHA-256:

| Archivo | SHA-256 |
| --- | --- |
| `pr39-fifth-baseline-offline.log` | `1429253972be7b1d1abf60fd45bfedc2fdd34c984cef1b5c58c34520483853ed` |
| `pr39-structure-offline.log` | `d5f587800b906d3f199197de1a99301e470391cafd055fcc189d58801e4f91f1` |
| `pr39-fifth-preflight.log` | `d538f42d73c7404add987ae25aea46a60b9238bb6925cac43c1d4f622692246f` |

La revisión independiente también identificó los límites conservadores descritos:
modelo parcial, ausencia de capturas/bindings nativos y extractor, locations/tags
no soportados, política y autorización pendientes. No hubo cambios en la oficina,
Guardian, OpenGym ni el observador histórico. Conservar el PR abierto/en borrador
y el último ensayo nativo FAIL. No merge.
