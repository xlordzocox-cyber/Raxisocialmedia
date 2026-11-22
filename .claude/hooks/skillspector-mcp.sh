#!/bin/bash
# Launches the SkillSpector MCP server (stdio), installing it first if needed.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
"$dir/install-skillspector.sh" >&2
export PATH="$HOME/.local/bin:$PATH"
exec skillspector mcp
