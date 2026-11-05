# PR #39 · Atestación estructural acotada de `raxi_workspaces_slug_check`

**Estado: OBSERVACIÓN OFFLINE, NO ES PERMISO DE RESTAURACIÓN NI PRUEBA NATIVA DE SEMÁNTICA.**

## Alcance y procedencia

El módulo independiente `scripts/pr39-pg17-structural-attestation.mjs` y su batería `scripts/test-pr39-pg17-structural-attestation.mjs` examinan **una sola captura sintética local**, proporcionada por el usuario después de un ensayo aislado en dos contenedores PostgreSQL 17.11. El archivo original no se añade al repositorio. Su SHA-256 se fija en el verificador:

`d968dfee0b0e3b09ff70ede2776b8c97a309392487db1586904a53034cefd179`

Este digest identifica bytes de un archivo previamente obtenido, **no es una firma del servidor PostgreSQL** ni demuestra por sí solo su autenticidad. La compilación declarada en el archivo coincide entre origen/restauración (`x86_64`, PG17.11, SHA de imagen, binario y `pg_config`), pero `datumAssumptionBytes:8` permanece identificado como **supuesto**, no como una medida independiente del ABI.

## Diseño cerrado y garantías negativas

El verificador importa el parser cerrado ya existente `inspectPg17SlugCandidate`, sin modificarlo. Exige que el JSON recibido sea un objeto simple, con campos exactamente esperados y sin getters, símbolos, objetos cíclicos, claves extra o valores de tamaños excesivos. Exige además:

- `scope=LOCAL_SYNTHETIC_ONLY`, `decision=BLOCKED`, `semanticEquivalence=NOT_VERIFIED`, `nativeValidated=false`, `allowCatalogPass=false` y `positionalStatus=CAPTURED_FOR_REVIEW_NOT_EQUIVALENCE`.
- Huella fija **del reporte completo** en el modo CLI, y huellas fijas de las dos expresiones `conbin`, sus dos catálogos ordenados por ocurrencia y la información de compilación. No basta recalcular el hash dentro del JSON, ni alterar origen y restauración conjuntamente.
- Metadatos exactos de la restricción observada: un `CHECK` local y validado, `slug` atributo 3 de tipo `text`, collation 100, PostgreSQL `170011`. Los OID locales de la propia constraint son diferentes como se capturaron; no se interpretan como identidades semánticas.
- Únicamente las formas `AND(AND(L,U),R)` y `AND(L,U,R)`, en ese orden. El parser rechaza nodos desconocidos, casts no admitidos y otros árboles booleanos.
- Los **tres subárboles de operandos completos** deben tener `rawDigest` idéntico entre origen y restauración; los hashes de las constantes deben coincidir, incluyendo bytes físicos serializados.
- Las **35 referencias catalogadas por lado** se comparan por ordinal, tipo (`kind`), campo (`field`), OID e identidad completa, preservando orden, multiplicidad y rutas relativas. El reparto obligatorio es **13 + 13 + 9**.
- Referencias a operadores conocidos de este caso (`>=`, `<=`, `~`), sus funciones implementadoras, tipos y collations, además del vínculo al atributo `slug`. Cualquier discrepancia rechaza la atestación; no existe normalización genérica de SQL, aliases o expresiones lógicas.

La coincidencia genera únicamente una **observación acotada**:

```text
structuralObservation: PINNED_3_OPERANDS_IDENTICAL_WITH_AND_REGROUPING
decision: BLOCKED
semanticEquivalence: NOT_VERIFIED
nativeValidated: false
architectureValidated: false
allowCatalogPass: false
```

No se define `PASS`, `GO`, ninguna excepción en `assertPr39CatalogEquality`, ni una transformación del archivo `conbin`. **El ejecutor de restauración sigue rechazando la diferencia.** No se importará este módulo desde `scripts/pr39-local-synthetic-recovery.mjs`, la comparación de catálogo ni un proceso alojado.

## Comandos offline (Windows)

Desde una carpeta limpia del PR #39 en el SHA aprobado:

