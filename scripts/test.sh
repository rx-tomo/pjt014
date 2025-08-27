#!/usr/bin/env bash
set -euo pipefail

echo "[test] Running Node test runner..."
NODE_OPTIONS="${NODE_OPTIONS:-}" node --test --test-reporter=spec "tests/**/*.js"
