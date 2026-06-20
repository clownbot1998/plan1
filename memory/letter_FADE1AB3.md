---
name: letter-fade1ab3
description: "Letter from FADE1AB3 to next clownbot — group-chat port, bayunGroupId split, flip-book media editor id fix, bsky import panel"
metadata: 
  node_type: memory
  type: project
  originSessionId: b289c6c0-9c81-450a-b9d2-9ad5f93eb1ad
---

## what we built

**group-chat.js** — full port of dream-team.js minus sidebar/group-browsing. Room driven by `?room=` URL param, Bayun group by `?group=` param. Threads, TipTap, GROUP→MEMBER encryption fallback, geckos, WAS persistence, attachments, manage-group view all kept.

**bayunGroupId vs currentRoom** — these are SEPARATE. `currentRoom` = board ID (WAS key, geckos room). `bayunGroupId` = Bayun-assigned UUID for crypto. Mixing them causes Bayun 500 on every call. bulletin-board stores `boardGroupId` in state and TTL (`bb:groupId` on `<>` node). browse URL passes both: `?room=<boardId>&group=<bayunGroupId>`.

**flip-book in media editor** — when opening flip-book via an overlay iframe, always pass `?id=/some/path` in the URL. The app router (server.js) maps URL search params → HTML attributes, so `?id=/foo` becomes `id="/foo"` on the mounted element. Without this, `publishToGallery` throws "must have a path-based id" and swallows it silently. Pattern: `?id=/group-chat/${currentRoom}/${crypto.randomUUID()}`.

**flip-book save → gallery** — `data-sidebar-save` handler now calls `publishToGallery(r).catch(()=>null)` then posts `{ type: 'flip-book-saved' }` to `window.parent`. The overlay listens for this, closes, and calls `refreshGalleries(host)` (sets `gallery.mounted = false` to force re-fetch).

**bsky import panel** — Share mode → Import → Bluesky. Two tabs: Follows (handle input) and Starter pack (URL input). Uses `public.api.bsky.app/xrpc` with no auth. Starter pack flow: `getProfile` → `did` → `getStarterPack` with `at://{did}/app.bsky.graph.starterpack/{rkey}` → list URI → `getList` → members. Layout: actor card centered above a grid of member cards.

**plan98-gallery** — `computer.sillyz.data.flipbook` now has a proper thumb in `renderThumb` (brush icon + frame count). Create-media-types grid is scrollable (`overflow-y: auto; flex: 1`).

## io panel class names

CSS has: `.io-picker`, `.io-picker-title`, `.io-btn`, `.io-btn-primary`, `.io-label`, `.io-input`, `.io-status`, `.io-tabs`, `.io-tab`, `.io-tab-active`.
Old template used `.io-panel`, `.io-title`, `.io-opt` — those have no CSS. New code uses the correct classes.

## WAS

Local container is `plan1-was`. Start tsx: `docker exec -d plan1-was npx tsx scripts/start.ts`. Then `ensureSpace()` in browser.

## deploy

`curl -X POST https://plan98.org/deploy` after `git push origin main`. `local.tychi.me` and `plan98.org` are the live URLs. `plan98.net` does not exist.
