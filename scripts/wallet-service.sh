#!/usr/bin/env bash
# Provision (if needed) and start the WAS server on port 1088.
# Requires nvm. Pins Node 24 (WAS needs ^23.6.1 || ^24; better-sqlite3 breaks on 26).

set -e
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24 --no-progress
nvm use 24

WAS_DIR="$(cd "$(dirname "$0")/.." && pwd)/server/was"
mkdir -p "$WAS_DIR"
cd "$WAS_DIR"

if [ ! -d "wallet-attached-storage-server-main" ]; then
  echo "→ provisioning wallet-attached-storage-server..."
  curl -sL -o was.tar.gz https://github.com/did-coop/wallet-attached-storage-server/archive/main.tar.gz
  tar -xzf was.tar.gz
  rm was.tar.gz
  cd wallet-attached-storage-server-main
  npm install
  npm rebuild better-sqlite3
  cd ..
fi

cd wallet-attached-storage-server-main/nodejs
echo "→ starting WAS on :1088 (node $(node --version))"
mkdir -p var
DATABASE_URL="sqlite3:$(pwd)/var/was.sqlite3" \
  CORS_ALLOW_ALL_ORIGINS=TRUE \
  PORT=1088 \
  node --no-warnings ./scripts/start.ts
