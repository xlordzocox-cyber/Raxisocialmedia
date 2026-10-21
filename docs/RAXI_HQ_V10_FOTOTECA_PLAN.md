# Fototeca persistente — siguiente incremento separado

Estado: diseño para revisión, sin migraciones, importaciones ni nuevas fotografías en este PR.

## Registro y archivo original

`raxi_assets` conserva UUID interno y Asset ID externo estable; `job_id` enlaza a `raxi_production_jobs`, cuya campaña, Strategy y entregable identifican el contexto original. `aria_image_id` y `raxi_production_receipts` conservan el recibo auténtico. Si falta un original o recibo, se declara ausente/no verificado: no se reconstruye la primera prueba Aria ni se inventan fotografías para rellenar la fototeca.

Se propone añadir en ese PR unicidad de `(workspace_id, external_asset_id)` para IDs no nulos, versión/linaje explícitos y validaciones de metadatos. Revisar antes el esquema real, las FK y los datos existentes; no asumir que el catálogo local ya está importado. El Asset ID canónico permite vincular el catálogo portable cuando exista un asset aprobado, sin almacenar rutas de Windows.

El bucket privado `raxi-hq-private` conserva bytes originales sin recodificar. Una ruta interna como `workspace_uuid/asset_uuid/original` es un localizador del objeto, nunca la identidad pública del asset. El servidor verifica MIME, tamaño y SHA-256 de los bytes efectivamente recibidos y los compara con recibo/job antes de confirmar. Un reemplazo crea otra versión/asset enlazado por `parent_asset_id`; no sobrescribe el original. Registrar fallos y recuperación de subidas incompletas sin presentarlas como assets guardados.

Vestuario, categoría, descripción, etiquetas y procedencia viven en metadatos validados y versionados. Las categorías se acordarán sobre casos reales; una descripción o etiqueta no acredita QA, autoría Aria ni aprobación humana. Las imágenes importadas sin trabajo verificable requieren un flujo de procedencia separado, sin fabricar IDs de producción.

## QA, aprobación y uso

Reutilizar `raxi_asset_reviews`: revisión numerada, SHA-256 exacto, inspección visual, notas, estado QA, revisor autenticado y decisión humana. Aprobar solo después de inspeccionar los píxeles del original correspondiente; cualquier cambio de bytes exige otra revisión. `raxi_approvals` registra la decisión inmutable ligada al asset/revisión/hash concreto. No basta un recibo importado ni una Strategy aprobada.

Los planes de uso por plataforma se relacionan con `raxi_publication_plans` y sus snapshots; un plan no prueba publicación. Los usos efectivos deben tener evento/recibo verificable y auditoría. Revisar si esas tablas y eventos bastan antes de proponer una tabla adicional de usos. Nunca inferir uso o éxito desde una animación o calendario.

Las consultas para futuros agentes serán por Asset ID estable y workspace, filtradas por aprobación, QA y contexto de uso. Un servicio autorizado resuelve enlaces privados temporales tras comprobar permisos; no se conservan URLs firmadas como IDs ni se envían credenciales a agentes o Supermemory. Las políticas de Storage deben cubrir propietario, prefijo del workspace y permisos del servicio; un nombre de ruta no sustituye la autorización.

## Conservación y aceptación

Definir respaldo de originales, inventario/hash, retención y restauración probada de objetos y registros enlazados. Supermemory no es un respaldo de archivos ni del historial operativo. La aceptación exige: original recuperado byte a byte y mismo hash, metadatos/linaje intactos tras recarga, acceso ajeno rechazado, aprobación obsoleta invalidada, duplicados idempotentes y versiones/uso verificables. El incremento no generará imágenes para completar huecos.
