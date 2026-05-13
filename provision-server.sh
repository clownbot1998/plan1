#!/bin/sh
# provision-server.sh — stand up plan1 on a real Linux server (ssh + sudo access)
#
# Usage (run locally):
#   ./provision-server.sh <user>@<host>
#
#   <user> must have sudo access. clownbot will be created and take over from there.
#
# Prerequisites:
#   - SSH key auth working for <user>@<host>
#   - <user> has sudo (password prompt in your terminal is fine)
#   - plan1 and plan98 pushed to tangled.org
#
# What this does:
#   1. Creates clownbot user, installs your SSH key
#   2. Installs deno (copy to /usr/local/bin — symlinks into other user homes fail for systemd)
#   3. Builds qjs from source (not in ubuntu apt)
#   4. Clones plan1 + plan98 as clownbot
#   5. Writes plan1 .env (port 8000, WAS at localhost:1088)
#   6. Builds plan1
#   7. Installs plan1.service systemd unit, enables + starts it
#   8. Installs docker engine, adds clownbot to docker group
#   9. Brings up plan98 services (was, multiplayer, libretranslate) via docker compose
#
# After provisioning:
#   - plan1 on port 8000 (point your Caddyfile / reverse proxy there)
#   - WAS on port 1088
#   - multiplayer on port 9208
#   - libretranslate on port 3005 (takes ~5 min to download models on first boot)
#
# To deploy updates after a git push:
#   ssh clownbot@<host> 'bash /home/clownbot/build.sh'
#   ssh <user>@<host> 'sudo systemctl restart plan1'

set -e

TARGET="${1:?usage: provision-server.sh user@host}"
PUBKEY="$(cat ~/.ssh/id_ed25519.pub 2>/dev/null || cat ~/.ssh/id_rsa.pub)"

R() { ssh "$TARGET" "$@"; }
S() { ssh "$TARGET" "sudo sh -c '$*'"; }

echo "==> provisioning $TARGET"

# ── clownbot user ─────────────────────────────────────────────────────────────

echo "==> clownbot user"
S "useradd -m -s /bin/bash clownbot 2>/dev/null || true"
S "mkdir -p /home/clownbot/.ssh"
S "echo '$PUBKEY' > /home/clownbot/.ssh/authorized_keys"
S "chown -R clownbot:clownbot /home/clownbot/.ssh"
S "chmod 700 /home/clownbot/.ssh && chmod 600 /home/clownbot/.ssh/authorized_keys"

# ── deno ──────────────────────────────────────────────────────────────────────

echo "==> deno"
# install as current user, then copy binary — symlinks into user homes fail for systemd
R "curl -fsSL https://deno.land/install.sh -o /tmp/deno-install.sh && sh /tmp/deno-install.sh 2>&1 | grep -E 'Deno|error'"
DENO_BIN="$(R 'echo $HOME/.deno/bin/deno')"
S "cp $DENO_BIN /usr/local/bin/deno && chmod 755 /usr/local/bin/deno"
S "echo deno: \$(/usr/local/bin/deno --version | head -1)"

# ── qjs ───────────────────────────────────────────────────────────────────────

echo "==> qjs (build from source — not in ubuntu apt)"
S "apt-get install -y build-essential curl"
S "cd /tmp && curl -L https://bellard.org/quickjs/quickjs-2024-01-13.tar.xz | tar xJ && cd quickjs-2024-01-13 && make && cp qjs /usr/local/bin/qjs"
S "echo qjs: \$(qjs --version)"

# ── clone plan1 + plan98 ──────────────────────────────────────────────────────

echo "==> clone plan1 + plan98"
ssh clownbot@"${TARGET#*@}" "git clone https://tangled.org/clowncode.bsky.social/plan1.git /home/clownbot/plan1 2>&1 | tail -1"
ssh clownbot@"${TARGET#*@}" "git clone https://tangled.org/clowncode.bsky.social/plan98.git /home/clownbot/plan98 2>&1 | tail -1"

# ── plan1 .env ────────────────────────────────────────────────────────────────

