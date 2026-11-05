# PR #39 — Auditoría de integración y seguridad (2026-11-04)

**Estado:** DRAFT / NO MERGE / NO_GO_HOSTED_MIGRATION. Alcance: únicamente herramientas locales de diagnóstico y ensayo sintético. No implica ejecución Docker ni uso de Supabase.

## Cambios examinados

El PR original basado en `03e0455fca01a2a9b178a75ec846b9e05850af35` añadía 17 archivos (11 scripts, 6 docs), sin modificar archivos preexistentes de app/manifest/SQL. La auditoría encontró 25 commits posteriores de `main` hasta `e0bea6bb296f2f1aec0439648e9e60ddc186f3e8`, 79 archivos cambiados en `main` desde aquella base, sin superposición de rutas con el PR. El blob de `apps/raxi-hq/scripts/staging-manifest.mjs` coincide exactamente entre la base de PR y `main` (`080a81ef38d03778036e5e1568b4090cbecfe674`). GitHub reportaba `mergeable:true`, pero ninguna prueba de aplicación/CI en el árbol integrado: cero check runs y cero workflows para el HEAD auditado.

**El control de daemon de esta fase añade dos archivos:** `scripts/pr39-local-docker-guard.mjs` y `scripts/test-pr39-local-docker-guard.mjs` (19 rutas nuevas en total, antes de este informe). El módulo de guard se importa únicamente por el ejecutor opt-in.

## Hallazgo P2: selección del daemon Docker

El ejecutor comprobaba `--network none`, tmpfs, puertos y montajes del contenedor, pero Docker admite daemons remotos mediante `DOCKER_HOST`, `DOCKER_CONTEXT`, TCP/SSH y contextos. La verificación del contenedor no bastaba para garantizar un endpoint de cliente local.

**Mitigación implementada:** detectar y rechazar variables `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `DOCKER_TLS`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`; consultar el contexto efectivo y su endpoint sin contactar al daemon; admitir solo `default` y `desktop-linux` con endpoints locales cerrados; rechazar sockets arbitrarios, TCP/SSH, TLS, plataformas no revisadas o endpoints adicionales; aplicar `docker --host <endpoint-verificado>` a **todas** las operaciones reales y a `pg_isready`; comprobar Linux Engine antes de inspeccionar o crear imágenes/contenedores.

**Limitación residual importante:** un socket `npipe` o `unix` permitido podría ser atendido por un proxy configurado en el host. Esta política certifica un **endpoint local del cliente**, no proporciona atestación criptográfica de la máquina que ejecuta el daemon. Un ensayo remoto consciente exigiría otra política y autorización específica.

El default sin `--run-local` sigue siendo preflight offline (sin Docker). Pruebas adicionales en `node scripts/test-pr39-local-docker-guard.mjs` cubren positivos de socket y negativos de configuraciones, contextos, TCP/SSH, TLS, symlinks conceptuales de endpoints y el runner con variables Docker maliciosas aun sin Docker en PATH. **Pendiente:** ejecutar la nueva batería en Windows y revisar con Codex el SHA final.

## Seguridad del comparador y evidencia

`assertPr39CatalogEquality` **continúa rechazando diferencias** en el catálogo canónico, incluidas RLS, ACL y constraints. La captura local PostgreSQL 17.11 del usuario encontró 35 OID por cada lado y tres operandos idénticos, reagrupados como `AND(AND(L,U),R)` y `AND(L,U,R)`; el ensayo de restauración terminó con código no cero y limpió dos contenedores efímeros. El módulo pinneado solo produce `PINNED_3_OPERANDS_IDENTICAL_WITH_AND_REGROUPING` con `BLOCKED / NOT_VERIFIED`. El JSON privado original no está en GitHub. No se ha probado restauración real de Supabase Auth/Storage ni se autoriza hosted SQL.

Las pruebas offline previas del usuario (commit `5e5766a76f7ade59ff4eda4fa83aae800fe516fe`) comprobaron 342 escenarios negativos/adversariales PASS. Codex revisó ese SHA sin nuevos hallazgos. **Las nuevas pruebas del daemon no heredan automáticamente ese PASS**.

## Integración aislada con `main` actual: requisitos

