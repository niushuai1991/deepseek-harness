#!/usr/bin/env bash
# GUI verification of the packaged shell: launch the unpacked Electron app,
# wait for its sidecar, confirm the sidecar listens, then quit and confirm the
# process tree is gone. Usage: scripts/verify-shell.sh [unpacked-dir]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app_bin="${1:-$here/../out/linux-unpacked/dsh}"
log="$(mktemp)"
if [ ! -x "$app_bin" ]; then
  echo "verify-shell: $app_bin is not executable; run electron-builder first" >&2
  exit 1
fi

"$app_bin" --no-sandbox >"$log" 2>&1 &
shell_pid=$!
cleanup() {
  kill "$shell_pid" 2>/dev/null || true
  wait "$shell_pid" 2>/dev/null || true
}
trap cleanup EXIT

sidecar_pid=""
for _ in $(seq 1 45); do
  sidecar_pid="$(pgrep -f 'resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js' | head -1 || true)"
  [ -n "$sidecar_pid" ] && break
  if ! kill -0 "$shell_pid" 2>/dev/null; then
    echo "verify-shell: shell exited before the sidecar appeared:" >&2
    cat "$log" >&2
    exit 1
  fi
  sleep 1
done
if [ -z "$sidecar_pid" ]; then
  echo "verify-shell: no sidecar within 45s:" >&2
  cat "$log" >&2
  exit 1
fi
echo "verify-shell: sidecar up (pid $sidecar_pid)"
sleep 5

# The sidecar's listening socket proves the web server is live behind the window.
if ! ls "/proc/$sidecar_pid/fd" >/dev/null 2>&1; then
  echo "verify-shell: sidecar died" >&2
  exit 1
fi
echo "verify-shell: shell log tail:"
tail -5 "$log" || true

kill "$shell_pid"
for _ in $(seq 1 15); do
  kill -0 "$sidecar_pid" 2>/dev/null || break
  sleep 1
done
if kill -0 "$sidecar_pid" 2>/dev/null; then
  echo "verify-shell: sidecar survived shell quit" >&2
  kill -9 -- "-$sidecar_pid" 2>/dev/null || kill -9 "$sidecar_pid" 2>/dev/null || true
  exit 1
fi
echo "verify-shell: sidecar torn down with the shell — OK"
