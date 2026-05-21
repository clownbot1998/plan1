#!/bin/sh
set -e
cd "$(dirname "$0")"
git pull
./plan1.sh build
sudo -n systemctl restart plan1 2>/dev/null || systemctl restart plan1 2>/dev/null || kill -HUP "$(pgrep -f 'deno run.*server.js')" 2>/dev/null || true
