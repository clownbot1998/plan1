#!/bin/sh
set -e
cd "$(dirname "$0")"

PROD_HOST="${PLAN1_PROD_HOST:-realtime.sillyz.computer}"

git push
./plan1.sh deploy "$PROD_HOST"
