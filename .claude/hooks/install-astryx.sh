#!/bin/bash
# Installs the Astryx design-system CLI (meta/astryx), pinned to a reviewed version.
set -euo pipefail

ASTRYX_VERSION='0.7.17'

if ! command -v npm >/dev/null 2>&1; then
  echo "install-astryx: npm not found, skipping" >&2
  exit 0
fi

installed="$(npm ls -g --depth=0 --json @astryxdesign/cli 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).dependencies["@astryxdesign/cli"].version)}catch{}})' || true)"
if [ "$installed" != "$ASTRYX_VERSION" ]; then
  npm install -g "@astryxdesign/cli@${ASTRYX_VERSION}" --no-fund --no-audit >&2
fi
