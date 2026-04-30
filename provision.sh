#!/bin/sh
# provision.sh — stand up plan1 on a fresh exe.dev VM
#
# Usage:
#   ./provision.sh <vm-name> <shell-password>
#
# Prerequisites:
#   - ssh key registered with exe.dev (ssh exe.dev whoami)
#   - VM already created (ssh exe.dev 'new')
#   - plan1 pushed to tangled.org (git push origin main)
#
# What this does:
#   1. Creates clownbot user with your SSH key
#   2. Installs deno, caddy, ttyd
#   3. Clones and builds plan1
#   4. Writes systemd units for plan1, ttyd, caddy
#   5. Writes Caddyfile: /shell* → ttyd, * → plan1
#   6. Adds basicauth on /shell* with the given password
#   7. Points exe.dev proxy at caddy (port 4000)
#
# After provisioning:
#   - https://<vm>.exe.xyz        → plan1
#   - https://<vm>.exe.xyz/shell/ → ttyd (password protected)
#   - /app/tty-elf                → browser shell inside plan1
#
# To update plan1 after a git push:
#   ssh exe.dev 'ssh <vm> "sudo su - clownbot -c \"cd plan1 && ./deploy.sh\""'

set -e

VM="${1:?usage: provision.sh <vm-name> <shell-password>}"
SHELL_PASS="${2:?usage: provision.sh <vm-name> <shell-password>}"

EXE="ssh -o ConnectTimeout=30 exe.dev"
BOX="$EXE ssh $VM"

PUBKEY="$(cat ~/.ssh/id_ed25519.pub 2>/dev/null || cat ~/.ssh/id_rsa.pub)"

echo "==> provisioning $VM.exe.xyz"

# ── user ──────────────────────────────────────────────────────────────────────

echo "==> clownbot user"
$BOX "sudo useradd -m -s /bin/bash clownbot 2>/dev/null || true"
$BOX "sudo mkdir -p /home/clownbot/.ssh"
$BOX "echo '$PUBKEY' | sudo tee /home/clownbot/.ssh/authorized_keys > /dev/null"
$BOX "sudo chown -R clownbot:clownbot /home/clownbot/.ssh"
$BOX "sudo chmod 700 /home/clownbot/.ssh && sudo chmod 600 /home/clownbot/.ssh/authorized_keys"
$BOX "sudo chmod 755 /home/clownbot"

# ── deps ──────────────────────────────────────────────────────────────────────

echo "==> installing deps"
# deno is not in ubuntu apt; install to /usr/local so all users can run it
$BOX "curl -fsSL https://deno.land/install.sh | sudo DENO_INSTALL=/usr/local sh 2>&1 | grep -E 'installed|error'"
$BOX "sudo apt-get install -y caddy ttyd 2>&1 | grep -E 'already|newly|error'"

# ── plan1 ─────────────────────────────────────────────────────────────────────

echo "==> clone + build plan1"
$BOX "sudo rm -rf /home/clownbot/plan1"
$BOX "sudo -u clownbot git clone https://tangled.org/clowncode.bsky.social/plan1.git /home/clownbot/plan1"
$BOX "sudo chmod +x /home/clownbot/plan1/deploy.sh /home/clownbot/plan1/plan1.sh"

# exe.dev's HTTP proxy requires port 3000-9999; plan1 defaults to 1998
$BOX "sudo -u clownbot cp /home/clownbot/plan1/.env.example /home/clownbot/plan1/.env 2>/dev/null || sudo -u clownbot touch /home/clownbot/plan1/.env"
$BOX "sudo -u clownbot bash -c \"grep -q '^PLAN1_PORT' /home/clownbot/plan1/.env && sed -i 's/^PLAN1_PORT=.*/PLAN1_PORT=3000/' /home/clownbot/plan1/.env || echo PLAN1_PORT=3000 >> /home/clownbot/plan1/.env\""

$BOX "sudo su - clownbot -c 'cd plan1 && bash plan1.sh build' 2>&1 | tail -3"

# ── systemd ───────────────────────────────────────────────────────────────────

echo "==> systemd units"

# run deno directly — plan1.sh serve backgrounds deno and exits, confusing systemd
$BOX "cat << 'EOF' | sudo tee /etc/systemd/system/plan1.service
[Unit]
Description=plan1
After=network.target

[Service]
User=clownbot
WorkingDirectory=/home/clownbot/plan1
ExecStart=/usr/local/bin/deno run --allow-read --allow-net --allow-env --allow-run --allow-write --env-file=/home/clownbot/plan1/.env /home/clownbot/plan1/server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF"

$BOX "cat << 'EOF' | sudo tee /etc/systemd/system/ttyd.service
[Unit]
Description=ttyd
After=network.target

[Service]
User=clownbot
ExecStart=/bin/ttyd -p 7681 -W bash
Restart=always

[Install]
WantedBy=multi-user.target
EOF"

# ── caddy ─────────────────────────────────────────────────────────────────────

echo "==> caddy config"

# hash the shell password
HASH="$($BOX "caddy hash-password --plaintext '$SHELL_PASS'")"

$BOX "cat << EOF | sudo tee /etc/caddy/Caddyfile
:4000 {
    @shell path /shell*
    handle @shell {
        basicauth {
            clownbot $HASH
        }
        uri strip_prefix /shell
        header Cross-Origin-Resource-Policy cross-origin
        header Cross-Origin-Embedder-Policy require-corp
        reverse_proxy localhost:7681
    }
    handle {
        reverse_proxy localhost:3000
    }
}
EOF"

# ── start everything ──────────────────────────────────────────────────────────

echo "==> enabling services"
$BOX "sudo systemctl daemon-reload"
$BOX "sudo systemctl enable --now plan1 ttyd"
$BOX "sudo systemctl restart caddy"

# ── exe.dev proxy ─────────────────────────────────────────────────────────────

echo "==> pointing exe.dev proxy at caddy"
# caddy listens on 4000, handles TLS termination from exe.dev's edge
$EXE "share port $VM 4000"

echo ""
echo "done. https://$VM.exe.xyz is live."
echo "shell: https://$VM.exe.xyz/shell/  (user: clownbot)"
echo ""
echo "to deploy updates:"
echo "  git push origin main"
echo "  ssh exe.dev 'ssh $VM \"sudo su - clownbot -c \\\"cd plan1 && ./deploy.sh\\\"\"'"
