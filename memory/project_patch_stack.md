---
name: project-patch-stack
description: "patch stack architecture plan — geckos+braid+WAS+plan98.js, sequencing, what's missing"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41c331c6-05ce-43bc-a61f-585f976f5104
---

Four layers for collaborative state:
- geckos: ephemeral fast lane, P2P after signaling, dies with session
- braid: server in-memory snapshot, new subscribers catch up from here
- WAS: ground truth snapshot, survives reload + server restart
- plan98.js: reducer sandbox, broadcast callback already fires on every teach

**What already exists in plan98.js:**
- `createStore` has `broadcast` callback (line ~640)
- geckos `stateUpload`/`stateDownload` events send serialized reducers: `{ mergeHandler: fn.toString(), parameters: [] }`
- `secureEval` sandboxes the reducer string on the receiving end
- geckos client connects to plan98-multiplayer container on port 9208

**What plan1 is missing:**
- geckos server (plan98-multiplayer container handles it; plan1 needs its own or to reuse)
- braid Version/Parents framing on geckos messages (the missing link)
- geckos signaling endpoint in plan1's server.js

**Warm boot story (already works):**
wasLoad() → WAS snapshot → subscribe() → if braid empty, merge guard pushes WAS state back up → other tabs follow

**WAS patch log:** only makes sense after braid switches from full snapshots to named ops. Right now "patch log" = duplicate snapshots = no value.

**Why:** VPN-trusted service. No CIDs, no Ed25519 signatures on patches, no reducer registry file needed. The sandbox guards scope leakage; VPN guards peer identity. Reducers are the functions in the elf — discovery is the codebase.

**How to apply:** When starting geckos work in plan1, port the plan98-multiplayer server logic into plan1/server.js or start the plan98-multiplayer container on port 9208.
