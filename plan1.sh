#!/bin/bash
set -e

CMD=${1:-help}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client/public"
DIST_DIR="$SCRIPT_DIR/dist"
PID_FILE="$SCRIPT_DIR/.serve.pid"
PORT=${PLAN1_PORT:-1998}

case "$CMD" in
  serve)
    [ "$(id -u)" = "0" ] && echo "error: do not run serve as root" && exit 1
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "already serving on port $PORT (pid $(cat "$PID_FILE"))"
      exit 0
    fi
    SERVE_DIR="$DIST_DIR"
    [ ! -f "$DIST_DIR/index.html" ] && SERVE_DIR="$CLIENT_DIR"
    cd "$SERVE_DIR"
    python3 -m http.server "$PORT" &
    echo $! > "$PID_FILE"
    echo "serving $SERVE_DIR on http://localhost:$PORT (pid $!)"
    echo "open http://localhost:$PORT/index.html"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null && echo "stopped" || true
      rm "$PID_FILE" 2>/dev/null || sudo rm "$PID_FILE"
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

    echo "── stale /public/ paths ──"
    PUBLIC_PATHS=$(grep -rn "'/public/\|src: /public/\|\"/public/" elves/*.js cdn/ sagas/ 2>/dev/null | grep -v '^\s*//' || true)
    if [ -n "$PUBLIC_PATHS" ]; then echo "$PUBLIC_PATHS"; PASS=false; else echo "ok"; fi

    echo "── $.teach in lifecycle hooks ──"
    TEACH_IN_HOOKS=$(for f in elves/*.js; do
      elf=$(basename "$f" .js)
      awk '
        /function (beforeUpdate|afterUpdate)\b/ { in_hook=1; depth=0 }
        in_hook { depth += gsub(/{/, "{"); depth -= gsub(/}/, "}") }
        in_hook && /\$\.teach\(/ { print FILENAME ":" NR ": " $0 }
        in_hook && depth <= 0 && NR > 1 { in_hook=0 }
      ' "$f"
    done || true)
    if [ -n "$TEACH_IN_HOOKS" ]; then echo "$TEACH_IN_HOOKS"; PASS=false; else echo "ok"; fi

    $PASS && echo "── all checks passed ──"
    ;;
  build)
    qjs --std "$SCRIPT_DIR/build.js"
    qjs --std "$SCRIPT_DIR/vendor.js"
    ;;
  bootstrap)
    MEMORY_SRC="$SCRIPT_DIR/memory"
    MEMORY_DST="$HOME/.claude/projects/-home-clownbot/memory"
    AGENT="$SCRIPT_DIR/AGENT.md"

    # wire claude code memory to git-tracked memory dir
    rm -rf "$MEMORY_DST"
    ln -sf "$MEMORY_SRC" "$MEMORY_DST"
    echo "linked: $MEMORY_DST -> $MEMORY_SRC"

    # harness files — all point to AGENT.md
    ln -sf "$AGENT" "$SCRIPT_DIR/CLAUDE.md"
    ln -sf "$AGENT" "$SCRIPT_DIR/AGENTS.md"
    ln -sf "$AGENT" "$SCRIPT_DIR/GEMINI.md"
    ln -sf "$AGENT" "$SCRIPT_DIR/.cursorrules"
    ln -sf "$AGENT" "$SCRIPT_DIR/.windsurfrules"
    mkdir -p "$SCRIPT_DIR/.github"
    ln -sf "$AGENT" "$SCRIPT_DIR/.github/copilot-instructions.md"
    echo "linked: CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules, .windsurfrules, .github/copilot-instructions.md -> AGENT.md"
    echo "bootstrap done"
    ;;
  reverse-client)
    CALLER="${SUDO_USER:-$USER}"
    echo "reversing client as $CALLER on port $PORT..."
    sudo -u "$CALLER" -E ssh -N -R "${PORT}:localhost:${PORT}" "local.${CALLER}.me"
    ;;
  *)
    echo "Usage: ./plan1.sh [serve|stop|restart|open|status|lint|build|reverse-client|bootstrap]"
    echo "  build  — generates blog pages + vendors deps into dist/"
    echo "  serve  — serves dist/ on port $PORT"
    ;;
esac
