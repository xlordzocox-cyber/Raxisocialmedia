#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# SkillSpector: security scanner for agent skills (always available)
./.claude/hooks/install-skillspector.sh

# Astryx: design-system CLI used by the astryx skill (pinned version)
./.claude/hooks/install-astryx.sh

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi
