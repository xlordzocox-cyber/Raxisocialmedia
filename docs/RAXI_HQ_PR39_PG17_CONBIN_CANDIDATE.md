# PR39 — candidato de extracción offline de `pg_node_tree` (PostgreSQL 17)

**Estado: IMPLEMENTADO COMO CANDIDATO OFFLINE; SIN CAPTURA NATIVA, SIN EQUIVALENCIA SEMÁNTICA, SIN AUTORIZACIÓN DE RECUPERACIÓN.**

Base revisada: PR #39 `2fefe4c6a4d05ad58b0d0460e85048f58a2a8e79`. No altera el runner, comparador estricto, SQL fuente ni manifiesto. Añade solo esta documentación y dos scripts autónomos. El usuario verificó sobre el HEAD anterior el preflight 0, 103 negativas 0, 62 negativas de la especificación 0, diff 0. El último ensayo Docker real de PR39 permanece FAIL 1 con limpieza segura. **`NO_GO_HOSTED_MIGRATION` no cambia.**

## ¿Qué se preparó?

- `scripts/pr39-pg17-conbin-extractor.mjs`: tokenizador/decodificador **offline** para un subconjunto cerrado del texto interno `pg_node_tree` de PG17. No es el lector nativo `stringToNode()` y NO se considera validado contra la build exacta de PG17 todavía.
- Reconoce únicamente los tags `BOOLEXPR`, `OPEXPR`, `FUNCEXPR`, `VAR`, `CONST` y un conjunto exacto de campos. Si hay nodos, tags, campos, aridades, locations, tipos de valores o flags inesperados, se detiene.
- Distingue el patrón candidato fuente `AND(AND(L,U),R)` con rutas `0.0`, `0.1`, `1` frente al de restauración `AND(L,U,R)` con rutas `0`, `1`, `2`. **No aplana otros AND ni reordena argumentos.**
- Conserva el registro por posición del OID declarado de operadores, funciones, tipos y collations; el `varno`, `varattno`, `varnosyn`, `varattnosyn`, `varlevelsup`, `vartype`, `vartypmod`, `varcollid`, bitmap nulo, y la huella SHA-256 completa del valor bruto `Const`. Los datos del árbol se mantienen en memoria; el informe no imprime bytes ni SQL.
- `PR39_LOCAL_CAPTURE_SELECT` es solo una **definición de consulta SELECT preparada**, sin conexión ni ejecución. Su única relación objetivo es `public.raxi_workspaces` y su CHECK `raxi_workspaces_slug_check`. **No ejecutar sobre staging/producción.**
- `scripts/test-pr39-pg17-conbin-extractor.mjs` verifica el parser y 47 casos adversariales exclusivamente sintéticos, incluyendo errores de formato, nodos desconocidos, cambios en argumentos y falsas autorizaciones.

### Contrato de salida obligatorio

```json
{
  "revision": "PG17_CLOSED_GRAMMAR_CANDIDATE_V1",
  "decision": "BLOCKED",
  "nativeValidated": false,
  "semanticEquivalence": "NOT_VERIFIED",
  "allowCatalogPass": false,
  "provenance": "OFFLINE_UNTRUSTED_NODE_TEXT"
}
```

La coincidencia de forma nunca convierte un `FAIL` del catálogo en `PASS`. Si la forma parece distinta pero sintácticamente válida y aún no es resoluble, el resultado sigue BLOQUEADO. Las pruebas deliberadamente comprueban que cambios de OID, bounds, bytes, función o regex no puedan producir un resultado autorizado.

## Lo que falta antes de declarar una extracción nativa confiable

