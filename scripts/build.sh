#!/usr/bin/env bash
set -euo pipefail

echo "[build] Nothing to compile (pure Node). Preparing dist..."
mkdir -p dist
rsync -a --delete --exclude node_modules --exclude dist --exclude .git ./ dist/src/ >/dev/null 2>&1 || true
echo "[build] Done."

