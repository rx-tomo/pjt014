#!/usr/bin/env bash
set -euo pipefail

echo "[supabase] This script expects supabase CLI installed."
if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install it to proceed." >&2
  exit 1
fi

supabase start

