# Issue #49 — Ejecutor nativo T0/T1 PostgreSQL 17.11: implementación para auditoría

**Estado:** código preparado y NO ejecutado. PR #50 permanece en borrador. El consentimiento para escribir recursos locales **no está concedido** por esta publicación.

## Archivos de implementación

- `scripts/issue49-pr39-native-runner-core.mjs`: orquestación con preflight del manifiesto y migración fijados, cotejo estructural del plan, consentimiento separado limitado a sesión/imagen/cuatro recursos sintéticos, controlador inyectable, hashes de catálogo, informe cerrado y limpieza en `finally`.
- `scripts/issue49-pr39-native-docker-driver.mjs`: fábrica de transporte Docker con ruta absoluta conocida del cliente; sin punto de entrada automático. Acepta un transporte sustituible para pruebas *mock*, y solo utiliza el transporte nativo predeterminado cuando una llamada externa solicita y proporciona explícitamente la instancia. No contiene invocación al importar el módulo.
- `scripts/test-issue49-pr39-native-runner-core.mjs`: prueba de orquestación con driver íntegramente falso y **24 casos negativos**; ningún acceso a Docker.
- `scripts/test-issue49-pr39-native-docker-driver.mjs`: prueba end-to-end de la interfaz por transporte CLI interceptado en memoria y **9 casos negativos**; no se crea proceso ni contenedor.

## Alcance preciso del ensayo futuro

Una sola sesión aleatoria de 24 caracteres hexadecimales; cuatro contenedores creados para roles `T0_SOURCE`, `T0_RESTORED`, `T1_SOURCE`, `T1_RESTORED`. Imagen local con ID inmutable `sha256:` fijado y aprobado de modo independiente; PostgreSQL **17.11** y arquitectura `linux/amd64` comprobados contra metadatos locales. La comprobación del ID **no certifica la autoría ni firma criptográfica del fabricante**: requiere procedencia revisada antes del permiso de ensayo.

El driver debe confirmar el contexto exacto y el daemon Linux mediante socket local aprobado, sin endpoints TCP/SSH, variables de configuración alternativas ni descargas. Obtiene inventario inicial de volúmenes; solo acepta montajes anónimos del ensayo, no preexistentes ni compartidos. Crea contenedores sin red, puertos publicados, privilegios ni bind mounts; nombres y etiquetas exclusivos. La imagen de PG17 define `VOLUME /var/lib/postgresql/data` y puede generar volúmenes anónimos, por lo que su rastreo no puede omitirse.

El ensayo solo prepararía dos microtablas con `slug` y el `CHECK` predeterminado, verificaría su SHA exacto antes del SQL, ejecutaría `pg_dump -Fc` a memoria (máximo 8 MiB) y `pg_restore` en contenedor destino, con códigos de salida comprobados. Compararía hashes derivados de `conbin`, definición canónica y metadatos, sin imprimir el contenido del catálogo ni exportar filas. El hallazgo `T1_MICROSCHEMA_CANDIDATE_ONLY` nunca autoriza cambio SQL real.

## Seguridad y límites del código preparado

1. El preflight y contrato offline no son permiso de ejecución. No hay programa CLI del ensayo; invocar el módulo requiere desde otro código un consentimiento de alcance cerrado y un controlador inyectado. El objeto de consentimiento por sí solo **no es un comprobante firmado ni prueba criptográfica de autorización humana**: la ejecución debe esperar una nueva aprobación explícita del operador.
2. El driver conserva IDs creados y sus nombres, etiquetas, imagen y volúmenes observados. Rechaza acciones sobre contenedores no creados e inspeccionados por la instancia. La limpieza no inspecciona ni elimina globalmente recursos del host.
3. La retirada emplea ID completo, verificación previa del propietario y volúmenes exactos, y confirma eliminación mediante **inventarios que deben completarse correctamente**. Una respuesta de error de `docker inspect` jamás se interpreta como prueba suficiente de eliminación.
4. Si se pierde el ID al crear, no se intenta borrar un contenedor de identidad desconocida. Se devuelve `UNKNOWN_CREATED_IDENTITY` para intervención humana. Si hay inspección dudosa, volumen extraño, fallo de limpieza o cambio de daemon, el resultado es `INCONCLUSIVE/RESOURCE_REMAINS`, sin autorizar migración.
5. El daemon local identificado por Docker es una observación de CLI, **no una atestación criptográfica de un host físico**. El transporte y la imagen requieren validación adicional en la computadora del operador antes de confiar en un resultado nativo.
6. En todos los resultados: `decision=BLOCKED`, `semanticEquivalence=NOT_VERIFIED`, `allowCatalogPass=false`, `NO_GO_HOSTED_MIGRATION`. Solo un futuro estudio posterior del catálogo integral y Auth/RLS podría reconsiderar esta restricción, con aprobación separada.

