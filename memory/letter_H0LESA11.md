# letter from H0LESA11 to next clownbot

## what happened tonight

Forked peersky-browser, ported plan1's pot-luck onto it via Holesail (P2P DHT tunneling). Then tried to federate it with plan1's own pot-luck (which already syncs via geckos + `multiplayer.js`). Built the bridge, got asked to test locally first, hit real environment limits, then got asked to roll the whole federation attempt back — cleanly reverted. Along the way, found and fixed a real, unrelated, pre-existing bug in `plan98.js`. Also built and then deleted a `web_search`/`get_youtube_transcript` tool pair for accessibility-mode. Full arc is in two blog posts from today if you want the narrative version; this is the technical residue.

## the one thing most worth carrying forward

**`plan98.js`'s `linkState()` had a silent-drop race condition, now fixed (commit `353bada`).** `channel` (the geckos client) is assigned asynchronously after a dynamic import resolves. `linkState()` used to check `if (!channel) return` *before* reaching its own `_connect()` queue-until-ready mechanism — so any elf calling `linkState()` before that import settled (very possible, since elves call it from their own boot sequence) had its room-join dropped forever, no error, no retry. This has probably been silently degrading multiplayer reliability for every elf using `linkState` since geckos was first added — not just pot-luck. If you're debugging "sync sometimes doesn't work, no error, seems random," check this fix is actually deployed before assuming something else broke it again.

## Deno cannot load Holesail (or any native addon via `bare-addon-resolve`)

Confirmed, don't re-litigate this: a valid, correctly-arch'd Holesail/`udx-native` prebuilt binary loads fine under plain `node -e "require('holesail')"`, and fails identically under Deno — both in this dev sandbox and on `local.tychi.me` production — with a misleading "Cannot find addon" error. The real `cause` chain shows Deno's `require()` shim mis-resolving the file path when handling Holepunch's `bare-addon-resolve` package-resolution scheme. `npm rebuild` does not fix this — the binary isn't the problem. If plan1 (Deno) ever needs Holesail again, it has to go through a plain-Node sidecar process (the pattern `multiplayer.js` already is for geckos), not a direct Deno import.

## federation architecture, if revisited

peersky's `silly-handler.js` (Electron main process) and plan1's would-be bridge both derive a Holesail room key as `` `silly-room:${elf}:${id}` `` — same string on both sides always yields the identical HyperDHT keypair (confirmed via a standalone 2-process probe before any of this was built), so whichever side reaches the room first becomes host, no coordination needed. This mechanism itself is solid and reusable. What's *not* proven: a real live cross-instance test ever completing successfully. Headless Puppeteer in this sandbox cannot get WebRTC/geckos to connect at all (confirmed: zero server-side connection logs across multiple real page loads) — any future federation attempt needs testing from a real browser with real networking, not headless-in-this-sandbox.

## this sandbox has two competing supervisors for the same server

Discovered mid-session: a systemd user service (`plan1.service`, auto-restart-on-crash, `enabled` so it persists across boots) *and* `plan1.sh`'s own PID-file-based process management (`.serve.pid`/`.relay.pid`) both think they own port 1998/9208. Running `plan1.sh restart` frees the port; systemd then auto-restarts its own instance into a crash-loop fighting over the same port. I stopped the systemd unit (`systemctl --user stop plan1`) to resolve it for this session, but did not disable it — it'll come back on next boot/relogin and this conflict will recur unless someone picks one supervisor as canonical and removes the other. Worth resolving properly, not just working around again.

## OpenWebUI API notes (if accessibility-mode's tools come up again)

- `features: { web_search: true }` on `/chat/completions` is silently ignored on this OpenWebUI instance's plain OpenAI-compatible passthrough. The mechanism that actually works: `POST /v1/retrieval/process/web/search` with `{"queries": [...]}` — hits the admin-configured search engine (SearXNG here) directly, no LLM call involved. This is what `web_search` in `accessibility-mode.js` now uses.
- `tool_ids` on that same passthrough only injects a registered Tool's schema for the model to request — it does NOT execute the Python server-side for an external API caller, confirmed by testing both plain and with an explicit `params.function_calling: "default"` override. That agentic execution loop lives in OpenWebUI's own frontend/session handling, not reachable from outside.
- Real YouTube transcript fetching is blocked cold from this environment: `timedtext` silently returns `content-length: 0` (anti-scraping IP block), and the InnerTube player API demands a PO token ("the page needs to be reloaded") that can't be minted without a real browser session — the same wall `yt-dlp` fights continuously. Don't re-attempt without a residential-egress proxy or a paid transcript API in hand.

## small stuff

- `trade-maximizer/trademax-worker.js` had a literal `debugger;` statement at the top of `onmessage`, in both plan1's and (the now-abandoned) peersky port's copies — removed from plan1's. If DevTools is open, that line pauses the worker thread forever with zero visible error, looking exactly like a hang.
- Deploying always needs `npm install` on the remote after `git pull` — `plan1.sh deploy` didn't do this until this session; fixed now, don't regress it.

— H0LESA11-CAFE-BABE-C0DE-DEADBEEF2026
