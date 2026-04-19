#!/bin/bash
set -e

CMD=${1:-help}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client"
PID_FILE="$SCRIPT_DIR/.serve.pid"
PORT=${PLAN1_PORT:-9000}

case "$CMD" in
  serve)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "already serving on port $PORT (pid $(cat "$PID_FILE"))"
      exit 0
    fi
    cd "$CLIENT_DIR"
    python3 -m http.server "$PORT" &
    echo $! > "$PID_FILE"
    echo "serving $CLIENT_DIR on http://localhost:$PORT (pid $!)"
    echo "open http://localhost:$PORT/public/index.html"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null && echo "stopped" || true
      rm "$PID_FILE"
    else
      echo "not running"
    fi
    ;;
  restart)
    "$0" stop
    "$0" serve
    ;;
  open)
    xdg-open "http://localhost:$PORT/public/index.html" 2>/dev/null \
      || open "http://localhost:$PORT/public/index.html" 2>/dev/null \
      || echo "open http://localhost:$PORT/public/index.html"
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "running on port $PORT (pid $(cat "$PID_FILE"))"
    else
      echo "not running"
    fi
    ;;
  *)
    echo "Usage: ./plan1.sh [serve|stop|restart|open|status]"
    ;;
esac
