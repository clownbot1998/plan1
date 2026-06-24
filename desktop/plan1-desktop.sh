#!/bin/sh
# plan1 desktop launcher — sway autostart.
# Ensures the plan1 server is serving, then opens the native laufey window at it.
# This replaces the old `exec firefox http://localhost:8000` autostart.
#
# Architecture (see blog 2026-06-24): laufey = backend binary + runtime .so.
# libplan1_runtime.so is a pure-Rust laufey runtime (Window::new().load(url)),
# sidestepping deno-desktop's broken auto-window. Built from ~/laufey-src/examples/plan1.
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PLAN1_PORT:-1998}"
DENO=/home/clownbot/.deno/bin/deno

# Start the plan1 server if nothing is answering on the port yet.
if ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
  ( cd /home/clownbot/plan1 && "$DENO" run --allow-all --env-file=.env server.js \
      >/tmp/plan1-server.log 2>&1 & )
  i=0
  while [ "$i" -lt 40 ]; do
    curl -sf -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
    i=$((i + 1)); sleep 0.25
  done
fi

# Open the laufey window pointed at the server. PLAN1_URL is read by the runtime.
exec env PLAN1_URL="http://localhost:$PORT" \
  "$HERE/laufey_webview" --runtime "$HERE/libplan1_runtime.so"
