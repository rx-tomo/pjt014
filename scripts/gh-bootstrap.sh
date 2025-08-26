#!/usr/bin/env bash
set -euo pipefail

# Requires GitHub CLI (gh) authenticated. Network access needed.

repo="${1:-}" # e.g., rx-tomo/pjt014
if [ -z "$repo" ]; then
  echo "Usage: $0 <owner/repo>" >&2
  exit 1
fi

echo "Creating labels..."
gh label create "type:feat" --color FFD700 --description "Feature" --repo "$repo" || true
gh label create "type:bug" --color DC143C --description "Bug" --repo "$repo" || true
gh label create "type:chore" --color 808080 --description "Chore" --repo "$repo" || true
gh label create "area:api" --color 1E90FF --description "API" --repo "$repo" || true
gh label create "area:ui" --color 32CD32 --description "UI" --repo "$repo" || true
gh label create "area:worker" --color 8A2BE2 --description "Worker" --repo "$repo" || true
gh label create "priority:p0" --color 000000 --description "Critical" --repo "$repo" || true
gh label create "priority:p1" --color A0522D --description "High" --repo "$repo" || true
gh label create "priority:p2" --color D3D3D3 --description "Normal" --repo "$repo" || true

echo "Creating milestones..."
for m in "MVP" "OAuth & Tokens" "Supabase Schema" "Worker & Jobs" "Admin UI" "Security & Compliance"; do
  gh api repos/$repo/milestones -f title="$m" >/dev/null || true
done

echo "Done."

