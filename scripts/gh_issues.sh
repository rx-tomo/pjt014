#!/usr/bin/env bash
set -euo pipefail

echo "[gh] Create representative issues (placeholder). Requires 'gh' and network."
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' not found." >&2
  exit 1
fi
echo "Use 'gh issue create' with templates under .github/ISSUE_TEMPLATE/."

