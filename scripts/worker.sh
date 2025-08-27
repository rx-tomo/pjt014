#!/usr/bin/env bash
set -euo pipefail

echo "[worker] Starting placeholder worker..."
node -e "console.log('worker tick'); setInterval(()=>console.log('worker tick'), 5000)"

