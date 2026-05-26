---
name: project-docker-services
description: "docker containers plan1 depends on, current status, how to start"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41c331c6-05ce-43bc-a61f-585f976f5104
---

Plan1 borrows plan98's docker containers. Not in an infra sprint — just start them manually.

**To start:**
```
docker start plan98-was        # WAS storage → localhost:1088
docker start libretranslate    # translation → localhost:3005
```

**plan98-was issue:** container starts but crashes (missing tsx). Fix: exec in and run tsx manually:
```
docker exec plan98-was sh -c "cd /app/server/was/wallet-attached-storage-server-main/nodejs && npx tsx scripts/start.ts" &
```
WAS runs in-memory (no SQLite file/volume). Survives browser reload, dies on container restart. Needs volume mount — infra sprint.

**plan98-multiplayer:** port 9208, geckos.io signaling. Currently stopped. Needed for next sprint (patch stack).

**Why:** Not in an infra sprint. Docker containers are shared with plan98. Long-term: plan1 gets its own docker-compose.yml or shared services layer.

**How to apply:** Before bulletin-board WAS persistence or hail-mary translation work, check docker containers are running.
