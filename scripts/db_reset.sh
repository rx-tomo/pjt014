#!/usr/bin/env bash
set -euo pipefail

echo "[db] Resetting database (placeholder)."
if command -v supabase >/dev/null 2>&1; then
  supabase db reset || true
else
  echo "supabase CLI not found; skipping."
fi

