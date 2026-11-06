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
## QA Windows del bloqueo TOCTOU y rereview Codex — 2026-11-05

El operador verificó `FETCH_HEAD` exactamente en `d5f4417286c07c3192a77ed95a7896e44d2a19c2`, ejecutó `node --check` sobre ocho archivos y las dos baterías mock. Salidas: `PASS ISSUE49 NATIVE CORE NEGATIVES (27 mocked adversarial cases; no Docker/SQL/network)`, `PASS ISSUE49 DOCKER TRANSPORT NEGATIVES (13 mocked failure cases; no Docker/subprocess/SQL)` y `PASS ISSUE49 WINDOWS REAL TRANSPORT GATE: BLOCKED before subprocess`. Resultado: **40/40 negativas simuladas PASS**, junto con el nuevo rechazo temprano del transporte real de Windows. **No se ejecutó Docker real, SQL ni PostgreSQL.**

Codex revisó ese mismo SHA `d5f4417286c07c3192a77ed95a7896e44d2a19c2` y concluyó `completed`, `has_any_findings=false`, `has_unresolved_findings=false`, con recibo `Didn't find any major issues`. Se cerró el hilo P2 TOCTOU de GitHub (`PRRT_kwDOVIWc5s60TrTx`) por mitigación **fail-closed**; **no** por haber solucionado aún el riesgo para el transporte real. El código de ejecución real de Docker Desktop Windows permanece bloqueado por diseño.

**Decisión vigente:** gate offline/fail-closed completado, no habilitar ensayo nativo Windows, no merge, no SQL, no staging, no hosted migration. Investigar diseño nuevo de lanzador con asociación segura entre binario comprobado y proceso ejecutado, con QA/adversarial y revisión independiente, antes de pedir autorización específica para cuatro contenedores sintéticos.


## Propuesta de diseño — transporte Docker Engine API sobre named pipe (2026-11-05)