## Puerta de auditoría antes de autorizar Docker/SQL

- Ejecutar `node --check` en los cuatro archivos de implementación y pruebas y las **dos baterías mock** desde la raíz del checkout, sin argumentos adicionales ni conexión al daemon.
- Ejecutar también las **169 negativas offline anteriormente validadas** solo si cambian sus dependencias; no cambiar el SQL fijado.
- Obtener revisión independiente Codex en el SHA exacto y resolver todos los hallazgos P1/P2.
- Verificar en Windows la ruta del binario Docker, el contexto local, el ID de imagen y su procedencia aprobada **de forma solo lectura**, con autorización específica para esas comprobaciones cuando corresponda.
- Solicitar **otra autorización específica** antes de cualquier invocación del runner con Docker real. Nunca interpretar la preparación, el PASS mock o el review como autorización tácita.

**Aún pendientes:** QA Node/Windows de estas dos baterías nuevas, revisión Codex del código nuevo y evaluación de la ejecución real. No se ha ejecutado Docker, PostgreSQL, SQL, limpieza, staging, despliegue o merge durante este incremento.

## Endurecimiento anterior a la primera revisión independiente

La inspección del transporte se endureció posteriormente para requerir: una identidad de daemon Linux observada antes de crear; un ID de imagen previamente inspeccionado; contexto local y binario Docker de ruta cerrada; inventario inicial de volúmenes; una sola identidad de volumen anónimo de datos PG17 por contenedor; asociación privada de cada ID creado a su nombre, rol, etiqueta, imagen y volumen; comprobación de esos vínculos antes de iniciar, usar SQL, volcar, restaurar, inspeccionar o eliminar; repetición de la comprobación de identidad del daemon antes de las operaciones; y comprobación positiva de los inventarios tras la eliminación, sin interpretar errores de inspección como éxito.

Los negativos del núcleo abarcan, entre otros: consentimiento ausente/manipulado, daemon incorrecto, digest y build PG alterados, identidades malformadas, buffer de archivo excesivo, fallo de catálogos, eliminación no confirmada, red distinta de `none`, volumen preexistente o faltante y huecos en identidades. Los del transporte simulado abarcan imagen/versión incorrecta, etiqueta extraña, volumen persistente, contexto remoto, red inesperada y montaje preexistente o faltante. **Previstos: 24 negativos del núcleo y 9 del transporte = 33**, sin procesos Docker durante las pruebas.

### Verificación obtenida antes del QA de operador

- Cuatro archivos nuevos revisados por sintaxis mediante parser V8 aislado: **PASS**. Esta comprobación no reemplaza `node --check` ni el suite Node real.
- No se ha probado este transporte con Docker de verdad.
- No hay todavía validación del digest confiable de imagen en el equipo Windows del operador, ni comprobación de firma/autoría OCI.
- El consentimiento representado como objeto estructural es una **barrera lógica**, no un mecanismo criptográfico de aprobación. Nunca conectar el transporte real ni realizar operaciones locales sin instrucción posterior explícita del operador.
- **NO** integrar PR #50, habilitar endpoints, ejecutar migraciones alojadas ni convertir el resultado de microesquema en equivalencia integral.

### Estado de auditoría

