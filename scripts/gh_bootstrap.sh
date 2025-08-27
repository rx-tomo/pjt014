#!/usr/bin/env bash
set -euo pipefail

echo "[gh] Bootstrap labels and milestones (placeholder). Requires 'gh' and network."
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' not found." >&2
  exit 1
fi
echo "Define your org/repo, then create labels & milestones as needed."

