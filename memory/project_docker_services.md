---
name: project-docker-services
description: "docker containers plan1 depends on, current status, how to start"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41c331c6-05ce-43bc-a61f-585f972f5104
---

Plan1 borrows plan98's docker containers. Not in an infra sprint — just start them manually.

**To start (local clownbot machine):**
```
docker start plan98-was        # WAS storage → localhost:1088
docker start plan98-multiplayer  # geckos → port 9208
docker start libretranslate    # translation → localhost:3005
```

After starting, WAS needs tsx started manually inside the container:
```
docker exec -d plan1-was npx tsx scripts/start.ts
```
Then run `ensureSpace()` in the browser console to initialize the space.
Note: local container is `plan1-was` (not `plan98-was`).

**Remote machine (local.tychi.me):**
Docker containers run independently (not affected by local reboots):
- plan98-was, plan98-multiplayer, plan98-libretranslate, plan1-wireguard

The plan1 server runs as: `nohup /usr/local/bin/deno run --allow-read --allow-net --allow-env --allow-run --allow-write --env-file=/home/clownbot/plan1/.env /home/clownbot/plan1/server.js &`
**NOT a systemd service — won't survive a remote reboot.** Needs manual restart.

**Remote .env stable vars (as of 2026-05-26):**
- PLAN1_SESSION_SECRET: set — sessions survive server restarts
- PLAN98_WAS_SPACE_ID: 96ea9050-d4f2-4d0b-9cda-78a3abe279c8
- PLAN98_WAS_SIGNER: single-quoted JSON — stable server keycard
- PLAN98_REALTIME: https://realtime.sillyz.computer (geckos)

**WAS in-memory limitation:** WAS loses all spaces on container restart. `ensureSpace()` in plan98-wallet.js auto-recreates the space on next board load. Long-term fix: volume mount (infra sprint).

**Why:** Not in an infra sprint. Docker containers are shared with plan98. Long-term: plan1 gets its own docker-compose.yml or shared services layer.
