# Configuracion de Entorno

## Objetivo

Esta guia define como preparar el entorno local para trabajar en el repositorio RAXI Social Media sin mezclar archivos privados, referencias visuales y entregables finales.

## Requisitos

- Git instalado.
- Acceso al repositorio de GitHub.
- Un editor de texto como VS Code, Cursor o Codex.
- Herramientas de generacion visual externas segun el flujo de produccion: Freepik, Higgsfield, HeyGen, ElevenLabs, Seedance, Kling u otras equivalentes.

## Configuracion Local

Clona el repositorio:

```bash
git clone https://github.com/xlordzocox-cyber/Raxisocialmedia.git
cd Raxisocialmedia
```

Crea las carpetas de trabajo si todavia no existen:

```bash
mkdir -p assets/characters assets/outfits assets/locations assets/products outputs
```

En Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force assets/characters, assets/outfits, assets/locations, assets/products, outputs
```

## Variables y Secretos

No guardes claves API, tokens, codigos de recuperacion ni credenciales dentro del repositorio. Si una herramienta necesita configuracion local, usa un archivo `.env.local` y mantenlo fuera de Git.

Ejemplo de `.env.example`:

```text
ARIA_STUDIO_API_KEY=
FREEPIK_API_KEY=
ELEVENLABS_API_KEY=
```

El archivo `.env.example` puede subirse al repositorio porque no contiene valores reales.

## Organizacion de Assets

Usa esta estructura base:

```text
assets/characters/   Referencias de identidad de RAXI
assets/outfits/      Vestuario y combinaciones aprobadas
assets/locations/    Fondos, interiores y lugares recurrentes
assets/products/     Fichas de producto y referencias de marca
outputs/             Exportaciones finales para publicar
docs/                Guias, playbooks y notas de produccion
```

Los archivos finales en `outputs/` pueden crecer mucho. Si el repositorio empieza a pesar demasiado, sube solo muestras optimizadas y conserva masters pesados fuera de Git.

## Flujo Recomendado

1. Actualiza `main` antes de trabajar: `git pull origin main`.
2. Agrega o edita documentos, prompts o referencias aprobadas.
3. Revisa que no haya secretos: `git status` y `git diff`.
4. Crea commits pequenos y descriptivos.
5. Sube cambios con `git push origin main` o abre una rama si el cambio necesita revision.

## Seguridad

Antes de cada commit, confirma que no estas subiendo:

- Codigos de recuperacion.
- Archivos `.env.local`.
- Tokens de plataformas IA.
- Imagenes privadas sin permiso.
- Archivos PDF o capturas con informacion sensible.
