#!/usr/bin/env bash
set -euo pipefail

# Auto-restart on code changes using Node's built-in watcher (Node 22+)
# Falls back to normal run if --watch is unsupported.
CMD=(node --watch --watch-path=src src/core/server.js)
if node --help | grep -q "--watch"; then
  PORT="${PORT:-3014}" "${CMD[@]}"
else
  echo "[dev] Node --watch not supported by this runtime. Running without watch."
  PORT="${PORT:-3014}" node src/core/server.js
fi
