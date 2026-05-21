#!/bin/sh
set -e
cd "$(dirname "$0")"

# load .env for PLAN1_DEPLOY_KEY and PLAN1_HOST
[ -f .env ] && export $(grep -v '^#' .env | grep -v '^$' | xargs)

HOST="${PLAN1_HOST:-https://local.tychi.me}"
KEY="${PLAN1_DEPLOY_KEY:-}"

git push

if [ -n "$KEY" ]; then
  # trigger remote deploy via API — no SSH needed
  curl -fsSL -X POST "${HOST}/api/deploy" -H "X-Deploy-Key: ${KEY}"
else
  # fallback: ssh and run locally
  ssh -o StrictHostKeyChecking=no clownbot@realtime.sillyz.computer \
    'cd ~/plan1 && git pull && ./plan1.sh build && kill -HUP $(pgrep -f "deno run.*server.js") 2>/dev/null; echo done'
fi
