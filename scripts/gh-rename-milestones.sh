#!/usr/bin/env bash
set -euo pipefail

# Rename milestones to include execution order numbers.
# Usage: scripts/gh-rename-milestones.sh [owner/repo]

repo="${1:-}"
if [ -z "$repo" ]; then
  repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
fi

declare -a ORDERED=(
  "MVP"
  "OAuth & Tokens"
  "Supabase Schema"
  "Worker & Jobs"
  "Admin UI"
  "Security & Compliance"
)

echo "Fetching milestones for $repo ..."
ms=$(gh api repos/$repo/milestones --paginate -q '.[] | {number, title}')

renamed=0
for i in "${!ORDERED[@]}"; do
  old_title="${ORDERED[$i]}"
  num=$(printf "%02d" $((i+1)))
  new_title="$num. $old_title"

  # Find milestone by exact title (un-numbered)
  number=$(echo "$ms" | jq -r --arg t "$old_title" 'select(.title == $t) | .number' | head -n1 || true)
  if [ -n "${number:-}" ]; then
    echo "Renaming #$number: '$old_title' -> '$new_title'"
    gh api repos/$repo/milestones/$number -X PATCH -f title="$new_title" >/dev/null
    renamed=$((renamed+1))
  else
    echo "Skipping: '$old_title' not found (maybe already renamed)."
  fi
done

echo "Renamed $renamed milestones."

