#!/bin/bash
set -e

CMD=${1:-help}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client/public"
DIST_DIR="$SCRIPT_DIR/dist"
PID_FILE="$SCRIPT_DIR/.serve.pid"
RELAY_PID_FILE="$SCRIPT_DIR/.relay.pid"
PORT=${PLAN1_PORT:-1998}

case "$CMD" in
  start)
    [ "$(id -u)" = "0" ] && echo "error: do not run start as root" && exit 1
    echo "── building ──"
    "$0" build
    echo "── starting WAS ──"
    docker compose -f "$SCRIPT_DIR/docker-compose.local.yml" up -d
    "$0" serve
    ;;
  serve)
    [ "$(id -u)" = "0" ] && echo "error: do not run serve as root" && exit 1
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "already serving on port $PORT (pid $(cat "$PID_FILE"))"
      exit 0
    fi
    ENV_FLAG=""
    [ -f "$SCRIPT_DIR/.env" ] && ENV_FLAG="--env-file=$SCRIPT_DIR/.env"
    deno run --no-lock --allow-read --allow-net --allow-env --allow-run --allow-write $ENV_FLAG "$SCRIPT_DIR/server.js" &
    echo $! > "$PID_FILE"
    echo "serving dist/ on http://localhost:$PORT (pid $!)"
    fuser -k 9208/tcp 2>/dev/null || true; sleep 1
    node $ENV_FLAG "$SCRIPT_DIR/multiplayer.js" &
    echo $! > "$RELAY_PID_FILE"
    echo "multiplayer relay on :9208 (pid $!)"
    echo "open http://localhost:$PORT/app/private-ai"
    ;;
  stop)
    WATCH_PID_FILE="$SCRIPT_DIR/.watch.pid"
    if [ -f "$WATCH_PID_FILE" ]; then
      kill "$(cat "$WATCH_PID_FILE")" 2>/dev/null || true
      rm "$WATCH_PID_FILE" 2>/dev/null || true
    fi
    if [ -f "$RELAY_PID_FILE" ]; then
      kill "$(cat "$RELAY_PID_FILE")" 2>/dev/null || true
      rm "$RELAY_PID_FILE" 2>/dev/null || true
    fi
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null && echo "stopped" || true
      rm "$PID_FILE" 2>/dev/null || sudo rm "$PID_FILE"
    else
      echo "not running"
    fi
    fuser -k ${PORT}/tcp 2>/dev/null || true
    docker compose -f "$SCRIPT_DIR/docker-compose.local.yml" down 2>/dev/null || true
    ;;
  restart)
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    "$0" stop
    if [ -n "$OLD_PID" ]; then
      while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.1; done
    fi
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
    # verify no double-nested vendor paths (symptom of incremental+rewrite bug)
    if grep -rq "vendor/deps/vendor" "$DIST_DIR"/*.html "$DIST_DIR"/blog/ 2>/dev/null; then
      echo "error: double-nested vendor paths detected in dist HTML — run ./plan1.sh build again to fix"
      exit 1
    fi
    # static elf-map graph.json — pure regex scan, no server/network needed,
    # cheap enough to refresh on every build. the runtime crawl (elf-map-crawl,
    # needs `serve` running) and the board push (elf-map-board, needs WAS) stay
    # separate — those have real external dependencies build shouldn't have.
    deno run --node-modules-dir=none --allow-read --allow-write --allow-env "$SCRIPT_DIR/debugging_utilities/elf_map.ts" || echo "warn: elf-map graph.json generation failed, continuing"
    ;;
  sync)
    ENV_FLAG=""
    [ -f "$SCRIPT_DIR/.env" ] && ENV_FLAG="--env-file=$SCRIPT_DIR/.env"
    deno run --allow-net --allow-env $ENV_FLAG "$SCRIPT_DIR/debugging_utilities/was_bootstrap.ts"
    ;;
  reset-test-state)
    # factory-resets accessibility-mode's WAS-persisted workspaces/tabs —
    # run before any e2e flow that opens accessibility-mode, so it starts
    # from a deterministic state instead of whatever the last test run (or
    # real session) left behind.
    ENV_FLAG=""
    [ -f "$SCRIPT_DIR/.env" ] && ENV_FLAG="--env-file=$SCRIPT_DIR/.env"
    deno run --node-modules-dir=none --allow-net --allow-env $ENV_FLAG "$SCRIPT_DIR/debugging_utilities/reset_test_state.ts"
    ;;
  private)
    ENV_FLAG=""
    [ -f "$SCRIPT_DIR/.env" ] && ENV_FLAG="--env-file=$SCRIPT_DIR/.env"
    mkdir -p "$SCRIPT_DIR/private"
    deno run --allow-net --allow-env --allow-read --allow-write $ENV_FLAG "$SCRIPT_DIR/debugging_utilities/was_private.ts" "${@:2}"
    ;;
  gallery)
    ENV_FLAG=""
    [ -f "$SCRIPT_DIR/.env" ] && ENV_FLAG="--env-file=$SCRIPT_DIR/.env"
    deno run --allow-run --allow-net --allow-env --allow-read --allow-write $ENV_FLAG "$SCRIPT_DIR/debugging_utilities/was_gallery.ts" "${@:2}"
    "$0" build
    ;;
  test)
    ENV_FLAG=""
    [ -f "$SCRIPT_DIR/.env" ] && ENV_FLAG="--env-file=$SCRIPT_DIR/.env"
    # --node-modules-dir=none: repo's node_modules/ (vendor.js/desktop deps) doesn't
    # contain puppeteer-core, and its presence otherwise forces byonm resolution.
    deno run --node-modules-dir=none --allow-net --allow-read --allow-write --allow-env --allow-run --allow-sys $ENV_FLAG "$SCRIPT_DIR/debugging_utilities/e2e_test.ts" "${@:2}"
    ;;
  elf-map)
    deno run --node-modules-dir=none --allow-read --allow-write --allow-env "$SCRIPT_DIR/debugging_utilities/elf_map.ts" "${@:2}"
    ;;
  plan98-map)
    # same static scan, aimed at the ~/.plan98 firmware repo instead of this
    # one — comparable architecture graph on a different (human-authored)
    # source tree. arg1 overrides the plan98 checkout path if it's not at ~/.plan98.
    PLAN98_ROOT="${2:-$HOME/.plan98}/client/public"
    deno run --node-modules-dir=none --allow-read --allow-write --allow-env "$SCRIPT_DIR/debugging_utilities/elf_map.ts" \
      --root "$PLAN98_ROOT" --out "$SCRIPT_DIR/private/plan98-map/graph.json"
    ;;
  elf-map-merge)
    # unifies elf-map + plan98-map into private/elf-map/combined.json, with
    # source/kind/edgeTypes/degree/prefix facets for the checkbox-filtered
    # viewer at /app/elf-map. run elf-map + plan98-map first.
    deno run --node-modules-dir=none --allow-read --allow-write "$SCRIPT_DIR/debugging_utilities/elf_map_merge.ts"
    ;;
  elf-map-crawl)
    ENV_FLAG=""
    [ -f "$SCRIPT_DIR/.env" ] && ENV_FLAG="--env-file=$SCRIPT_DIR/.env"
    deno run --node-modules-dir=none --allow-net --allow-read --allow-write --allow-env --allow-run --allow-sys $ENV_FLAG "$SCRIPT_DIR/debugging_utilities/elf_map_crawl.ts"
    ;;
  deploy)
    PROD_HOST="${2:-local.tychi.me}"
    PROD_DIR="${3:-~/plan1}"
    RUNTIME_DIR="${4:-~/srv/plan1}"
    echo "── deploying to $PROD_HOST ──"
    ssh "$PROD_HOST" PROD_DIR="$PROD_DIR" RUNTIME_DIR="$RUNTIME_DIR" bash <<'ENDSSH'
      set -e
      cd "$PROD_DIR"
      echo "── pull ──"
      git pull
      echo "── build ──"
      ./plan1.sh build
      echo "── smoke test ──"
      PLAN1_PORT=19980 PLAN1_DIST="$PROD_DIR/dist" \
        deno run --no-lock --allow-net --allow-read --allow-env --allow-sys --allow-write server.js &
      SMOKE_PID=$!
      sleep 3
      STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:19980/ 2>/dev/null || echo 000)
      kill $SMOKE_PID 2>/dev/null; wait $SMOKE_PID 2>/dev/null || true
      if [ "$STATUS" != "200" ]; then
        echo "smoke test failed (got $STATUS) — aborting"
        exit 1
      fi
      echo "smoke ok ($STATUS)"
      echo "── copy to $RUNTIME_DIR ──"
      mkdir -p "$RUNTIME_DIR"
      rsync -a --delete "$PROD_DIR/dist/" "$RUNTIME_DIR/"
      echo "── restart ──"
      export XDG_RUNTIME_DIR=/run/user/$(id -u)
      systemctl --user restart plan1
      sleep 1
      echo "── deployed ──"
ENDSSH
    ;;
  watch)
    WATCH_PID_FILE="$SCRIPT_DIR/.watch.pid"
    if [ -f "$WATCH_PID_FILE" ] && kill -0 "$(cat "$WATCH_PID_FILE")" 2>/dev/null; then
      echo "already watching (pid $(cat "$WATCH_PID_FILE"))"
      exit 0
    fi
    echo "watching everything — press Ctrl-C to stop"
    (
      while true; do
        CHANGED=$(inotifywait -r -q -e modify,create,delete,move \
          --format '%w%f' \
          "$SCRIPT_DIR/client/" \
          "$SCRIPT_DIR/blog/" \
          "$SCRIPT_DIR/private/" \
          "$SCRIPT_DIR/build.js" \
          "$SCRIPT_DIR/vendor.js" \
          "$SCRIPT_DIR/server.js" 2>/dev/null)
        echo "── $CHANGED"
        if echo "$CHANGED" | grep -q "server\.js$"; then
          echo "── server changed, restarting ──"
          "$SCRIPT_DIR/plan1.sh" restart
          sleep 1
        else
          qjs --std "$SCRIPT_DIR/build.js" 2>/dev/null
        fi
        curl -sf -X POST "http://localhost:${PORT}/__reload" > /dev/null 2>&1 || true
      done
    ) &
    echo $! > "$WATCH_PID_FILE"
    echo "watching (pid $!)"
    ;;
  setup)
    # Install systemd service, create runtime dir, initial rsync
    # Run this once on a fresh machine after cloning the repo.
    RUNTIME_DIR="${2:-$HOME/srv/plan1}"
    SERVICE_SRC="$SCRIPT_DIR/deploy/plan1.service"
    SERVICE_DST="/etc/systemd/system/plan1.service"

    echo "── installing $SERVICE_DST ──"
    sudo cp "$SERVICE_SRC" "$SERVICE_DST"
    sudo sed -i "s|/home/clownbot|$HOME|g" "$SERVICE_DST"
    sudo systemctl daemon-reload
    sudo systemctl enable plan1

    echo "── building ──"
    "$0" build

    echo "── syncing dist/ → $RUNTIME_DIR/ ──"
    mkdir -p "$RUNTIME_DIR"
    rsync -a --delete "$DIST_DIR/" "$RUNTIME_DIR/"

    echo "── starting ──"
    sudo systemctl restart plan1
    echo "── setup done — plan1 running ──"
    ;;
  bootstrap)
    MEMORY_SRC="$SCRIPT_DIR/memory"
    MEMORY_DST="$HOME/.claude/projects/-home-clownbot-plan1/memory"
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
  test)
    shift
    TEST_FILES=${*:-test/*.test.js}
    for f in $TEST_FILES; do
      [ -f "$f" ] && qjs --std "$f"
    done
    ;;
  ship)
    # build → serve locally → prompt → commit → push → deploy
    echo "── building ──"
    "$0" build

    # start local server if not running
    if ! ([ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null); then
      "$0" serve
    fi

    echo ""
    echo "open http://localhost:$PORT to test"
    echo ""
    read -r -p "did you test and it works? [y/N] " answer
    case "$answer" in
      [yY]*)
        echo "── committing ──"
        git -C "$SCRIPT_DIR" add -A
        read -r -p "commit message: " msg
        git -C "$SCRIPT_DIR" commit -m "$msg"
        git -C "$SCRIPT_DIR" push
        echo "── deploying ──"
        DEPLOY_KEY=$(grep PLAN1_DEPLOY_KEY "$SCRIPT_DIR/.env" 2>/dev/null | cut -d= -f2)
        PLAN1_HOST=$(grep PLAN1_HOST "$SCRIPT_DIR/.env" 2>/dev/null | cut -d= -f2)
        if [ -n "$DEPLOY_KEY" ] && [ -n "$PLAN1_HOST" ]; then
          curl -s -X POST "${PLAN1_HOST}/api/deploy?key=${DEPLOY_KEY}" | tail -3
        else
          echo "no PLAN1_DEPLOY_KEY or PLAN1_HOST in .env — skipping remote deploy"
        fi
        ;;
      *)
        echo "aborted — nothing committed"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Usage: ./plan1.sh [start|serve|stop|restart|open|status|lint|build|sync|deploy|ship|watch|test|reverse-client|bootstrap|setup]"
    echo "  start  — docker up WAS + serve (the one command)"
    echo "  build  — generates blog pages + vendors deps into dist/"
    echo "  ship   — build, serve locally, prompt to confirm, commit + push + deploy"
    echo "  sync   — uploads dist/ bootstrap files to WAS"
    echo "  reset-test-state — factory-resets accessibility-mode's WAS-persisted workspaces/tabs to a clean single default workspace"
    echo "  setup    — install systemd service + initial rsync (run once on fresh machine)"
    echo "  deploy   — ssh pull + build + smoke test + rsync + restart on prod"
    echo "  private  — sync private/ to WAS (--pull to restore, --dry-run to preview)"
    echo "  gallery  — screenshot gallery items → private/screenshots/<id>/ then build"
    echo "  watch    — rebuilds dist/ on any change to client/"
    echo "  serve  — serves dist/ on port $PORT"
    echo "  test   — headless e2e flow(s) w/ screenshot per step → private/screenshots/e2e/<flow>/ (arg: flow name, default: all)"
    echo "  elf-map  — static hypergraph of elf imports/embeds/saga-embeds → private/elf-map/graph.json"
    echo "  elf-map-crawl — headless-visits every elf route, merges 'renders' edges into graph.json (needs serve running)"
    echo "  plan98-map — same static scan aimed at ~/.plan98 instead → private/plan98-map/graph.json (arg: alt checkout path)"
    echo "  elf-map-merge — unify elf-map + plan98-map into private/elf-map/combined.json with source/kind/edgeTypes/degree/prefix facets"
    ;;
esac
