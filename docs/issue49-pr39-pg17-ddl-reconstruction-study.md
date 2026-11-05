# Raxi HQ — Estudio offline del origen de la divergencia de CHECK en PostgreSQL 17

**Estado:** investigación documentada / hipótesis causal fuerte, **no** solución implementada.  
**Fecha:** 2026-11-05.  
**Ámbito:** `public.raxi_workspaces.raxi_workspaces_slug_check` en PR #39; seguimiento PR #50.

## 1. Hallazgo comprobable: DDL original

La fuente pinneada del manifiesto `supabase/staging/raxi-hq-staging.manifest.json`, versión `20261019030541`, es:

`supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql` (SHA-256 LF fijado en el manifiesto: `e0f0a828b5d4f31960f2153ad910bb84a399a449754db8761057e91047cd7ba0`).

La definición de `slug` usa:

```sql
slug text not null check(length(slug) between 2 and 64 and slug ~ '^[a-z0-9-]+$')
```

No modificar esta migración ni el manifiesto con el propósito de forzar un PASS. El `CHECK` no tiene nombre en el DDL original, y PostgreSQL asigna `raxi_workspaces_slug_check` en este caso.

## 2. Qué indican las fuentes primarias de PostgreSQL

- `pg_get_constraintdef(oid)` **reconstruye** SQL desde la definición interna; no devuelve el texto original de creación: https://www.postgresql.org/docs/17/functions-info.html.
- El código de `pg_dump` lee expresamente `pg_catalog.pg_get_constraintdef(c.oid) AS consrc` al recuperar restricciones `CHECK`: https://github.com/postgres/postgres/blob/REL_17_STABLE/src/bin/pg_dump/pg_dump.c (la rama es móvil; fijar commit antes de concluir a nivel binario).
- El parser `parse_expr.c` contiene la transformación dedicada `transformAExprBetween` y la ruta de `BoolExpr`: https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/parser/parse_expr.c.
- `pg_dump` de formato `-Fc` produce instrucciones reutilizables que `pg_restore` ejecuta y que se analizan de nuevo en el destino: https://www.postgresql.org/docs/17/app-pgdump.html y https://www.postgresql.org/docs/17/app-pgrestore.html.

**Inferencia causal más plausible (no verificada extremo a extremo):** la migración produce internamente `AND(AND(L,U),R)` por la expansión de `BETWEEN` y el `AND` exterior; la decompilación de `pg_get_constraintdef` representa las comparaciones explícitas en SQL, y el parser del destino forma `AND(L,U,R)`. Se conoce el par de formas por captura PG17.11, y el decompilador/flujo de dump están documentados; **no se ha inspeccionado el DDL real extraído del archivo `-Fc` de ese ensayo** ni fijado el commit exacto del código fuente del ejecutable. Por tanto, este mecanismo permanece en estado **HIPÓTESIS FUERTE**, no HECHO confirmado en la sesión concreta.

## 3. Alcance del problema de catálogo

El rechazo `assertPr39CatalogEquality` es correcto: compara definiciones canónicas estrictamente. El último ensayo de dos contenedores PG17.11 informó divergencia solo en `tables/raxi_workspaces.constraints`, pero no completó el control posterior de aislamiento entre propietarios. La atestación offline por SHA de captura identifica tres operandos L/U/R íntegros y 35 ocurrencias de OID; las 27 combinaciones de AND ternario y las 62 negativas del modelo pasaron. Ninguno de esos resultados habilita sustitución de un nodo interno por otro en producción ni garantiza que se mantenga la equivalencia bajo diferentes builds, collations y permisos.

## 4. Alternativas de corrección sin debilitar el comparador

### Ruta C1, prioritaria: explorar DDL canónico de creación

Estudiar en un **nuevo fixture sintético aislado**, NO en el esquema real, dos construcciones alternativas:

- **T0 (control):** DDL original con `BETWEEN`.
- **T1 (hipótesis):** mismo predicado expresado con comparaciones explícitas `length(slug)>=2 AND length(slug)<=64 AND slug~...`, sin depender de `BETWEEN`.