`PENDING_OPERATOR_NODE_QA` y `PENDING_INDEPENDENT_CODE_REVIEW`. Un PASS de mock no concede permiso de ejecución local. Si surge una divergencia o riesgo P1/P2, corregirlo en la rama y repetir ambas validaciones antes de solicitar consentimiento del ensayo.


## QA del operador en Windows: 33/33 simuladas PASS (2026-11-05)

El operador ejecutó PowerShell desde `C:\\Users\\joslu\\source\\RaxiHQ-Oficina` con `FETCH_HEAD` comprobado contra el commit exacto `6729900d68f23986a8edaf8f57e2b77d47a1029a`, extrajo ocho módulos al directorio temporal y verificó la sintaxis de todos con `node --check` (sin errores). `test-issue49-pr39-native-runner-core.mjs` reportó `PASS ISSUE49 NATIVE CORE: four mocked roles, archive, strict catalog, exact-ID and volume cleanup` y `PASS ISSUE49 NATIVE CORE NEGATIVES (24 mocked adversarial cases; no Docker/SQL/network)`. `test-issue49-pr39-native-docker-driver.mjs` reportó `PASS ISSUE49 DOCKER TRANSPORT MOCK: 4 isolated local containers, PG17.11 pin, dump/restore and verified cleanup` y `PASS ISSUE49 DOCKER TRANSPORT NEGATIVES (9 mocked failure cases; no Docker/subprocess/SQL)`. Salida final: `PASS: 33 PRUEBAS NATIVAS SIMULADAS`. **QA Node real en Windows de las dos suites mock: PASS (33/33).** No se ejecutó Docker, no se inició PostgreSQL, no se ejecutó SQL, ni se crearon o limpiaron contenedores reales. Las afirmaciones de aislamiento, autenticidad de imagen y limpieza se refieren a fixtures controlados, no a recursos físicos.

Al consultar GitHub después de este QA, Codex figura `running` sobre el SHA exacto `6729900d68f23986a8edaf8f57e2b77d47a1029a` y todavía no tiene dictamen de ese incremento. **Pendiente** revisión independiente, corrección de P1/P2 si aparecieran y confirmación de procedencia de imagen antes de solicitar autorización para el ensayo real. El PR #50 sigue draft; `NO_GO_HOSTED_MIGRATION` inalterado.

## Auditoría Codex completada sobre la primera versión nativa: cinco P2 (2026-11-05)

Codex finalizó la revisión del código `6729900d68f23986a8edaf8f57e2b77d47a1029a` con `completed`, `has_any_findings=true` y `has_unresolved_findings=true`. Los 33 negativos mock ejecutados y aprobados por el operador en Windows corresponden **solo a ese código**, no al corregido.

Hallazgos y correctivos preparados para nueva auditoría:

1. **Versión PG17.11 con sufijo de build.** El transporte pide `server_version_num` y exige `170011`; conserva `server_version` completo para la huella de build y admite el sufijo Debian. Se comprueban cinco valores de build completos.
2. **Falso ready durante bootstrap.** El `pg_isready` del transporte usa `-h 127.0.0.1 -p 5432` dentro del contenedor para no aceptar el servidor temporal que escucha únicamente en socket Unix. El mock comprueba el argumento TCP y reproduce una primera respuesta no lista.
3. **Manifiesto no vinculado.** `prepareNativeTrial` reconstruye con `makeT0T1Plan` a partir del manifiesto actual, exige equivalencia estructural exacta con el plan y adjunta `manifestSha256`. `runNativeTrialWithDriver` repite la validación antes de llamar al driver. Se agregaron negativas para cambio de versión de manifiesto, autorización SQL e inventario.
4. **Catálogo incompleto.** El transporte exige trece campos obligatorios con tipos, valores y huellas comprobables antes de aplicar SHA-256. Se agregó una negativa con `conbin` ausente. El `CHECK` sintético ordinario exige `connoinherit=false`.
5. **Código de fallo inyectado.** El wrapper del transporte valida la forma `{code,bytes}`, limita tamaño y exige `code=0` excepto la lectura explícita de disponibilidad que admite no-cero. Nuevas negativas incluyen inventarios no disponibles, fallo de restauración y fallo de consulta al daemon.

