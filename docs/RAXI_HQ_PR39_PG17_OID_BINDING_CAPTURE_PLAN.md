# PR #39 · Resolver de identidades OID y diseño de captura nativa PG17

**Estado: CANDIDATO OFFLINE. NO ejecutado contra PostgreSQL. NO autoriza restauración.**

Esta fase complementa, pero no sustituye, el extractor `pg_node_tree` de gramática cerrada `PG17_CLOSED_GRAMMAR_CANDIDATE_V2`. El problema observado sigue siendo `raxi_workspaces_slug_check` con formas `AND(AND(L,U),R)` y `AND(L,U,R)` tras restauración. La decisión final de catálogo permanece `FAIL`, `NOT_VERIFIED`, `NO_GO_HOSTED_MIGRATION`.

## Implementación offline (nueva)

- `scripts/pr39-pg17-oid-binding-resolver.mjs`: consume exclusivamente candidato `BLOCKED` V2 y **dos paquetes sintéticos** de identidades de catálogo con exactamente una fila por ocurrencia, en el mismo orden que `positions[].references`.
- `scripts/test-pr39-pg17-oid-binding-resolver.mjs`: negativos contra duplicados, permutación, OID falsos, identidades sombra, campos inesperados, falsificación de procedencia, identidad de implementación, configuración de collation, arquitectura, versión, digest de imagen y compilación, tipos, funciones, valores de constante, `Var`, falso PASS y negativos que alteran simultáneamente el catálogo y el árbol. Solo datos sintéticos, sin acceso Docker/SQL.
- Reconstruye las rutas relativas de cada átomo (`0.0`, `0.1`, `1` frente a `0`, `1`, `2`) **sin ordenar, deduplicar, aplanar ni modificar**. Requiere mismo número y orden de referencias con identidad completa estrictamente idéntica. El número local del OID no se usa para declarar equivalencia: se exige que el registro de su propia base vincule el OID al objeto correcto.
- Paquetes sin campos sobrantes: `provenance='SYNTHETIC_OFFLINE'`, `side`, `build`, `rows[{ordinal,path,field,kind,oid,identity}]`; todos los campos se validan y deben corresponder a lo producido por el parser. Los OID `0` solo son explícitamente permitidos para collation/función opcional, y requieren `{zeroOid:true}`. Otros OID `0` bloquean.
- Identidades exigidas por clase:
  - **operador**: esquema, nombre, forma, tipo izquierdo/derecho/resultado, procedimiento efectivo, capacidad merge/hash;
  - **función**: esquema, nombre, firma de argumentos, resultado, lenguaje, volatilidad, paralelismo, strict, leakproof, security definer y huella de implementación;
  - **tipo**: esquema, nombre, clase/categoría, longitud, by-value, alineación, almacenamiento, definido, elemento y collation predeterminada;
  - **collation**: esquema, nombre, provider, determinismo, encoding, `collate`, `ctype`, `locale`, reglas y versión.
- Esta coincidencia es **solo estructural sintética**: ni hashes ni datos autodeclarados verifican una compilación o entidad real de PostgreSQL.

### Contrato obligatorio de salida

```json
{
  "decision": "BLOCKED",
  "provenance": "SYNTHETIC_OFFLINE_ONLY",
  "nativeValidated": false,
  "architectureValidated": false,
  "semanticEquivalence": "NOT_VERIFIED",
  "allowCatalogPass": false
}
```

## Diseño para futura captura nativa *solo lectura* (NO ejecutar todavía)

### A. Fijar imagen, binario y arquitectura

**Requerirá autorización adicional del usuario para usar contenedores aislados**. Antes de cualquier lectura nativa, registrar de cada contenedor creado exclusivamente para el ensayo:

1. Digest de imagen OCI **inmutable** y digest de contenedor por `docker image inspect` / `docker inspect`; **no confiar en `postgres:17` mutable**.
2. Plataforma `linux/amd64` o `linux/arm64`, arquitectura del kernel (`uname -m`), salida de `getconf LONG_BIT=64` y `pg_config --configure` / `pg_config --version`. El tamaño de `Datum` sigue siendo un supuesto hasta comprobar la configuración y la implementación de la imagen elegida.
3. SHA-256 del ejecutable `postgres`, versión de servidor (`server_version_num` completo, por ejemplo 1700xx) y `version()`; información de `pg_config` que corresponda al propio servidor.
4. Para las **dos** bases, igualdad exacta de digest OCI, SHA del binario, plataforma, configuración, versión completa y `Datum` de 8 bytes; si falta cualquier dato, `STOP`. No basta coincidencia de versión mayor PG17.
5. Puntos de fijación adicionales: SHA-256 del extractor y resolvedor, del script de laboratorio y de las 7 fuentes SQL fijadas por manifiesto. No imprimir secretos, credenciales ni datos de usuarios.

