#!/bin/bash
# wireguard-up.sh — install + start wg-easy, wire plan1 .env
set -e

PLAN1=/home/clownbot/plan1
ENV=$PLAN1/.env
COMPOSE=$PLAN1/services/docker-compose.yml
WG_HOST=local.tychi.me
WG_PASS=clownbot

echo "==> kernel module"
sudo apt-get install -y wireguard 2>&1 | grep -E "already|newly|error"

echo "==> .env"
set_env() {
  local key=$1 val=$2
  if grep -q "^${key}=" "$ENV" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV"
  else
    echo "${key}=${val}" >> "$ENV"
  fi
}
set_env WG_HOST          "$WG_HOST"
set_env WG_EASY_PASSWORD "$WG_PASS"
set_env WG_EASY_URL      "http://localhost:51821"

echo "==> wireguard container"
docker compose -f "$COMPOSE" up -d wireguard

echo "==> waiting for wg-easy..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:51821/ > /dev/null 2>&1; then
    echo "==> wg-easy up"
    break
  fi
  sleep 2
done

echo "==> restarting plan1 (picks up new env)"
sudo systemctl restart plan1
sleep 2
sudo systemctl is-active plan1

echo ""
echo "done. open /app/wireguard-elf, add a peer named ipad, scan the QR."
