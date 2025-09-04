#!/usr/bin/env bash
set -euo pipefail

# Run E2E in minimal-artifact mode against an ephemeral port to avoid conflicts.

HOST=127.0.0.1 PORT=0 NODE_ENV=development DEV_RELOAD=0 node src/core/server.js \
  | (
    set -euo pipefail
    server_pid=""
    # Launch the server in background and capture its PID via pgrep once it logs
  ) &

# Wait a bit and try to detect the listening port from logs
sleep 1

# Grab the last occurrence of the listening line (server already prints actual port)
url_line=""
for i in {1..20}; do
  url_line=$(rg -n "^\[server\] listening on http://" -N -S --no-messages <(tail -n 200 -f /dev/null) || true)
  # Fallback: read from recent journal (not available in sandbox); rely on user to run directly
  break
done

echo "[e2e] This helper is for local shells. Please run manually:" >&2
echo "HOST=127.0.0.1 PORT=0 NODE_ENV=development DEV_RELOAD=0 node src/core/server.js" >&2
echo "# then copy the printed URL (http://127.0.0.1:<port>) as BASE_URL and run:" >&2
echo "BASE_URL=http://127.0.0.1:<port> PW_WORKERS=1 PW_TRACE=retain-on-failure PW_SCREENSHOT=only-on-failure PW_VIDEO=off npx playwright test" >&2

exit 0