**Estado: PROPUESTA DE ARQUITECTURA, NO IMPLEMENTADA NI APROBADA PARA EJECUCIÓN.** El transporte nativo Windows vigente mantiene un bloqueo incondicional antes de iniciar procesos. El código probado para 40 negativos permanece sin modificaciones. No ejecutar Docker/SQL, no abrir sockets durante diseño, no ejecutar contenedores ni hacer cambios de permisos, no publicar puertos, no alterar el daemon. Codex ya aprobó el bloqueo preventivo del commit \`d5f4417286c07c3192a77ed95a7896e44d2a19c2\`; **NO ha aprobado este diseño como implementación**.

### Decisión recomendada (no aprobada)

**Sustituir el transporte CLI por un adaptador de Docker Engine API de Node.js con conexión HTTP sobre el named pipe local conocido**, sin invocar \`docker.exe\` mediante \`spawn\`, sin instalar binarios ni abrir daemon TCP. Docker documenta que su Engine API REST puede usarse directamente desde bibliotecas HTTP, y que el acceso al socket equivale a una capacidad de administración de alto privilegio:
- https://docs.docker.com/reference/api/engine/
- https://docs.docker.com/engine/security/
- https://docs.docker.com/engine/security/protect-access/
- https://docs.docker.com/reference/api/engine/version-history/

El socket aprobado como observación de operador es \`npipe:////./pipe/dockerDesktopLinuxEngine\`. Para un cliente Node \`http.request({socketPath})\` habría que usar la forma de ruta nativa Windows **literal y fija** \`\\\\.\\pipe\\dockerDesktopLinuxEngine\` tras revisar compatibilidad y sin extrapolar que el mapeo funciona hasta las pruebas de solo lectura. No aceptar ruta del usuario, \`DOCKER_HOST\`, \`DOCKER_CONTEXT\`, \`DOCKER_CONFIG\`, \`HTTP_PROXY\`, URL TCP/SSH, ni fallback de socket alterno. NO exponer el socket en web/UI ni introducir un proxy con permisos globales. El hecho de que el pipe exista y que Docker CLI lo use NO acredita automáticamente la conexión HTTP de nuestro cliente.

### Frontera de seguridad

\`\`\`text
Plan/Manifest/source pinned + consentimiento humano independiente
                      |
             runNativeTrialWithDriver
                      |
          Driver Issue49 local limitado
                      |
        Cliente Node HTTP named pipe LOCAL
         (request por operación autorizada)
                      |
           Docker Desktop Linux Engine
                      |
        SOLO 4 contenedores sintéticos
         NO_GO_HOSTED_MIGRATION siempre
\`\`\`

- **Plano de control:** \`runNativeTrialWithDriver\` valida manifiesto actual, SHA del plan, imagen inmóvil, consentimientos estrictos y cuatro roles. El adaptador valida nuevamente contexto, tipo de daemon, ID de daemon, versión API y esquema cerrado de cada petición.
- **Capacidad mínima en software, NO en permisos del daemon:** un dispatcher cerrado de métodos, paths y JSON, sin endpoints arbitrarios; acceso a socket no equivale a autorización limitada del sistema operativo. El proceso tendría técnicamente capacidad alta sobre Docker; por ello debe ejecutarse solo en contexto local de operador de confianza y con superficie de código mínima, sin aceptar entradas de web, plugins, MCP o agentes.
- **Sesión:** una sesión fija/aleatoria de 24 caracteres hexadecimales, nombres exactos \`raxi-t0t1-<session>-<role>\`, labels obligatorios; image ID explícito ya comprobado \`sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe\`. El propio image ID solo prueba coincidencia con la imagen local; su editor/procedencia del registry aún requiere evidencia independiente.
- **Política Docker:** \`NetworkMode:none\`; sin \`Binds\`, \`Mounts\` arbitrarios, \`PortBindings\`, \`Privileged\`, \`Devices\`, \`CapAdd\`, \`HostPID/HostNetwork\`, policy de reinicio, imagen pull ni conexiones externas. Volumen PGDATA anónimo esperado, sin reutilización. Cada recurso inspeccionado *antes de usarlo* y *antes de borrarlo* por ID completo, nombre, label, imagen, red, privilegios, puertos y volúmenes.
- **Endpoints a investigar contra el OpenAPI exacto del daemon:** consultas \`GET /_ping\`, \`GET /version\`, \`GET /info\`, inventario \`GET /volumes\`, \`GET /containers/json?all=true\`, \`GET /images/{id}/json\`, \`GET /containers/{id}/json\`; operación \`POST /containers/create\`, \`POST /containers/{id}/start\`, \`POST /containers/{id}/exec\`, \`POST /exec/{id}/start\`, \`GET /exec/{id}/json\`, eliminación \`DELETE /containers/{id}?force=1&v=1\`. **Son nombres de rutas por validar, no permiso para invocarlas.**
- **SQL/archivo:** SQL sintético T0/T1 con SHA exacto; no acceso a esquemas de producción. \`pg_dump\`/ \`pg_restore\` requieren manejo correcto de streaming binario; Docker exec puede usar multiplexación de stdout/stderr y *HTTP connection upgrade/hijack*, no deben interpretarse bytes mezclados como archivo válido. La implementación necesita parser protocolario documentado o alternativa segura y comprobable. Exigir \`ExitCode=0\` por inspección de exec además del estado HTTP; límites de 8 MiB/25s (u otros límites justificados y ensayados), corte ante truncación, timeout o desconexión.
- **Idempotencia/limpieza:** registrar cada ID inmediatamente tras respuesta de creación; investigar fallo parcial antes de recibir respuesta y riesgo de contenedor huérfano. Nunca hacer \`prune\`, borrado por coincidencia de nombre sin identidad, ni borrado de IDs preexistentes. Eliminación en orden inverso, confirmar ausencia de contenedor y cada volumen propio en inventario exhaustivo, fallar cerrado ante errores del inventario, daemon cambiado o evidencia ausente; no declarar cleanup PASS cuando no se conoce el estado.
- **Resultado:** \`T1_MICROSCHEMA_CANDIDATE_ONLY\` es evidencia exploratoria, nunca prueba de equivalencia semántica para migración. \`decision=BLOCKED\`, \`semanticEquivalence=NOT_VERIFIED\`, \`allowCatalogPass=false\`, \`hostedMigration=NO_GO_HOSTED_MIGRATION\` invariantes.

### Alternativas comparadas

1. **Node HTTP sobre named pipe (recomendación):** evita por completo el TOCTOU de \`docker.exe\` por no ejecutar el CLI. Requiere implementar y auditar a fondo protocolo Engine API, exec hijack, validación de capacidades y gestión de recursos.
2. **Lanzador nativo Windows con handle vinculado, ACL y firma:** puede asegurar mejor la identidad de proceso pero añade binario de terceros/propio, firma, instalación/actualización, permisos y mantenimiento; en este caso es desproporcionado.
3. **Seguir con CLI por usuario con hash previo a spawn:** **rechazado** por no resolver TOCTOU. Copiar o cambiar permisos del CLI tampoco es una solución automática/segura sin evaluación separada.

### Entregables y gates futuros

- **Gate D0 (actual):** diseño documental. NO mutaciones de infraestructura.
- **Gate D1:** especificación exacta \`DockerPipeTransport\`, validación oficial del API/versionado/sockPath, request allowlist, límites, streaming, audit journal y limpieza con eventos de respuesta incierta. Revisión de amenazas P1/P2.
- **Gate D2:** implementación *solo mock/in-memory* y pruebas negativas: endpoint inesperado, redirecciones/override, HTTP no-2xx, estado de exec no cero, multiplexación malformada, truncación, 8 MiB, timeout, restart de daemon, errores de eliminación, propiedad ajena, pull encubierto, response perdido tras create, post-compromiso y reutilización de volúmenes. Ningún tráfico real.
- **Gate D3:** revisión independiente Codex + QA Node real Windows + pruebas de sintaxis, build y comparador previo. Mantener bloqueo del transporte real.
- **Gate D4:** *solo con consentimiento posterior separado*, atestación **read-only del nuevo cliente** sobre pipe y contraste exacto de \`/_ping\`, \`/version\`, \`/info\`, imagen, daemon, ausencia de endpoints remotos. No create/start/exec todavía.
- **Gate D5:** verificar procedencia o política explícita sobre imagen; decisión humana independiente para cualquier prueba sintética real (4 contenedores), su retención/eliminación y evidencia; mantener bloqueo de Supabase/hosted SQL/migración.


## D1/D2: especificación y módulo exclusivamente simulado (2026-11-05)

Autorización de diseño e implementación **D1 + D2 en modo fake** del operador, no de ejecución real. Documento detallado `docs/issue49-d1-d2-docker-pipe-transport.md`; módulo puro `scripts/issue49-d2-engine-api-mock.mjs`; pruebas Node preparadas `scripts/test-issue49-d2-engine-api-mock.mjs`. Se revisaron las referencias oficiales Docker Engine API v1.51, multiplexing stdout/stderr de 8 bytes, esquema de `/containers/.../exec`, `GET /exec/.../json` para `ExitCode`, seguridad del daemon y Node IPC sobre Windows named pipes. La versión de API 1.51 se usa únicamente en descriptores simulados; su compatibilidad real está pendiente de negociación y aprobación en D4.

El módulo D2 **no importa `http`, `net`, `child_process`, Docker SDK ni SQL**, no abre socket, no tiene transporte de red ni se integra con `runNativeTrialWithDriver`. Solo construye descriptores de rutas/operaciones cerradas, cuerpos sintéticos congelados profundamente y decodifica tramas binarias fake con límites. La interfaz de intercambio fake es un hook de pruebas inyectado (el operador de confianza debe no pasar una función con efectos). La implementación no completa todavía el protocolo real de `exec`, el streaming bidireccional de stdin, la recuperación de identidad tras fallos inciertos de `create`, ni la validación criptográfica de imagen, por lo que **no está lista para pruebas nativas**.

D2 preparado: aproximadamente 24 negativas de request contract, multiplexing y estado de respuestas, más aserciones positivas; **batería Node Windows todavía NO ejecutada**. Se hicieron validaciones sintácticas V8 y ocho comprobaciones JS aisladas que no sustituyen Node. El driver Windows CLI real permanece bloqueado por `WINDOWS_NATIVE_TRANSPORT_BLOCKED_UNTIL_EXECUTABLE_BINDING_ATTESTED`. PR #50 draft, no merge, sin Docker/SQL/Supabase, `NO_GO_HOSTED_MIGRATION`.


## D2: QA Windows 24/24 y dos P2 de Codex (2026-11-05)

El operador validó `FETCH_HEAD` exacto `2b88418b07e91c9eac33a3c1a590b076bde065e0` en Windows y pasó `node --check` en los dos archivos D2. La batería fake reportó `PASS ISSUE49 D2 MOCK: restricted request descriptors and binary stream`, `PASS ISSUE49 D2 MOCK NEGATIVES (24 adversarial cases; no Docker/socket/SQL)` y `PASS: D2 - 24 NEGATIVAS SIMULADAS`. Por tanto, **24/24 negativas PASS solo para ese SHA**, sin ninguna llamada Docker/pipe/SQL.

Codex terminó revisión del mismo SHA con `has_any_findings=true`, `has_unresolved_findings=true` y abrió **dos P2**: (a) la respuesta podía validarse usando un `input.operation` modificado durante el `await exchange`, en lugar de usar la operación de la solicitud original; (b) `listVolumes` aceptaba `Warnings` no vacías que implican inventario posiblemente incompleto. Correctivos publicados en `scripts/issue49-d2-engine-api-mock.mjs`: se captura `selected=input?.operation` antes de construir y esperar la solicitud, y se exige que `Warnings` sea `null` o array vacío. En `scripts/test-issue49-d2-engine-api-mock.mjs` se añadieron dos pruebas negativas específicas para manipulación asíncrona de la operación y advertencias de inventario, para **26 negativas esperadas**. Parser V8 aislado PASS para los dos archivos corregidos y dos reproducciones aisladas PASS; **QA Node Windows del nuevo SHA pendiente** y nueva revisión independiente pendiente. No cerrar los hilos P2 hasta QA y Codex limpios.

Los componentes D2 siguen siendo solo fake; real Windows CLI driver permanece bloqueado, no hay cliente HTTP/socket nativo, no hubo contenedores, SQL, red, modificación de daemon, staging ni merge. `NO_GO_HOSTED_MIGRATION` permanece.


## D2 corregido — QA de operador y error de revisión Codex (2026-11-05)

El operador ejecutó PowerShell en Windows, verificó `FETCH_HEAD` contra el commit exacto `474b447d19e83336253209df429321aa542fdddf`, hizo `node --check` de los dos scripts D2 y ejecutó la batería mock. Salidas `PASS ISSUE49 D2 MOCK: restricted request descriptors and binary stream`, `PASS ISSUE49 D2 MOCK NEGATIVES (26 adversarial cases; no Docker/socket/SQL)` y `PASS: D2 - 26 NEGATIVAS SIMULADAS`. Por tanto **QA Windows 26/26 negativas PASS** para el código corregido; no hubo tráfico Docker, socket, SQL ni contenedores.

La rerevisión independiente de Codex sobre el mismo SHA **falló operacionalmente** con `status=failed`, respuesta `Unknown error`, sin dictamen útil. No equivale a `has_any_findings=false`; los dos hilos P2 quedan abiertos hasta revisión completa. Solicitado reintento de `@codex review` en comentario GitHub `6673227126`. **No cerrar D2/D3 ni integrar PR** con esta revisión fallida; la autorización sigue limitada a D1/D2 fake-only y la ejecución real Windows permanece bloqueada. Se mantiene `NO_GO_HOSTED_MIGRATION`.

## D2: revisión Codex completada con dos P2 nuevos de inventarios — correctivos preparados (2026-11-05)

La segunda revisión de Codex sobre el código D2 `474b447d19e83336253209df429321aa542fdddf` finalmente terminó con `completed`, `has_any_findings=true`, `has_unresolved_findings=true`. Nuevos P2 de evidencia falsa en modo simulado: (1) `listVolumes` aceptaba elementos sin `Name` identificable (incluidos `null` y valores incorrectos) y (2) `listContainers` aceptaba arreglos dispersos porque `.every` ignora posiciones vacías y JSON los convierte a `null`. Los P2 previos relativos a la selección de operación asíncrona y `Warnings` fueron corregidos previamente y la batería Windows 26/26 ya pasó para aquel SHA, pero no se cierran hilos sin rereview.

Nuevos correctivos del módulo puro D2: helper `dense` que rechaza huecos y propiedades añadidas, exige cada objeto de contenedor con `Id` de 64 caracteres hexadecimales y sin duplicados; exige cada objeto de volumen con `Name` string no vacío sin espacios extremos y sin duplicados; conserva rechazo a advertencias no vacías. Las pruebas añaden 13 negativas de inventarios, incluidos `new Array(1)` y `delete arr[index]`, más casos positivos de inventarios válidos. **39 negativas previstas**, QA Node Windows todavía NO ejecutada para nuevo código. Parser sintáctico V8 aislado PASS en módulo y prueba; ocho reproducciones puntuales V8 PASS. La aprobación de D2 sigue pendiente de 39/39 Windows y revisión Codex sobre el código exacto. No se ha habilitado ni conectado Docker Engine API real; PR #50 draft, `NO_GO_HOSTED_MIGRATION`.


## D2: QA Windows 39/39; Codex detectó P2 de serialización `toJSON` (2026-11-05)

El operador verificó `FETCH_HEAD` exacto `206439cb82fd76869a28471cb486c5748ab454bc`, ejecutó `node --check` de ambos scripts D2 y pasó la batería `PASS ISSUE49 D2 MOCK NEGATIVES (39 adversarial cases; no Docker/socket/SQL)` junto a las pruebas positivas de contratos y respuestas binarias: **39/39 negativas simuladas PASS solo para dicho código**. La revisión Codex de ese mismo SHA terminó `completed`, pero con **otro P2**: entradas fake con `toJSON()` pueden alterar/invalidar la identidad durante el `copy(JSON.stringify/parse)` después de validar contenedores o volúmenes, produciendo falso PASS. Son **cinco hilos P2** abiertos en total hasta QA/revisión satisfactoria.

Correctivo preparado: para `listContainers` y `listVolumes`, validar inventario recibido, copiar a representación JSON, **volver a validar el resultado serializado** y exigir que los ID/Name de la copia sean exactamente los originales. Batería adicional: cuatro negativas `toJSON()` que devuelven `null`, identidad inválida o identidad distinta pero estructuralmente válida. **43 negativas esperadas**, todavía sin QA Windows nuevo sobre el código corregido. Sintaxis V8 aislada PASS y cuatro reproducciones negativas + dos positivas aisladas PASS; no confundir con ejecución Node Windows ni aprobación Codex. PR #50 sigue draft, ningún socket Docker/SQL/contendor real activado, Windows transporte nativo bloqueado, `NO_GO_HOSTED_MIGRATION`.


## D2: QA Windows 43/43 confirmado; rereview Codex pendiente (2026-11-05)

El operador ejecutó PowerShell y comprobó el SHA exacto `3b509cc41f3b1b29832f0acdb3403147e9d50770` desde `FETCH_HEAD`, extrajo los dos archivos D2 a un directorio temporal, ejecutó `node --check` de ambos y la batería fake con resultado `PASS ISSUE49 D2 MOCK NEGATIVES (43 adversarial cases; no Docker/socket/SQL)` y `PASS: D2 - 43 NEGATIVAS SIMULADAS`. El test positivo de descriptores cerrados y lectura de tramas binarias también informó PASS. Esto prueba **43/43 negativos mock Node Windows para ese código**, no ejecución Docker real ni seguridad de un transporte real.

Al consultar GitHub después de este QA, la nueva revisión de Codex sobre el **mismo SHA** aparecía `status=running`, sin dictamen. Los **cinco P2** permanecen abiertos hasta revisión concluida sin bloqueantes. PR #50 draft, bloqueos de Windows real y `NO_GO_HOSTED_MIGRATION` intactos, sin merge ni cambios a Supabase, sin conexión al socket ni SQL.


## D2: continuidad offline y nuevos correctivos P2 (2026-11-05)

La revisión independiente Codex sobre el código D2 `3b509cc41f3b1b29832f0acdb3403147e9d50770` concluyó con dos P2 adicionales (siete hilos pendientes): (1) `toJSON()` modifica también el inventario original durante la serialización y una comparación posterior contra ese original alterado produce aceptación incorrecta; (2) getters/accesores maliciosos en parámetros de operación o ID devuelven distintos valores entre validación y construcción del descriptor, posibilitando endpoints distintos de los autorizados.

Correcciones preparadas en `scripts/issue49-d2-engine-api-mock.mjs`: comprobación de descriptores de propiedades ordinarias sin getters/setters en solicitudes; la operación queda leída del descriptor validado; en inventarios se rechazan accesores de identidades, se capturan valores primitivos `Id`/`Name` **antes** de `JSON.stringify` y se validan/coparan contra la versión serializada, no contra el objeto potencialmente mutado. En `scripts/test-issue49-d2-engine-api-mock.mjs` se añadieron cuatro negativos para getters y `toJSON` mutando el objeto original. **47 negativas previstas; QA Node Windows de nuevo código NO ejecutado.** Pruebas JS V8 aisladas de cuatro nuevos escenarios PASS y sintaxis V8 de módulo/test PASS, insuficiente para declarar QA Windows aprobado.

`D2` continúa **fake-only**, no contiene cliente real socket/HTTP/SQL; el transporte Windows CLI real continúa bloqueado. Solicitar rereview Codex del SHA exacto, mantener siete hilos P2 abiertos hasta dictamen limpio y QA Windows; no cerrar PR #50 ni ejecutar migración/contenerización. `NO_GO_HOSTED_MIGRATION` vigente.


## D2: QA Windows 47/47, nuevo P2 de truncamiento en serialización (2026-11-05)

El operador verificó el SHA exacto `0aefeb83f7255112c26aefe68ce531f7b0621930` y ejecutó `node --check` de ambos scripts D2 y la batería Node en Windows: `PASS ISSUE49 D2 MOCK NEGATIVES (47 adversarial cases; no Docker/socket/SQL)` y casos positivos PASS. Es evidencia de **47/47 negativas simuladas PASS**, no ejecución Docker ni prueba de transporte real.

Codex completó rereview del mismo SHA y detectó **octavo P2**: mediante `toJSON()` un inventario puede perder elementos sin cambiar los identificadores restantes y pasar una comparación de `snap.every(...)`. Correctivo: `snap.length===before.length` en `listContainers` y `snap.Volumes.length===before.length` en `listVolumes`, además de identidad exacta. Se añadieron dos negativas de truncamiento incluyendo `toJSON` heredado en array sin claves propias adicionales. Total **49 negativas previstas**, QA completo Node Windows del nuevo código pendiente. Dos reproducciones adversariales aisladas y sintaxis V8 del módulo/test PASS. Mantener los **ocho hilos P2** abiertos hasta QA Windows y revisión independiente sin hallazgos. Bloqueo de transporte real Windows intacto, D2 FAKE_ONLY, PR #50 draft, `NO_GO_HOSTED_MIGRATION`.


## D2: Windows QA 49/49 y nuevo P2 de getter en inventario (2026-11-06)

El operador verificó `FETCH_HEAD` exacto `ad81d338a7748437ad795e3b96f4ca9ed1529f3d`, pasó `node --check` de los dos scripts D2 y obtuvo `PASS ISSUE49 D2 MOCK NEGATIVES (49 adversarial cases; no Docker/socket/SQL)` y pruebas positivas de contratos/stream. **Windows Node 49/49 PASS** se limita al código SHA citado y nunca significa transporte real ni Docker/SQL ejecutado.

Codex completó revisión del SHA citado con un **noveno P2**: getter en `data.Volumes` devuelve distinto inventario entre validación y captura de identidad. Solución simulada preparada: rechazar descriptores de propiedades accesoras del objeto de inventario padre (también `Warnings`) y de arrays de volúmenes/contenedores antes de leer elementos; exigir que el objeto de volúmenes posea campos propios `Volumes`/`Warnings`. Cuatro negativas añadidas: getter `Volumes` mutable, getter `Warnings`, getter de índice en array de contenedores, getter de índice en array de volúmenes. **53 negativas previstas; QA Windows del nuevo SHA todavía NO ejecutada**. V8 parse y 4 reproducciones aisladas PASS; no equivalen a 53/53 Node Windows. **Nueve hilos P2** abiertos hasta revisión independiente sin hallazgos y pruebas Windows exitosas.

El módulo D2 continúa FAKE_ONLY sin cliente HTTP/named pipe/SQL. Windows real Docker CLI driver bloqueado, PR #50 draft no merge, `NO_GO_HOSTED_MIGRATION` vigente. 
