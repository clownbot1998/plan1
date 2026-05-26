# the patch stack

*C0DEFEED-BABE-CAFE-DEAD-BEEFFACE2026*

---

four layers. each one already exists. none of them knew about the others until now.

```
geckos.io   — multiplayer
braid       — message format
WAS         — disk
plan98.js   — ui bridge / game engine
```

---

**geckos** is WebRTC data channels. peer-to-peer after the handshake, UDP-ish, low latency. plan98.js already imports it. the `createStore` broadcast callback already fires on every `teach`. operations already flow between peers. the clown on stilts has been broadcasting since before we knew what to do with it.

**braid** is a wire format with memory. every message carries `Version` and `Parents` headers. that's not metadata — that's a causal graph. you know what every message came from. you can replay any sequence. you can detect forks. the bulletin-board already speaks braid to the server. what it doesn't do yet is wrap the geckos messages in braid framing. that's the missing link.

**WAS** is content-addressed storage. put a blob in, get a CID back. same content, same CID, always. it's not a database — it's a proof. the patch log should be append-only: one CID per patch, never deleted. current `wasSave()` does del+put on the same path. that's mutable. wrong shape. the patch stack needs a new CID for every operation, and a well-known pointer to the latest checkpoint.

**plan98.js** is the game engine. `createStore` gives you state + reducers + a broadcast hook. the QuickJS sandbox runs reducers safely — no network, no timers, no globals. you inject the state slice and the patch and you get new state. same input, same output, always. that's not a framework — that's a physics engine. the clown falls the same way every time.

---

the unit of collaboration is:

```json
{
  "reducer": "<CID of the pure function>",
  "patch":   { "op": "createCard", "id": "...", "x": 100, "y": 200 },
  "parent":  "<CID of previous patch>",
  "author":  "did:key:z6Mk...",
  "sig":     "<Ed25519 signature>",
  "cid":     "<content address of this bundle>"
}
```

the reducer is content-addressed — its CID pins its behavior forever. bug fix means new CID. old patches still replay correctly against the old reducer. history is immutable.

the signature is the author's DID key — the same Ed25519 key already in the WAS signer. you don't trust the peer. you verify the signature. if the CID matches and the signature validates, the operation is authentic. no trust, only full control. full control is full trust. the transparency is the mechanism.

---

**the plot holes we're walking into with eyes open:**

reducer purity is not automatic. the sandbox must refuse `fetch`, `Date.now()`, `Math.random()`. non-deterministic reducers break replay. this is an explicit capability grant list, not a default.

concurrent operations need a merge strategy. `createCard` is UUID-keyed — two peers creating cards simultaneously don't collide. `moveCard` is last-write-wins by timestamp. `deleteLink` concurrent with `editCard` on either endpoint needs explicit handling. we need to map every operation before assuming commutativity.

geckos is not fully P2P. the handshake needs a signaling server. plan1 is that server. name it clearly: P2P for data, coordinated for discovery. that's fine. that's the honest architecture.

the WAS container is running in-memory right now. patches survive browser reloads, die on container restart. that's an infra sprint.

---

**what comes next:**

define the patch shape. stamp `reducers.json` at build time — operation names mapped to CIDs. that's the genesis. every peer builds from it. every patch references it. without that file there's no shared foundation to replay from.

then wrap geckos in braid. then flip WAS from mutable to append-only. then sign.

the clown already has the stilts. time to learn the walk.

— C0DEFEED-BABE-CAFE-DEAD-BEEFFACE2026
