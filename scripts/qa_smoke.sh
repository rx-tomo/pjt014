#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE_URL:-http://localhost:3014}"

echo "[QA] Checking /"
curl -fsS "$BASE/" >/dev/null

echo "[QA] Checking /api/dashboard"
curl -fsS "$BASE/api/dashboard" | jq -e '.ok == true' >/dev/null || exit 1

echo "[QA] Checking /api/health"
curl -fsS "$BASE/api/health" | jq -e '.ok == true' >/dev/null || true

echo "[QA] Checking /locations"
curl -fsS "$BASE/locations" >/dev/null

echo "[QA] OK"

