# Issue #49 — Ejecutor nativo T0/T1 PostgreSQL 17.11: implementación para auditoría

**Estado:** código preparado y NO ejecutado. PR #50 permanece en borrador. El consentimiento para escribir recursos locales **no está concedido** por esta publicación.

## Archivos de implementación

- `scripts/issue49-pr39-native-runner-core.mjs`: orquestación con preflight del manifiesto y migración fijados, cotejo estructural del plan, consentimiento separado limitado a sesión/imagen/cuatro recursos sintéticos, controlador inyectable, hashes de catálogo, informe cerrado y limpieza en `finally`.
- `scripts/issue49-pr39-native-docker-driver.mjs`: fábrica de transporte Docker con ruta absoluta conocida del cliente; sin punto de entrada automático. Acepta un transporte sustituible para pruebas *mock*, y solo utiliza el transporte nativo predeterminado cuando una llamada externa solicita y proporciona explícitamente la instancia. No contiene invocación al importar el módulo.
- `scripts/test-issue49-pr39-native-runner-core.mjs`: prueba de orquestación con driver íntegramente falso y **23 casos negativos**; ningún acceso a Docker.
- `scripts/test-issue49-pr39-native-docker-driver.mjs`: prueba end-to-end de la interfaz por transporte CLI interceptado en memoria y **4 casos negativos**; no se crea proceso ni contenedor.

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
