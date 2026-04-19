#!/bin/bash
set -e

CMD=${1:-help}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client/public"
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
    echo "open http://localhost:$PORT/index.html"
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
    xdg-open "http://localhost:$PORT/index.html" 2>/dev/null \
      || open "http://localhost:$PORT/index.html" 2>/dev/null \
      || echo "open http://localhost:$PORT/index.html"
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "running on port $PORT (pid $(cat "$PID_FILE"))"
    else
      echo "not running"
    fi
    ;;
  lint)
    cd "$CLIENT_DIR"
    PASS=true

    echo "── css class conflicts ──"
    CSS_CONFLICTS=$(for f in elves/*.js; do
      elf=$(basename "$f" .js)
      grep -oP '(?<=& )\.[a-z][a-z0-9-]+(?=[\s{,>+~:#\[])' "$f" | sort -u | sed "s|^|$elf:|"
    done | awk -F: '{
      cls=$2; list[cls]=list[cls]?list[cls]","$1:$1; count[cls]++
    } END {
      for(cls in count) if(count[cls]>1) print cls"\t"list[cls]
    }' | sort)
    if [ -n "$CSS_CONFLICTS" ]; then echo "$CSS_CONFLICTS"; PASS=false; else echo "ok"; fi

    echo "── bare tag event selectors ──"
    HTML_TAGS='(a|button|canvas|code|div|form|input|select|span|textarea|ul|li|img|video|audio|table|tr|td|th)'
    BARE_TAG=$(for f in elves/*.js; do
      elf=$(basename "$f" .js)
      grep -oP "(?<=when\(')[^']+(?=',\s*[a-z])" "$f" 2>/dev/null | grep -E "^${HTML_TAGS}$" | sed "s|^|$elf: |"
    done)
    if [ -n "$BARE_TAG" ]; then echo "$BARE_TAG"; PASS=false; else echo "ok"; fi

    echo "── object merge nuance ──"
    MERGE_NUANCE=$(grep -rn 'mergeHandler:' elves/*.js | grep -v '^\s*//' || true)
    if [ -n "$MERGE_NUANCE" ]; then echo "$MERGE_NUANCE"; PASS=false; else echo "ok"; fi

    echo "── data-attribute conflicts ──"
    DATA_CONFLICTS=$(for f in elves/*.js; do
      elf=$(basename "$f" .js)
      grep -oP 'data-[a-z][a-z0-9-]+' "$f" | sort -u | sed "s|^|$elf:|"
    done | awk -F: '{
      attr=$2; list[attr]=list[attr]?list[attr]","$1:$1; count[attr]++
    } END {
      for(attr in count) if(count[attr]>1) print "["attr"]\t"list[attr]
    }' | grep -vE '\[(data-modal-close|data-tray|data-url|data-focused|data-direction|data-bind|data-search|data-index|data-menu|data-mode|data-title)\]' | sort)
    if [ -n "$DATA_CONFLICTS" ]; then echo "$DATA_CONFLICTS"; PASS=false; else echo "ok"; fi

    $PASS && echo "── all checks passed ──"
    ;;
  *)
    echo "Usage: ./plan1.sh [serve|stop|restart|open|status|lint]"
    ;;
esac