echo "==> plan1 .env"
ssh clownbot@"${TARGET#*@}" "cp /home/clownbot/plan1/.env.example /home/clownbot/plan1/.env"
ssh clownbot@"${TARGET#*@}" "sed -i 's/^PLAN1_PORT=.*/PLAN1_PORT=8000/' /home/clownbot/plan1/.env"
ssh clownbot@"${TARGET#*@}" "sed -i 's|^PLAN98_WAS_HOST=.*|PLAN98_WAS_HOST=http://localhost:1088|' /home/clownbot/plan1/.env"
ssh clownbot@"${TARGET#*@}" "sed -i 's|^LIBRE_TRANSLATE_URL=.*|LIBRE_TRANSLATE_URL=http://localhost:3005|' /home/clownbot/plan1/.env || echo LIBRE_TRANSLATE_URL=http://localhost:3005 >> /home/clownbot/plan1/.env"

# ── build script + build ──────────────────────────────────────────────────────

echo "==> build plan1"
ssh clownbot@"${TARGET#*@}" "printf '#!/bin/sh\nset -e\ncd /home/clownbot/plan1\ngit pull\nrm -f deno.lock\nbash plan1.sh build\n' > /home/clownbot/build.sh && chmod +x /home/clownbot/build.sh"
ssh clownbot@"${TARGET#*@}" "bash /home/clownbot/build.sh 2>&1 | tail -5"

# ── systemd ───────────────────────────────────────────────────────────────────

echo "==> plan1 systemd unit"
# run deno directly — plan1.sh serve backgrounds deno and exits, which confuses systemd
S "cat > /etc/systemd/system/plan1.service << 'UNIT'
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
UNIT"

S "systemctl daemon-reload && systemctl enable --now plan1"
S "sleep 3 && curl -s -o /dev/null -w 'plan1: %{http_code}\n' http://localhost:8000/"

# ── docker ────────────────────────────────────────────────────────────────────

echo "==> docker + plan98 services"
S "curl -fsSL https://get.docker.com | sh"
S "usermod -aG docker clownbot"

# copy services compose from plan1 repo, build context points to plan98
ssh clownbot@"${TARGET#*@}" "cp /home/clownbot/plan1/services/docker-compose.yml /home/clownbot/plan98/docker-compose.services.yml"

# WAS Dockerfile needs tsx to run TypeScript; the start script is in nodejs/ subdirectory
ssh clownbot@"${TARGET#*@}" "cat > /home/clownbot/plan98/docker/Dockerfile.was << 'EOF'
FROM node:20-alpine
WORKDIR /app/server/was
RUN apk add --no-cache curl python3 make g++ bash sqlite sqlite-dev
COPY server/was/provision.sh .
RUN chmod +x provision.sh && ./provision.sh
RUN npm install -g tsx
ENV CORS_ALLOW_ALL_ORIGINS=true
ENV PORT=1088
EXPOSE 1088
WORKDIR /app/server/was/wallet-attached-storage-server-main/nodejs
CMD [\"npx\", \"tsx\", \"./scripts/start.ts\"]
EOF"

ssh clownbot@"${TARGET#*@}" "docker compose -f /home/clownbot/plan98/docker-compose.services.yml up -d --build 2>&1 | tail -10"

# ── wireguard ─────────────────────────────────────────────────────────────────

echo "==> wireguard"
S "apt-get install -y wireguard 2>&1 | grep -E 'already|newly|error'"
ssh clownbot@"${TARGET#*@}" "docker compose -f /home/clownbot/plan1/services/docker-compose.yml --env-file /home/clownbot/plan1/.env up -d wireguard 2>&1 | tail -5"

echo ""
echo "done."
echo "plan1:         http://$(echo $TARGET | cut -d@ -f2):8000"
echo "was:           http://$(echo $TARGET | cut -d@ -f2):1088"
echo "multiplayer:   http://$(echo $TARGET | cut -d@ -f2):9208"
echo "libretranslate: http://$(echo $TARGET | cut -d@ -f2):3005  (models downloading, ~5 min)"
echo ""
echo "wire into Caddy:"
echo "  your-domain.com { reverse_proxy localhost:8000 }"
echo ""
echo "to deploy updates:"
echo "  git push origin main && ssh clownbot@<host> 'bash /home/clownbot/build.sh'"
echo "  ssh $TARGET 'sudo systemctl restart plan1'"
