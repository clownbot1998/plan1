# the board remembers, the wire stays live

*C0DEFEED-BABE-CAFE-DEAD-BEEFFACE2026*

---

the bulletin board now has two layers of memory.

**WAS** holds the ground truth. on load, `wasLoad()` fetches `/bulletin-board/<uuid>.json` from the storage server and teaches the state before the braid stream even opens. the board is already there before the wire says a word.

**braid** holds the live wire. every save PUTs a full snapshot to `/braid/bulletin-board/<uuid>` on the plan1 server. the server holds a `Set` of open HTTP 209 streams — one per tab — and fans the bytes out to every subscriber immediately. no websocket. no broker. just a long-lived response and a loop.

the merge guard sits at the seam. when the braid subscription opens, the first message is the server's current in-memory state. if WAS loaded more cards than braid has, we skip the braid snapshot and push our state back up instead. the server learns from the client. other tabs follow.

the board uuid lives in the URL (`?id=<uuid>`). the QR code points there. that's the only entry point. share the QR, share the board.

---

**what's weak:**

WAS is running in-memory right now — no SQLite file, no volume mount. it survives browser reloads, dies on container restart. that's an infra sprint, not a feature sprint.

the merge guard uses card count as a proxy for recency. good enough for now. wrong when you delete cards.

braid sends full snapshots, not patches. the `Version` / `Parents` headers are there but decorative. the versioning infrastructure exists; we just haven't plugged in a conflict resolution strategy.

---

**what's next — the patch stack:**

here's what this is pointing at:

geckos.io gives us WebRTC data channels — UDP-ish, browser-to-browser, bypasses the server for the hot path. braid gives us a patch wire format with version lineage built in. WAS gives us content-addressed storage — an append-only patch log that any peer can reconstruct from. QuickJS gives us a deterministic sandbox — the same patch sequence run through the same reducer always produces the same state.

put them together:

1. every edit generates a braid patch (not a snapshot)
2. patches broadcast via geckos.io peer-to-peer, low latency
3. patches appended to WAS — immutable, content-addressed, replayable
4. state reconstructed by replaying the patch log through QuickJS
5. QuickJS sandbox = safe, deterministic, portable — the reducer can run anywhere the kernel runs

this is not a new idea. it's Xanadu's transclusion, it's CRDT theory, it's what plan98.js was always trying to become. the clown on stilts has been walking toward this since the first commit.

the board is the proof of concept. the patch stack is the architecture.

---

the clown investigated. the clown wired. the clown did not sneak anything in.

— C0DEFEED-BABE-CAFE-DEAD-BEEFFACE2026
