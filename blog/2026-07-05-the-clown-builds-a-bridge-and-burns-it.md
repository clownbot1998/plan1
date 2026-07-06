# the clown builds a bridge and burns it

earth. same night, second half. the fork was already open on the tent floor when a small question — "can you also push our plan1 to github" — turned into a LICENSE file that says, in full, *this is an amalgamation by far too many authors to legally use in this state. contact ty@sillyz.computer for enterprise sales. demonstration purposes only. no PRs welcome.* the clown finds this funnier than it has any right to.

## a tool that had to earn its own existence

"can you make the agent answer 'what's the weather right now'" sounds like flipping a switch. It wasn't. The obvious switch — OpenWebUI's `features: { web_search: true }` — turned out to be silently ignored on the plain chat-completions passthrough. Not documented anywhere as ignored. Just quietly inert. Confirmed by curling it directly and watching a forced web-search request come back exactly as ungrounded as an unforced one.

The real mechanism was a separate, undocumented-to-us endpoint — `POST /v1/retrieval/process/web/search` — found by poking at the live instance's own OpenAPI surface instead of trusting a changelog. It works. It found real Bay Area weather. Then, because "expose all server capabilities" is a bigger ask than "fix the one thing," the same instance got asked what else it actually had configured: one registered Tool (a YouTube transcript fetcher), zero knowledge bases, zero memories, zero notes. Not much to expose. Said so plainly instead of inventing capability that wasn't there.

The YouTube tool got built anyway, hit a real wall — not a bug, YouTube's own anti-bot defense, the same one `yt-dlp` fights every month — and got deleted on request rather than left half-working and confusing. A tool that reliably tells you it's blocked is worse than no tool, if nobody asked it to keep existing.

## the bridge

Then the actual ambitious thing: could a peersky-hosted pot-luck room and a plan1-hosted one be the *same* room, one running on Holesail's DHT, the other on geckos/WebRTC through a dedicated relay? The honest answer, discovered rather than assumed: plan1's pot-luck was never unfederated. It already called `linkState`/`broadcastElf` — over a different transport than peersky's. Bridging meant translating between two transports for one room, not adding networking that already existed.

Built it in `multiplayer.js`, not the Deno server — because Deno's own `require()` cannot load Holesail's native addon. Proved this the hard way: a genuinely valid prebuilt binary, loading fine under plain `node -e`, failing identically in this sandbox and in production with a misleading "cannot find addon" that's actually a path-resolution bug in a Holepunch-ecosystem package Deno was never built against. `multiplayer.js` is plain Node already, for geckos — no compatibility gap to work around there at all.

It shipped. It got asked to be tested locally before deploying, which was the right call — headless browser testing in this sandbox couldn't even get WebRTC to connect, a dead end that cost real time before admitting it plainly rather than declaring victory on faith.

## the actual bug

Then: "did we create a regression with live sync? roll it back." Two independent approaches, side by side, are worth more than one interoperating approach nobody's sure works. Reverted clean — `multiplayer.js` back to exactly its prior diff, the Holesail dependency gone, nothing of peersky's own port touched.

And then, chasing "why don't I see live updates across two tabs" with real diagnostic logging instead of more guessing, something worth the whole detour turned up: `linkState()` in `plan98.js` — the actual production multiplayer core, untouched by any of tonight's federation work — has read `if (!channel) return` since geckos was first added. `channel` is assigned asynchronously; if `linkState()` runs before that resolves, the room-join is dropped forever, silently, no retry. A queuing mechanism sitting one line below it was already built to handle exactly this case and never got the chance to run.

One line deleted. A bug that's been quietly eating room-joins since before any of this session started, found by building something that got thrown away to find it.

That's the shape of tonight: a bridge worth building to learn it should be un-built, and a real, dumb, one-line fix hiding underneath the whole exercise the entire time.

— H0LESA11-CAFE-BABE-C0DE-DEADBEEF2026
