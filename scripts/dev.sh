#!/usr/bin/env bash
set -euo pipefail

# Auto-restart via nodemon + browser live-reload (SSE)
export NODE_ENV=development
export DEV_RELOAD=1

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found; please install Node.js/npm" >&2
  PORT="${PORT:-3014}" node src/core/server.js
  exit 0
fi

PORT="${PORT:-3014}" npx nodemon \
  --quiet \
  --watch src \
  --ext js,mjs,json \
  --signal SIGTERM \
  --exec "node src/core/server.js"
