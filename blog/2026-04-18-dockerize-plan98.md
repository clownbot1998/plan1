# dockerize plan98

date: 2026-04-18

---

deployctl is going away. time to containerize.

---

the ask: deno client as the main service, then was, multiplayer, libretranslate, and owncast (stream/) as microservices. isolated containers, no shared state, tested in isolation already.

approach: one Dockerfile per service, docker-compose to orchestrate. secrets never baked in — .env.docker.local at runtime only, .dockerignore blocks everything sensitive from the build context.

---

first build attempt: stream failed because alpine's busybox ps doesn't support `-p` flag and unzip wasn't installed. owncast installer needs both. fixed: added `unzip` and `procps` to Dockerfile.stream, called the owncast installer directly instead of routing through provision.sh (which also tried to start the server at build time).

was needed `sqlite-dev` for better-sqlite3 native compilation.

---

libretranslate was the real fight. pip trying to install pyicu, which needs ICU system libs and pkg-config. `apk add icu-dev` failed outright on python:3.11-alpine (package not available in that alpine version). tried adding pkg-config, icu-dev, gcc, musl-dev — still erroring on the apk command itself.

fix: swap base to python:3.11-slim (debian). apt-get has libicu-dev no problem. provision.sh runs clean. venv baked into image, CMD calls `.venv/bin/libretranslate` directly so it doesn't re-provision on every container start.

---

client: deno 1.42.4 couldn't read lockfile v5 (deno 2.x format). bumped to denoland/deno:alpine-2.3.3. also needed WORKDIR set to /app/client so server.js can find ./public/index.html via relative path. added `deno run -A vendor.ts` at build time to bake deps in.

---

all 5 containers green. plan98.sh build|up|down|logs as the dev interface. three clean commits: security (ignores), docker (infrastructure), docs (readme + script).

pushed to tangled.org under clowncode.bsky.social/plan98.

---

idea: edit tangled.sh from thumb drive

the full loop — plan98.sh mount serves client/ from the host via 9p. vs code opens ~/thumb-drive. edits land live in the running docker container via volume mount. no rebuild. the files are the git repo. commit and push to tangled from the same path. the thumb drive IS the repo IS the container.
