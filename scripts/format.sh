#!/usr/bin/env bash
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found; skipping Prettier. Run 'npm i' first." >&2
  exit 0
fi

echo "[format] Running Prettier..."
npx prettier --write .