### B. Capturar el CHECK objetivo en un snapshot estable

Todos los SQL nativos previstos son `SELECT` sobre `pg_catalog` (y la vista de configuración apropiada, cuando esté autorizada). Limitar exactamente a `public.raxi_workspaces` / `raxi_workspaces_slug_check`. Usar una transacción `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; ... COMMIT;` únicamente en contenedores sintéticos autorizados. La capa de ejecución debe impedir SQL no previsto y limitar las consultas a una allowlist fija. El extractor original **todavía no se importa en el runner de restauración**.

Campos mínimos a capturar en origen y restauración:

- `pg_constraint`: identidad de constraint, `conbin::text`, clase `contype`, validación, local/inherited, `conkey`, flags de CHECK;
- `pg_class`, `pg_namespace`, `pg_attribute`: relación exacta y `attnum` de `slug`, su tipo, typmod y collation;
- `pg_database`: locale provider, collate, ctype, locale y versión de collation de base;
- ajustes de sesión pertinentes (`server_version_num`, encoding, `search_path`, `standard_conforming_strings`), rol/identidad de servidor, snapshot consistente;
- nodos serializados completos y referencias **ordenadas por ocurrencia** `path,field,kind,oid`, incluidas las repeticiones. Restringir el material bruto a memoria, no a logs compartidos.

### C. Resolver cada referencia sin perder posiciones

El futuro adaptador SQL deberá recibir parámetros de forma segura; no interpolar `conbin`, claves arbitrarias ni texto aportado por el usuario. Diseño de una **consulta de catálogo por base**, con una tabla de petición ordenada —conceptualmente `jsonb_to_recordset($1::jsonb) AS q(ordinal int,path text,field text,kind text,oid text)`— y una fila de respuesta por ordinal. No usar `DISTINCT` ni agregar OID antes de volver a conectar con la posición. Comparar `número de peticiones = número de resultados` y rechazar OID inexistentes o colisiones.

Mapear las clases de referencia desde **su propio catálogo**:

- `pg_operator`, `pg_namespace`, `pg_type`, `pg_proc`: tipos de operandos/resultado, firma y función implementadora; conservar los OID por ocurrencia e identidad completa del procedimiento;
- `pg_proc`, `pg_language`, `pg_type`: identidad de función, `proargtypes`, resultado, `prosrc`/`probin` y banderas; en funciones built-in, una función con mismo nombre/símbolo **no demuestra** implementación binaria equivalente sin hash exacto del ejecutable y build;
- `pg_type`, `pg_namespace`, collation y metadatos de representación: familia, alineación, almacenamiento, elemento y collation;
- `pg_collation`: schema, provider, encoding, determinismo, reglas y versiones; **los nombres de collation por sí solos no prueban semántica equivalente**. Considerar además huella de versión de biblioteca locale/ICU correspondiente a la imagen.

