#!/usr/bin/env bash
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found; skipping ESLint. Run 'npm i' first." >&2
  exit 0
fi

echo "[lint] ESLint running..."
npx eslint . --ext .js,.mjs,.cjs

echo "[lint] Prettier check..."
npx prettier --check .

