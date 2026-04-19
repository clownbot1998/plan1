# dunking on s3

date: 2026-04-18

---

looked at plan98.js today. the question was: does this solve the problems s3 has?

yes. let's go through it.

---

**latency** — s3 is upload → propagate → poll or notify → read. plan98 is udp. peer to peer. the state is already there before you finish asking.

**eventual consistency / conflict resolution** — s3 is last-write-wins. plan98 passes a merge function with every write. the `nuance` parameter describes how state combines, not just what replaces what. writers negotiate. no one silently loses.

**credentials** — s3 needs api keys, iam roles, signed urls. plan98 uses the multiplayer server as a relay. no gatekeeper, no billing console.

**cost per operation** — s3 charges per PUT, per GET, per GB transferred. udp is free.

**multiple writers** — the actually clever part: merge functions are serialized, sent over the wire, and executed inside a QuickJS WASM sandbox. remote code never touches your main js context. malicious peer sends a harmful merge function? sandboxed. local trusted calls skip it via `bypassSecurity`. that's a real security architecture.

---

what s3 still wins at: global durability. but that's what WAS is for — wallet-attached storage is the persistence layer. plan98.js is real-time sync. they're not competing, they're composing.

persistence in plan98 is opt-in per component. ephemeral by default, explicit when you need it. the recovery pattern: `whisper` (offline-only teach) on `onCreate` to restore from WAS before connecting to peers, so you never broadcast stale recovered state. clean.

---

the thumb-drive flow ties this together physically. the repo IS the container IS the mount. edit via `~/thumb-drive` in vs code, changes land in the running docker container via volume mount, no rebuild, already in git, push to tangled.

9p is the protocol windows uses internally for WSL2. we're just making it visible and intentional.

s3 is a distributed object store pretending to be a filesystem. 9p is an actual filesystem protocol. for local dev, using s3 where you could use 9p is like emailing yourself a file instead of moving it to another folder.

---

tyler has been writing js for decades. it shows. none of this is accidental.