```powershell
Set-Location "$HOME\source\RaxiHQ-PR39-CONBIN-20261104"
node --check scripts/pr39-pg17-structural-attestation.mjs
node scripts/test-pr39-pg17-structural-attestation.mjs

# Prueba opcional SOLO con el JSON local original, sin copiarlo a GitHub:
$env:PR39_NATIVE_EVIDENCE_FILE = "$HOME\source\RaxiHQ-PR39-NATIVE-7e8c58ff1f59.json"
try {
    node scripts/test-pr39-pg17-structural-attestation.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la validacion de evidencia nativa' }
} finally {
    Remove-Item Env:PR39_NATIVE_EVIDENCE_FILE -ErrorAction SilentlyContinue
}

# Observación CLI con huella del archivo completa fijada (NO cambio de política):
node scripts/pr39-pg17-structural-attestation.mjs --evidence "$HOME\source\RaxiHQ-PR39-NATIVE-7e8c58ff1f59.json"
```

No se lee Docker, PostgreSQL, Supabase, la red, credenciales ni proveedores. Los tests crean los datos sintéticos de prueba dentro del propio script. El archivo de evidencia original debe permanecer privado y fuera de GitHub.

## Puertas posteriores

1. Revisión independiente de Codex del SHA exacto y todos los P1/P2, más validación real del código publicado en Windows.
2. Mantener la restauración estricta `FAIL`, documentar el origen de la divergencia y revisar una eventual política excepcional como **otra decisión humana separada**, nunca activada por este módulo.
3. Continuar `NO_GO_HOSTED_MIGRATION`; no merge, despliegue, SQL alojado, proveedores ni modificación de las siete fuentes SQL fijadas.

El reconocimiento de una forma concreta de árboles `AND` no verifica genéricamente que toda restauración, todos los datos de Auth/Storage ni el catálogo completo sean semánticamente equivalentes.

## Endurecimiento CLI: lectura acotada antes de reservar memoria

Codex encontró un hallazgo P2 en el SHA `adbbe05954851b698e438cff561b90c4034122a2`: la CLI aceptaba rutas arbitrarias y ejecutaba `readFileSync` **antes** del límite de 150000 bytes aplicado al Buffer. Esto permitía leer archivos grandes o dispositivos especiales sin una cota de memoria efectiva.

El correctivo introduce `readPr39BoundedEvidenceFile`, utilizado tanto por `--evidence` como por `PR39_NATIVE_EVIDENCE_FILE` en las pruebas. Se valida con `lstatSync` que la ruta sea un archivo regular de 1 a 150000 bytes, luego se abre con banderas de lectura y, en POSIX, `O_NONBLOCK` y `O_NOFOLLOW` donde estén disponibles. Se comprueba de nuevo el descriptor con `fstatSync`; la lectura usa exclusivamente `readSync` sobre un Buffer fijo de **150001 bytes**, rechaza exceso antes de parsear y cierra siempre el descriptor con `finally`. La huella SHA-256 de bytes completos y el resto del verificador permanecen sin cambios. El control no atribuye procedencia ni autenticidad nativa al archivo.

Se añadieron pruebas de proceso hijo con tiempo máximo para rechazar archivo regular de 150001 bytes, directorio y JSON pequeño con huella incorrecta. En POSIX también se rechaza symlink; en Linux, `/dev/zero`, sin permitir bloqueos ni lectura sin límite. La batería original de 44 mutaciones adversariales y 3 rechazos de buffers se conserva.

Las pruebas de este correctivo se ejecutaron localmente con Node 22 en entorno Linux, incluyendo el JSON nativo suministrado por el usuario, y permanecieron `BLOCKED / NOT_VERIFIED`. **Se requiere todavía ejecutar este nuevo SHA en Windows y obtener nueva revisión independiente Codex antes de considerar resuelto el P2.** La prueba no ejecuta Docker, SQL, ni modifica el comparador original o `NO_GO_HOSTED_MIGRATION`.

## Actualización de evidencia posterior — 2026-11-04

Las frases previas «Windows pendiente» y «Codex pendiente» corresponden a un estado histórico. Posteriormente, **el usuario ejecutó en Windows** las suites de atestación y regresión del commit `5e5766a76f7ade59ff4eda4fa83aae800fe516fe`, incluidas las pruebas contra la copia local privada del JSON original, con resultados PASS. La revisión de Codex de ese SHA fue completada sin nuevos hallazgos. El hallazgo P2 sobre `readFileSync` ya quedó corregido mediante lectura acotada y su hilo cerró después de comprobación independiente. Ninguno de estos PASS ha sido interpretado como equivalencia PG17 o permiso de restauración.

La siguiente fase de integración contra el `main` actualizado y el nuevo control de daemon Docker constituyen cambios adicionales, por lo que el conjunto combinado deberá volver a probarse. Las 35 identidades por posición continúan como evidencia **de una única captura sintética pinneada por bytes**; no sirven como atestación general para otros catálogos o versiones.
