#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3014}" node src/core/server.js