1. Trabajar en un *worktree temporal* separado, con `main` y PR fijados por SHA y verificados tras fetch. Nunca ejecutar `git merge` sobre `main` ni tocar staging o servidores.
2. Hacer un merge de prueba **sin commit** en el worktree temporal, detectar conflictos y comprobar que solo entran las rutas PR #39 esperadas. No empujar ninguna rama.
3. Ejecutar offline las suites de PR39 (nuevo daemon guard, recuperación, conbin, OID, atestación, propuesta y preflight) con códigos de salida individuales; opcionalmente comprobar el JSON local pinneado por lectura.
4. Ejecutar tests generales, `typecheck`, `build` y security scan de `apps/raxi-hq` con dependencias fijadas **sin descargar**; si no están en cache, reportar **BLOCKED/NOT_EXECUTED**, no falsear PASS.
5. Comprobar `git diff --check` del árbol combinado y limpiar el worktree temporal por ruta exacta. No borrar la copia local original, otras ramas, archivos privados ni contenedores.

La comparación de rutas y ausencia de conflictos no reemplaza estas ejecuciones. Hasta disponer de resultados reproducibles, **INTEGRATION_QA_PENDING**. No hay CI configurado por PR HEAD observado y `main` no ha sido actualizado por esta auditoría.

## Conciliación de hilos Codex

Los siete P2 históricos pendientes correspondían a: `consttypmod`, coherencia de `(kind,OID)`, prohibición de `funcid=0`, alias de `Var`, vínculos cruzados de funciones/operadores/tipos, fixture de OID renumerado 4321 y nombres de operadores PG17 simbólicos. El código actual contiene los correctivos y los casos adversariales respectivos; el usuario ejecutó 72/72 negativos del resolvedor y la revisión Codex del commit anterior no encontró nuevas incidencias. **Resolver el hilo histórico no significa que el ensayo nativo sea PASS, ni que la nueva fase esté completa**. La reconciliación de cada hilo debe respaldarse en su código y test concreto.

## Puertas de cierre

- [ ] Batería del daemon guard PASS en Windows, sin ejecutar Docker.
- [ ] Integración completa contra el `main` fijado PASS o bloqueos documentados sin falsos positivos.
- [ ] Codex revisa el SHA **final** y se corrigen todos los hallazgos P1/P2.
- [ ] Hilos históricos conciliados con trazabilidad.
- [ ] Aprobación humana independiente para merge; ninguna para SQL alojado, restauración, proveedores, despliegues o B2.

**Política inalterada:** `decision:BLOCKED`, `nativeValidated:false`, `semanticEquivalence:NOT_VERIFIED`, `allowCatalogPass:false`, `NO_GO_HOSTED_MIGRATION`.

## Ejecutor reproducible del QA combinado

Se añadió `scripts/pr39-main-integration-qa.ps1`, exclusivo de PowerShell 5.1/Windows, para construir y probar de forma aislada el árbol combinado. **Este archivo también es parte de la revisión**: actualmente el PR contiene 21 archivos nuevos (11 scripts originales, 2 scripts de guard, 1 script de integración, 7 docs). El script se invoca desde un checkout limpio del PR con el SHA final aprobado:

```powershell
Set-Location "$HOME\source\RaxiHQ-PR39-CONBIN-20261104"
& .\scripts\pr39-main-integration-qa.ps1 -ExpectedPrSha "<SHA-exacto-de-PR39>"
```

El script fija `main=e0bea6bb296f2f1aec0439648e9e60ddc186f3e8`; obtiene y verifica ambos SHAs remotos, crea un worktree nuevo por GUID en `$HOME\source`, hace un merge **solo en ese worktree DETACHED** con `--no-commit --no-ff` y comprueba que se añaden exactamente 21 archivos sin modificar ningún archivo existente de `main`. Nunca se crea un commit, nunca se modifica una rama local, no se hace push. Ejecuta suites offline de PR39, después intenta `npm ci --offline --ignore-scripts --no-audit --no-fund` en la copia temporal y requiere tests, typecheck, build y security scan completos. Si el caché npm está incompleto o un comando falla, **no** declara PASS. `finally` elimina exclusivamente el worktree creado, aunque hubo un error. Requiere prueba en Windows; no se puede ejecutar desde el conector GitHub.

No se permite un bypass de dependencias no instaladas, ni descargar paquetes automáticamente, ni ejecutar Docker `--run-local` como parte de este QA. El valor `<SHA-exacto-de-PR39>` debe sustituirse solo por el SHA publicado y revisado en el momento de ejecución.

## Conciliación administrativa de siete P2

El usuario autorizó conciliar los siete hilos históricos, y el asistente verificó el código y los tests vinculados al HEAD `602efa5c6bed5a3eb8ff3fda566d736d04812016`. La relación exacta y evidencia de cada caso quedó registrada en el comentario GitHub PR #39 `6645641722`; los siete hilos se cerraron individualmente con `is_resolved:true`. Este cierre cubre **solo los defectos históricos**, no implica que el daemon guard ni la integración combinada sean PASS. La nueva revisión Codex del SHA posterior sigue pendiente.
