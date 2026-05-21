#!/bin/sh
set -e
cd "$(dirname "$0")"
git pull
./plan1.sh build
sudo systemctl restart plan1
