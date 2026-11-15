# Issue #49 — PG17 / PR #39: evaluación de la divergencia `raxi_workspaces_slug_check`

**Estado a 2026-11-05: BLOCKED / NOT_VERIFIED / NO_GO_HOSTED_MIGRATION.**

## Evidencia offline ejecutada y reportada por el operador

- Archivo privado `RaxiHQ-PR39-NATIVE-7e8c58ff1f59.json` presente fuera de GitHub y SHA-256 completo igual a `d968dfee0b0e3b09ff70ede2776b8c97a309392487db1586904a53034cefd179`.
- `node --check scripts/pr39-pg17-structural-attestation.mjs`: exit 0.
- `node scripts/test-pr39-pg17-structural-attestation.mjs`: PASS bounded CLI path guard (3 negativos), PASS `PR39_PINNED_STRUCTURAL_ATTESTATION_OFFLINE` (44 adversariales sintéticos, 3 archivos inválidos).
- `node scripts/pr39-pg17-structural-attestation.mjs --evidence <ruta privada>`: `PINNED_3_OPERANDS_IDENTICAL_WITH_AND_REGROUPING`, 35 OID ocurrencias, 3 subárboles atómicos coincidentes, `BLOCKED / NOT_VERIFIED`, `allowCatalogPass=false`, `NO_GO_HOSTED_MIGRATION`.
- Verificación realizada sobre archivos presentes en la máquina del usuario. No se transmitió el JSON privado a GitHub ni se ejecutaron Docker, SQL o Supabase en este paso.
- El PR #39 consta en GitHub como **integrado en main** (merge `200aeee384edb137ea07620e2e20480b1b0d7df4`), pero integró **instrumentación diagnóstica**, no una política de equivalencia autorizada.

## Prueba de asociatividad ejecutada en Windows

El operador descargó el commit `3e829d2953298f77b48c1f1aef6998bf3827dec3` y ejecutó `node --check` y `node scripts/issue49-pr39-and-associativity.mjs` sobre su copia temporal en Windows, sin fallos. Salida: `PASS PR39 BOOLEAN ALGEBRA: 27 of 27 three-valued combinations; decision BLOCKED / NOT_VERIFIED`. Esto acredita la tabla lógica de tres valores (27 combinaciones) únicamente, y **no** establece pureza/identidad real de las funciones ni equivalencia de catálogo o restauración. El bloqueo original permanece.

## Distinción técnica obligatoria

La diferencia observada es el agrupamiento de los mismos tres operandos en `AND(AND(L,U),R)` frente a `AND(L,U,R)` para una captura sintética pinneada. La identidad de los 35 bindings y de los operandos bajo condiciones cerradas es evidencia estructural; **no es automáticamente una prueba general de seguridad de restauración**. Incluso un argumento formal de asociatividad del operador booleano ternario (`TRUE`, `FALSE`, `UNKNOWN`) requeriría acreditar que los operandos PostgreSQL son efectivamente los mismos y puros, con funciones/operadores/locale/errores comparables, y que el resto del catálogo no ha cambiado.

El verificador deliberadamente **no** se importa en `assertPr39CatalogEquality`, `pr39-local-synthetic-recovery.mjs` ni en el runtime. Prohibido reinterpretar `exit 0` de la herramienta offline como aceptación de restauración.

## Gates necesarios para proponer una excepción estrecha (NO habilitada)

1. Preparar prueba formal documentada de la única asociación de tres operandos (sin conmutar, deduplicar ni aplanar otras expresiones). Verificar lógica PostgreSQL de tres valores y premisas de ausencia de efectos laterales; registrar hipótesis vs hecho.
2. Corroborar en el laboratorio sintético y build exacta PostgreSQL 17, con capturas originales/restore y bindings por posición, que tipos, OID resueltos, implementaciones, volatilidad, collation/encoding, operandos y constantes permanecen estrictamente iguales. Reutilizar evidencia con SHA pinneado cuando baste; cualquier ensayo nativo adicional exige autorización explícita y conserva restricciones de red y datos.
3. Probar que absolutamente todos los demás objetos y campos canónicos (RLS, ACL, tablas, funciones, triggers, índices, permisos, propiedades de check, etc.) son idénticos en el ensayo, y que el comparador general sigue fallando ante diferencias adversariales.
4. Proponer una política independiente, limitada por `constraintId`, versión exacta, hashes y campo concreto, nunca un `IGNORE CHECKS` ni un flatten general; ejecutarla inicialmente solo en un evaluador offline con negativas. **No modificar el comparador ni restaurar** en este incremento.
5. Revisión independiente y decisión explícita del usuario antes de activar cualquier excepción; la autorización de una excepción local no implica habilitar staging ni migración alojada.

## Bloqueos paralelos

La Etapa 1 de campañas/Strategy tiene siete baterías con PASS **local sintético**, no Auth real; Etapa 3 debe verificar JWT/RLS/Edge y separación de permisos; Etapa 4 requiere QA y revisión independiente. El manifiesto staging permanece inhabilitado. Esta nota no modifica SQL, permisos, staging, proveedores, Docker, jobs, branch main o despliegues.

## Auditoría de volatilidad de funciones — PASS local, 2026-11-05

El operador ejecutó el fichero `scripts/issue49-pr39-pinned-identity-audit.mjs` desde el commit `e5f2639662425dcf1780187b7b17f7e896850374`, sobre el reporte privado SHA-fijado. El comando `node --input-type=module --check -` no emitió errores y el ejecutable mostró las siguientes identidades declaradas en la evidencia:

| OID | Función | Origen | Restauración |
| --- | --- | --- | --- |
| 150 | `int4ge` | `i` | `i` |
| 1317 | `length` | `i` | `i` |
| 149 | `int4le` | `i` | `i` |
| 1254 | `textregexeq` | `i` | `i` |

Salida final: `PASS PR39 PINNED FUNCTION METADATA: 4 unique functions marked immutable on both sides` y `PR39 REMAINS BLOCKED / NOT_VERIFIED`. `i` representa la **volatilidad declarada `IMMUTABLE` en los metadatos de la captura**, no una prueba nativa independiente de ausencia de efectos o equivalencia de todas las dependencias. No se subió el JSON a GitHub ni se modificó ningún gate.

**Siguiente evidencia material:** auditoría de campos de contexto y dependencias que el informe pinneado sí permite verificar, seguida de examen del resto del catálogo mediante la comparación estricta del runner. No inferir éxito de restauración ni ejecutar un nuevo ensayo nativo sin aprobación separada.