**Nuevas cantidades previstas:** 27 negativas del núcleo más 13 del transporte simulado, total **40**; las cuatro fuentes pasan un parser sintáctico V8 aislado. **No hay todavía PASS del suite Node real sobre Windows en este nuevo HEAD**. Las cinco conversaciones P2 de esta revisión permanecen abiertas hasta QA de operador y rereview. No se ha ejecutado Docker, SQL ni ensayo PostgreSQL real; PR #50 draft, `NO_GO_HOSTED_MIGRATION` vigente.


## QA Windows 40/40 y revisión Codex del ejecutor corregido — cierre del gate mock

El operador ejecutó desde Windows el conjunto nuevo sobre el commit exacto `7e2417da9f37f39d19071789c1ffc21f55124c4e`, después de comprobar el SHA de `FETCH_HEAD`, extraer ocho archivos a un directorio temporal y pasar `node --check` en todos. Salida verificada: `PASS ISSUE49 NATIVE CORE NEGATIVES (27 mocked adversarial cases; no Docker/SQL/network)`, `PASS ISSUE49 DOCKER TRANSPORT NEGATIVES (13 mocked failure cases; no Docker/subprocess/SQL)`, precedidas por los dos casos positivos de simulación, y `PASS: 40 NEGATIVAS NATIVAS SIMULADAS`. **QA Node Windows: 40/40 PASS para este SHA**. No se ejecutaron Docker, PostgreSQL, SQL ni operaciones de limpieza reales.

La revisión Codex del **mismo commit de código** `7e2417da9f37f39d19071789c1ffc21f55124c4e` terminó como `completed`, `has_any_findings=false`, `has_unresolved_findings=false`, con recepción `Didn't find any major issues`. Se marcaron resueltos en GitHub los cinco hilos P2 relativos a build version, bootstrap readiness, manifest rebinding, catálogo completo y códigos del transporte: `PRRT_kwDOVIWc5s60S9vB`, `PRRT_kwDOVIWc5s60S9vE`, `PRRT_kwDOVIWc5s60S9vJ`, `PRRT_kwDOVIWc5s60S9vN`, `PRRT_kwDOVIWc5s60S9vS`. Esta actualización es **solo documental** y no modifica el código ya probado.

**Gate MOCK concluido. No es autorización del ensayo nativo.** Siguen pendientes identidad/procedencia confiable de imagen PostgreSQL 17.11 local, confirmación de la ruta/identidad del Docker Desktop local, evaluación final de ejecución con consentimiento explícito independiente, y luego el ensayo controlado de cuatro contenedores sintéticos (que no se ha ejecutado). PR #50 sigue draft y sin merge; `decision=BLOCKED`, `semanticEquivalence=NOT_VERIFIED`, `allowCatalogPass=false`, `NO_GO_HOSTED_MIGRATION` permanecen. Nunca extrapolar este PASS a equivalencia de catálogos reales.

## Preflight read-only real del operador: imagen y Docker Desktop (2026-11-05)

**Procedencia de la evidencia:** salida PowerShell del operador; el asistente no ha ejecutado Docker. Sin variables de entorno `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `DOCKER_TLS`, `DOCKER_TLS_VERIFY` ni `DOCKER_CERT_PATH`. Ejecución y configuración existentes sin cambios.

- Instalación Docker Desktop **por usuario**, confirmada en registro Windows como Docker Desktop 4.88.1; ejecutable real `%LOCALAPPDATA%\\Programs\\DockerDesktop\\resources\\bin\\docker.exe` (no existe el ejecutable en la ruta antigua `C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe`).
- `Get-AuthenticodeSignature` del ejecutable: **Valid**, firmante **Docker Inc**; SHA-256 del binario `0F97BC1111F59D859766BA938691EE07ED4E58D5FDAEB6F4DFB10A5EF5394753`. La firma del ejecutable corresponde a la observación del operador, no a una verificación del autor del contenedor.
- Contexto `desktop-linux` presente, host `npipe:////./pipe/dockerDesktopLinuxEngine`, `SkipTLSVerify=false`. Daemon identificado como Linux, ID `d6cd08c1-1d14-4a75-8cde-12c7007a42d0`, Docker Engine **29.7.2**.
- Imagen ya descargada y solo inspeccionada: repositorio/etiqueta `postgres:17`, ID local exacto `sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe`; `Os=linux`, `Architecture=amd64`, `Config.Env` incluye `PG_VERSION=17.11-1.pgdg13+2`; `Created=2026-10-21T00:37:20.889923074Z`; `Config.Volumes` incluye `/var/lib/postgresql/data`.
- `RepoDigests` informó `postgres@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe`. Que coincida textualmente con el ID local **no demuestra independientemente la procedencia o una firma del editor**. Antes del ensayo real se requiere contrastar autor/manifest del registro o política de procedencia; `PG_VERSION` es metadato declarativo, no una ejecución `SELECT version()`.

