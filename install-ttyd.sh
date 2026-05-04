#!/bin/bash
set -e

UNIT=/etc/systemd/system/ttyd.service
SRC="$(dirname "$0")/ttyd.service"

sudo cp "$SRC" "$UNIT"
sudo systemctl daemon-reload
sudo systemctl enable --now ttyd

# kill the old orphaned ttyd so systemd owns the new one
OLD=$(pgrep -f "ttyd.*tmux attach" || true)
if [ -n "$OLD" ]; then
  sudo kill "$OLD"
fi

echo "ttyd service installed. starting clownbot session..."
/home/clownbot/plan1/clownbot-session.sh
