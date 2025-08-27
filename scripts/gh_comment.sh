#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/gh_comment.sh issue <number> <body-file>
  scripts/gh_comment.sh pr    <number> <body-file>
  scripts/gh_comment.sh issue-close <number> <body-file>

Notes:
  - Uses gh CLI with --body-file to avoid newline collapse.
  - issue-close: first posts a comment from file, then closes the issue.
USAGE
}

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install https://cli.github.com/" >&2
  exit 1
fi

CMD=${1:-}
NUM=${2:-}
FILE=${3:-}

if [[ -z "$CMD" || -z "$NUM" ]]; then
  usage; exit 2
fi

if [[ "$CMD" != "issue" && "$CMD" != "pr" && "$CMD" != "issue-close" ]]; then
  usage; exit 2
fi

if [[ "$CMD" == "issue" || "$CMD" == "pr" || "$CMD" == "issue-close" ]]; then
  if [[ -z "$FILE" || ! -f "$FILE" ]]; then
    echo "Body file not found: $FILE" >&2
    exit 2
  fi
fi

case "$CMD" in
  issue)
    gh issue comment "$NUM" --body-file "$FILE"
    ;;
  pr)
    gh pr comment "$NUM" --body-file "$FILE"
    ;;
  issue-close)
    gh issue comment "$NUM" --body-file "$FILE"
    gh issue close "$NUM"
    ;;
esac

echo "Done: $CMD #$NUM"