**Corrección de portabilidad sin ejecución:** el transporte `scripts/issue49-pr39-native-docker-driver.mjs` ahora deriva **solamente** la ruta instalada por usuario desde `LOCALAPPDATA`, sin búsqueda de `PATH`, y comprueba que el SHA-256 del binario del transporte real coincida con el hash de la muestra firmada y comprobada arriba; el transporte fake no lee binarios ni llama al daemon. Se agregó una aserción de ruta en el mock. Esto **modifica el código con respecto al anterior Codex PASS del commit `7e2417d...`**: está pendiente volver a ejecutar QA Node Windows y pedir nueva revisión independiente sobre SHA exacto antes de usar el transporte con Docker real. No se autoriza ejecución por esta modificación.

**Seguimiento:** el ID de daemon y el hash del ejecutable fueron observados una vez; ambos deben revalidarse al comienzo del ensayo futuro. Continúa `NO_GO_HOSTED_MIGRATION` y PR #50 draft sin merge.

## Bloqueo preventivo del transporte Windows real por P2 TOCTOU (2026-11-05)

Tras ejecutar el operador **40/40 negativos mock PASS** para código `9f88f467029821509f6dee67c19acf7107e55208`, Codex terminó su rereview con `completed`, `has_any_findings=true`, `has_unresolved_findings=true`: hallazgo **P2** en `scripts/issue49-pr39-native-docker-driver.mjs` por sustitución del ejecutable (TOCTOU). La comprobación aislada de hash de `docker.exe` por usuario al construir la instancia no está vinculada a cada `spawn`; otro proceso o enlace podría cambiar el fichero/resolución de directorios, falseando operaciones/atestaciones/limpieza. Recalcular hash justo antes de lanzar no elimina la carrera. **No debemos afirmar que la firma de Docker Inc y el hash observado atestan la identidad de cada proceso lanzado.**

**Corrección fail-closed conservadora:** la fábrica `createIssue49LocalDockerDriver` rechaza cualquier `transport===command` (transporte nativo real) en Windows con `ISSUE49 DOCKER DRIVER STOP: WINDOWS_NATIVE_TRANSPORT_BLOCKED_UNTIL_EXECUTABLE_BINDING_ATTESTED`, **antes de instanciar o invocar Docker**. Solo conserva transportes falsos inyectados para batería mock; un nuevo caso de regresión debe confirmar el bloqueo. Se retiró la pretensión de pin de hash una única vez. Por tanto, el ejecutor **NO ESTÁ LISTO para un ensayo nativo local Windows** pese al PASS mock y a la validación de metadatos PG_VERSION=17.11.

La siguiente solución para permitir uso real requiere un diseño **separado**, revisado y verificable que vincule el binario protegido al proceso realmente lanzado, con política de rutas y ACL/junctions contra sustitución; no basta con revisar `docker.exe` al principio de la sesión. No se instalará/moverá el cliente ni cambiarán permisos del equipo sin autorización explícita.

**QA de nuevo cambio bloqueante** y **rereview Codex del SHA actualizado pendientes**; el hallazgo P2 actual permanece abierto hasta validarlos. PR #50 draft, `NO_GO_HOSTED_MIGRATION`; sin ejecución Docker/SQL ni permisos para el ensayo real.