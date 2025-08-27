#!/usr/bin/env bash
set -euo pipefail

echo "[setup] Ensuring corepack and Node are available..."
if command -v corepack >/dev/null 2>&1; then
  corepack enable || true
fi

if [ -f .nvmrc ] && command -v nvm >/dev/null 2>&1; then
  nvm use || true
fi

echo "[setup] Installing npm dependencies (if any)..."
npm install || true

echo "[setup] Done."

