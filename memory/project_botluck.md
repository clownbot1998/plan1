---
name: project_botluck
description: botluck — standalone realtime pot-luck fork of plan1 at ~/botluck; push to tangled is blocked on repo creation
metadata: 
  node_type: memory
  type: project
  originSessionId: de81fc9c-7464-4399-92d7-af80629ce61a
---

`~/botluck` — a standalone, secure, pot-luck-only fork of plan1. New git repo (own `.git`), boots straight to `<bot-luck>` (renamed from plan1's pot-luck.js). Realtime via geckos rooms (user chose realtime over local-only).

**Structure:** `server.mjs` = express static (SPA fallback) + geckos relay (linkState/stateUpload only) — the ONLY dynamic surface, no exec/admin/WAS. `storage.mjs` = per-room server store. `public/` = index.html (stripped boot + importmap), plan98.js, cache.js, plan98-shims.js, vendor/ (diffhtml + quickjs-emscripten + @geckos.io/client, copied from plan1 dist/vendor, 34M), elves/bot-luck.js + elves/trade-maximizer/. Run: `npm install && npm start` (http :8088 via BOTLUCK_PORT, relay :9208).

**Sync design (bot-luck.js):** each `?id` is an isolated potluck AND a geckos room. Shared data (users/offerings/wishes/lastMatch + `_v` timestamp) syncs via plan98 `linkState(tag,id)` + `broadcastElf(tag,{snapshot})`. UI/identity (screen/modal/matching/loading + activeUserId) kept in module vars OUT of the synced store (plan98 syncs the whole store entry, so UI flags would get clobbered). activeUserId per-device via localStorage. LWW by `_v`. nextId uses random suffix (no shared seq).

**Status (2026-06-25):** 2 commits on `main`. Local reactivity bug FIXED + verified (creating a user updates sidebar immediately, no reload) — root cause was geckos whole-state sync clobbering UI flags + broadcast running before redraw. **Push BLOCKED:** `git push -u origin main` to `tangled.org:clowncode.bsky.social/botluck` fails — repo must be CREATED on tangled first (web UI). Remote already set. **Cross-client realtime sync UNVERIFIED** — headless chromium can't establish geckos WebRTC (virtual-time breaks it; relay saw zero connections). Must test in 2 real browsers. If sync fails for real: check geckos `:9208` reachable + https page → http geckos mixed-content (README documents STUN/TURN + PLAN98_REALTIME). Left a dev server running on 8088/9208.

Related: the pot-luck origin is [[project_plan98_env_live_keys]]-adjacent work in plan1 (elves/pot-luck.js, blog "the table that finds the trades").
