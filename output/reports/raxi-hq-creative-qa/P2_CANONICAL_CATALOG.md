# PR #14 — P2: vínculo obligatorio con el catálogo canónico

Base: `11144f5ea6f693cd2c4d80f03498a5bafabd46d0`. Corrección exclusivamente documental en la propuesta QA; no implementa contratos nuevos ni cambia el catálogo actual, sus assets o los datos de Fototeca.

Se añade `CatalogAssetBinding` y una condición de cierre del alta: todo asset visual aprobado debe registrarse en `content/asset-library/ASSET_CATALOG.json` con Asset ID único, `repo_path` portable, versión y SHA-256 ligados al asset/versión y aprobación de Fototeca. Una entrada sin correspondencia confirmada no permite declarar el flujo terminado o seleccionar el asset como aprobado.

La ruta del catálogo es distinta del localizador privado de Storage. Un original público solo puede incorporarse al repositorio con autorización expresa para esa exposición. Un original privado de FanView requiere referencia/descriptor seguro, no una copia del medio ni preview privado. El hash original y el hash propuesto del descriptor (`reference_sha256`) se distinguen; el formato discriminado sigue pendiente de revisión e implementación. No se publican credenciales, URLs firmadas o localizadores privados para resolver el requisito de portabilidad. Si no existe una referencia segura, se bloquea el cierre del alta.

Validación: revisión del diff y de los contratos/criterios de aceptación; siete enlaces relativos del documento resueltos; `scripts/validate_asset_library.py` PASS para los 14 assets existentes. El validador actual comprueba IDs/rutas y reglas actuales: no acredita la implementación futura de `CatalogAssetBinding`, referencias privadas o cotejo de hashes con Fototeca. Esos son requisitos explícitos de futuros PR.

Sin cambios de código, esquema, catálogo, imágenes, credenciales ni producción. Los resultados de la corrección del ensayo de Edge pertenecen al PR #12 y no se incorporan a esta rama.
