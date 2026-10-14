# Raxi Asset Library

Esta carpeta es la fuente canónica para assets visuales aprobados de Raxi. Las campañas deben referenciar imágenes mediante `Asset ID` y `repo_path` desde `content/asset-library/ASSET_CATALOG.json`.

## Canonical Asset ID Rule

Usa siempre el `asset_id` exacto del catálogo.

Correcto:

- `B-BLUE-DUELIST`
- `assets/approved/cosplay/B-BLUE-DUELIST.jpg`

Incorrecto:

- `Blue Duelist final local`
- `C:\Users\joslu\Downloads\ARIAIA\Fotos perfil\...`

## Workflow

1. Revisa `ASSET_CATALOG.json`.
2. Elige una o varias familias visuales.
3. Detecta huecos de campaña.
4. Reutiliza, agrupa o expande assets existentes antes de generar nuevas imágenes.
5. Si falta una pieza, genera solo el asset necesario y agréguelo al catálogo.

## Visual Families

- `COSPLAY_LIBRARY.md`: cosplay y looks inspirados en personajes.
- `GAMER_LIBRARY.md`: retratos gamer indoor y RGB.
- `ARCADE_LIBRARY.md`: lifestyle arcade, salidas y gaming social.

## QA

Consulta `QA_CAPABILITIES.md` antes de marcar una campaña como aprobada. La aprobación visual requiere inspección real de imagen; sin acceso visual, usa `VISUAL_REVIEW_REQUIRED`.