En cada variante hay que crear origen y restauración independientes bajo la misma imagen PG17.11 fija; ejecutar `pg_dump -Fc` y `pg_restore` con los mismos parámetros; capturar definición de `CHECK`, huella del árbol `conbin` y catálogo sin exponer valores. Si T1 produce estructuras y catálogo idénticos y supera aislamiento, esa variante puede proponerse en un **cambio de migración nuevo, separado y revisado**, sin reescribir la historia ni alterar silenciosamente las siete fuentes pinneadas.

**NO está probado** que T1 produzca el mismo árbol durante el ciclo de decompilación; comprobarlo antes de recomendar un cambio de DDL. Las alternativas de agrupar `AND` con paréntesis o cambiar nombres de constraint pueden no preservar la forma interna, y tampoco deben asumirse como soluciones.

### Ruta C2: inspeccionar DDL extraído del archivo de archivo custom

El archivo `pg_dump -Fc` previo era **en memoria y efímero**; no hay evidencia de que exista guardado localmente. Para observar la reconstrucción exacta, un ensayo futuro autorizado podrá capturar solo la **definición del CHECK objetivo** desde `pg_restore --file` sobre el archivo sintético, dentro de un ambiente temporal y sin mostrar otros datos ni permitir ejecución de sus instrucciones. Esta inspección explica el tramo donde se perdió el agrupamiento, pero no sustituye la restauración ni su QA.

### Ruta B, subsidiaria: política excepcional específica

Solo si C1 no alcanza catálogos idénticos, estudiar un adaptador independiente y restringido a `raxi_workspaces_slug_check`, build exacta y atestación de todos los bindings, y luego revisión independiente con autorización humana separada. **No** modificar comparador canónico aún.

## 5. Próxima prueba: preparación no ejecutable

Antes de crear contenedores:

1. Verificar la identidad del archivo SQL fijado por manifiesto; no modificarlo.
2. Extraer un manifiesto de escenario de dos variantes (T0/T1), scripts para capturar solo hashes y metadatos, y una lista de controles fail-closed.
3. Revisar riesgos de `pg_restore` de un archivo arbitrario, endpoint local Docker, imagen pinneada y limpieza de contenedores; no usar datos externos.
4. Pedir **aprobación expresa y delimitada** al usuario para T0/T1 en contenedores desechables sin red, sin puertos ni volúmenes compartidos; nunca tocar `raxi-pg17-campaign-qa` ni staging.
5. Si las pruebas pasan, solicitar revisión Codex independiente de las nuevas herramientas y su reporte antes de siquiera proponer alterar DDL.

## 6. Decisión de seguridad

`decision=BLOCKED; semanticEquivalence=NOT_VERIFIED; allowCatalogPass=false; NO_GO_HOSTED_MIGRATION`.

El presente documento no modifica fuentes SQL, migraciones, runner, comparador, staging, RLS, Auth, Docker ni infraestructura.


## Corrección de la preparación T0/T1 (2026-11-05)

Primera ejecución del operador sobre commit `d1b06ba904b98989a1830f9324922210c20f8890`: **FAIL** en `variant diff is not the one reviewed change`; código distinto de cero. Causa comprobada en el script: `String.replace(original, explicit)` y la inversión con argumento string interpretan el fragmento literal `$'` que aparece al final del patrón SQL como un token especial de sustitución en JavaScript. El fallo es del generador de escenario, no demuestra un problema del SQL ni de PostgreSQL. El `Write-Host` verde posterior al `throw` no representa un PASS.

Correctivo en `scripts/issue49-pr39-ddl-offline-scenarios.mjs`: usar callbacks `source.replace(original,()=>explicit)` y `variant.replace(explicit,()=>original)` para conservar literalmente el ancla `$`; reforzar verificación de la expresión regular. Commit `1a0127c3d3e015f90b010d8022fbdf9a0c1b19cb`. Una comprobación de texto con la fuente original recuperada de GitHub dio exactamente una aparición del CHECK, una del ancla antes y después, ida/vuelta exacta `true`; **el operador debe repetir la prueba en Windows antes de declarar PASS del ejecutable**. No hubo cambios en las migraciones ni en el comparador, SQL, Docker o Supabase.
