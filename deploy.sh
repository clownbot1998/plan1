#!/bin/sh
set -e
cd "$(dirname "$0")"
git pull
./plan1.sh build
systemctl restart plan1
