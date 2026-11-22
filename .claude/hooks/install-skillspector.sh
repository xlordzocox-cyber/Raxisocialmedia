#!/bin/bash
# Installs NVIDIA SkillSpector (CLI + MCP extra) if missing or outdated.
set -euo pipefail

SKILLSPECTOR_SPEC='skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git'
export PATH="$HOME/.local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh >&2
fi

# Reinstall only when the binary is missing or the MCP extra is not importable.
tool_python="$(uv tool dir 2>/dev/null)/skillspector/bin/python"
if ! command -v skillspector >/dev/null 2>&1 \
   || ! "$tool_python" -I -c 'import mcp' >/dev/null 2>&1; then
  uv tool install --python 3.13 --force "$SKILLSPECTOR_SPEC" >&2
fi