Catálogos primarios PG17: [`pg_operator`](https://www.postgresql.org/docs/17/catalog-pg-operator.html), [`pg_proc`](https://www.postgresql.org/docs/17/catalog-pg-proc.html), [`pg_type`](https://www.postgresql.org/docs/17/catalog-pg-type.html), [`pg_collation`](https://www.postgresql.org/docs/17/catalog-pg-collation.html), [`pg_database`](https://www.postgresql.org/docs/17/catalog-pg-database.html), [`pg_config`](https://www.postgresql.org/docs/17/view-pg-config.html).

### D. Políticas de rechazo

- OID idéntico con identidades distintas: `STOP`.
- OID distinto con identidades aparentemente iguales: **como máximo coincidencia sintética**, nunca aprobación automática.
- Fila inexistente, repetida, reordenada o sombreada; tipo/collation/función/op/constante cambiado; cast u operador extra; datos de versión/plataforma incompletos: `STOP`.
- El `source` y `restored` deben acreditar el mismo build y contexto de collation/encoding. Ninguna normalización de texto SQL, alias, `AND`, casts o expresiones generales.
- El comparador canónico del runner y `assertPr39CatalogEquality` **no se modifican** por este PR. Si continúan diferentes las definiciones del CHECK, la restauración sigue `FAIL`. Una excepción única `AND` solo podrá proponerse después de captura real, pruebas independientes y aprobación humana **separada**.

## Estado, restricciones y próxima autorización

**No se ejecutó** PostgreSQL, Docker, `--run-local`, consulta SQL, Supabase, servicio de Auth ni providers. El usuario ya había autorizado pruebas offline, no este ensayo nativo. La vista `pg_config` exige privilegios adecuados; no se amplían permisos para leerla. Ningún script nuevo dispone de camino de escritura a PostgreSQL, ni de capacidad de integrar la equivalencia.

**Puerta siguiente:** una vez validado en Windows el resolvedor offline y finalizada la revisión independiente Codex del HEAD exacto, solicitar permiso explícito limitado a dos contenedores PG17 **locales, efímeros, sin red, sin puertos, sin montajes persistentes**, para capturar la compilación, arquitectura, CHECK y OID por posición en datos sintéticos. Incluso ese ensayo **no** autoriza merge, cambios en SQL alojado ni `NO_GO_HOSTED_MIGRATION → GO`.

## Endurecimiento V2 a raíz de revisión Codex (2026-11-04)

La revisión independiente del resolvedor V1 detectó tres hallazgos P2 que no permitían un `PASS` de catálogo, pero sí podían fabricar una huella de material sintético incompleto:

1. **Esquema cerrado del extractor**: V2 exige en cada átomo, en orden, exactamente las referencias que emite el extractor `PG17_CLOSED_GRAMMAR_CANDIDATE_V2`, incluidas rutas relativas y pares `field/kind`. Los átomos L/U contienen 13 referencias y R contiene 9 (35 en total). Se prohíbe que origen y restauración eliminen juntos las referencias o inventen un campo/clase de OID en ambos paquetes. Se contrastan además los OID de las referencias `Var` y `Const` con los declarados por sus respectivos `varBinding` y `constant`. Esta regla sigue siendo sobre **evidencia sintética, no autoridad nativa**.
2. **Typmod de constante**: se valida la presencia de `constant.typmod` (texto numérico PG17) y se incluye por cada posición en la proyección comparada y su huella `structuralBindingDigest`. Una diferencia unilateral es `STOP`; un cambio idéntico en ambos lados conserva `BLOCKED` y produce una huella distinta.
3. **Coherencia local de OID**: dentro de cada paquete, un par `(kind, oid)` debe vincularse a la misma identidad en todas sus ocurrencias. No se deduplican registros ni se equiparan los números OID de bases distintas. El fixture sintético actualizado comparte identidad por `(kind,oid)`; las pruebas rechazan identidades contradictorias inyectadas **simultáneamente** en ambos catálogos.

Se añadieron negativos para ausencia total de referencias, eliminación de slots obligatorios, `field/kind` inventados en ambos lados, `consttypmod` alterado/ausente, OID del `Var` inconsistente y conflicto de identidad local de función o collation. El fixture que renumera OID preserva la identidad sintética y actualiza ambos campos vinculados, sin pretender demostrar equivalencia nativa.

**Puertas sin cambios**: `BLOCKED`, `nativeValidated:false`, `architectureValidated:false`, `semanticEquivalence:'NOT_VERIFIED'`, `allowCatalogPass:false`; sin importar esta biblioteca en el runner, sin cambios al comparador de catálogo, 7 SQL fuente, manifiesto, permisos o `NO_GO_HOSTED_MIGRATION`.

**Validación pendiente:** los cambios V2 fueron publicados mediante conector GitHub, pero esta versión aún requiere ejecución independiente de `node scripts/test-pr39-pg17-oid-binding-resolver.mjs` y suites anteriores en el worktree Windows, `git diff --check` y revisión Codex del HEAD exacto. No presentar resultados de V1 como si validaran V2. Las capturas nativas, arquitectura de Docker y firmas reales de PostgreSQL 17 siguen **NO EJECUTADAS**; se solicitará autorización humana antes de cualquier laboratorio.
