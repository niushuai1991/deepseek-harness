#!/usr/bin/env bash
# Headless smoke of the staged sidecar: boot the web profile with an OS-picked
# port, assert the ready line, fetch the index, then tear the process tree
# down. Usage: scripts/smoke-sidecar.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node_bin="$here/../staging/node/bin/node"
dsh_bin="$here/../staging/app/node_modules/@deepseek-ai/dsh/lib/bin.js"
log="$(mktemp)"
"$node_bin" "$dsh_bin" --profile web --port 0 >"$log" 2>&1 &
pid=$!
cleanup() {
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=""
for _ in $(seq 1 60); do
  ready="$(grep -oP 'dsh web: http://127\.0\.0\.1:\K[0-9]+' "$log" | head -1 || true)"
  [ -n "$ready" ] && break
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "smoke: sidecar exited before ready:" >&2
    cat "$log" >&2
    exit 1
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "smoke: no ready line within 60s:" >&2
  cat "$log" >&2
  exit 1
fi
echo "smoke: ready line port $ready"
curl -fsS -o /dev/null "http://127.0.0.1:${ready}/"
echo "smoke: index HTTP OK"
# The mux downlink answers plain GETs with 426 (websocket upgrade required),
# which proves the /api route layer is mounted behind the SPA fallback.
mux_status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${ready}/api/events.mux" || true)"
if [ "$mux_status" != "426" ]; then
  echo "smoke: GET /api/events.mux returned $mux_status, expected 426 — the /api route layer is not mounted" >&2
  exit 1
fi
echo "smoke: /api route layer mounted (426 on the mux downlink)"
echo "smoke: output tail:"
tail -5 "$log"
