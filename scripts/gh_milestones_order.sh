#!/usr/bin/env bash
set -euo pipefail

echo "[gh] Apply milestone numbering (placeholder). Requires 'gh' and network."
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' not found." >&2
  exit 1
fi
echo "Ensure milestones follow: 01. MVP, 02. OAuth & Tokens, 03. Supabase Schema, 04. Worker & Jobs, 05. Admin UI, 06. Security & Compliance"