1. **Fijar exactamente imagen y build PG17:** digest OCI `sha256:...`, `server_version_num`, `pg_config --version`, hash del extractor, fuentes SQL SHA256 y hash del archivo de recuperación. La etiqueta mutable `postgres:17` por sí sola no basta.
2. **Probar el formato real:** ejecutar la SELECT únicamente en dos contenedores PG17 sintéticos nuevos y aislados **después de autorización explícita**; comprobar sus campos efectivamente serializados. Cualquier campo no admitido por este parser se clasifica STOP, no se elimina.
3. **Resolver identidades por ocurrencia:** cada registro `path` / `field` / `oid` debe consultarse en los catálogos *de su propia base* para obtener esquema y firma del operador/función, identidad del tipo y collation, configuración y huella de implementación. OID local idéntico entre bases **no** prueba identidad. Nunca usar `DISTINCT`, conjuntos u ordenaciones que pierdan vínculos.
4. **Validar cada constante:** bytes íntegros, longitud física, byval, NULL, tipo/collation y codificación. Las huellas reportadas de la muestra sintética no son evidencia de la constante PostgreSQL real.
5. **Capturar consistentemente:** identificar sesión, database/constraint/table/attnum, versión de imagen y DDL concurrente; evaluar la necesidad de transacción/snapshot/bloqueo de lectura. No imprimir `conbin` ni los valores de `Const` en logs compartidos.
6. **Verificación independiente:** negativos de bindings invertidos, nodos extra, casts, operadores shadow, volatilidad, impl alteradas, providers/collations, catálogos RLS/ACL/roles, flags omitidos y cambio de PG patch. Revisión Codex en HEAD exacto.
7. **Política separada y humana:** aun con capturas nativas íntegras, una eventual excepción única de asociación `AND` requiere prueba y aprobación explícitas; nunca habilitar por defecto, y nunca modificar el comparador actual indirectamente.

### Limitaciones conocidas del candidato

- **No resuelve los OID**: entrega un *plan de bindings posicionales*, no identidades demostradas. Tampoco inspecciona implementaciones/volatilidad de funciones PostgreSQL.
- **No es un parser PostgreSQL oficial**: una lectura interna cambiante podría no coincidir, provocando STOP. No intentar adaptarlo eliminando campos desconocidos.
- **No permite un ensayo de recuperación exitoso**: el runner y el gate originales siguen sin importarlo y seguirán rechazando el `CHECK` divergente.
- **No reemplaza el extractor nativo confiable** solicitado como objetivo final. Es el primer componente auditable y versionado; la siguiente puerta es la captura local y la resolución de catálogos.

## Comandos seguros de prueba (solo offline, sin contenedores)

Desde la raíz de un worktree aislado del PR39 actualizado:

```powershell
node --check scripts/pr39-pg17-conbin-extractor.mjs
node --check scripts/test-pr39-pg17-conbin-extractor.mjs
node scripts/test-pr39-pg17-conbin-extractor.mjs
node scripts/test-pr39-local-recovery.mjs
node scripts/test-pr39-slug-structure-proposal.mjs
node scripts/pr39-local-synthetic-recovery.mjs
```

Estos últimos comandos **no** llevan `--run-local`. Ningún servicio, Docker ni SQL se ejecuta por el candidato. No agregar al runtime ni al escáner de aceptación. Guardar solamente conteos, códigos y fingerprints, nunca árboles o datos privados.

## Fuentes oficiales a usar para revisión de la build exacta

- PostgreSQL 17 `pg_constraint`: https://www.postgresql.org/docs/17/catalog-pg-constraint.html (`conbin` es interno).
- PostgreSQL 17 funciones de información: https://www.postgresql.org/docs/17/functions-info.html (`pg_get_constraintdef` reconstruye SQL).
- Source PG17 `src/backend/nodes/outfuncs.c`, `src/backend/nodes/read.c`, `src/include/nodes/primnodes.h`: fijar commit exacto de la versión presente antes de cualquier promoción a captura nativa.

**Gates inalterados:** NO merge; NO Docker/`--run-local`; NO proveedores; NO SQL alojado; NO instalación de extensiones; NO cambios RLS/Auth; NO activación de B2. Cualquier ejecución nativa futura requiere aprobación específica adicional.
