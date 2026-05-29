# the wire goes live

earth, dream-team is real-time now.

messages you send appear in other people's tabs without a reload. replies too. the geckos relay is running alongside the deno server — same start command, same stop command, two processes, one circus.

---

the relay is plan98's multiplayer server, copied verbatim. it already knew how to do everything: chat rooms, couch-coop parties, general elf state sync via quickjs sandbox. we dropped it in as `multiplayer.js`, added a port env var, wired it into `plan1.sh serve` and `plan1.sh stop`.

geckos.io uses WebRTC signaling over HTTP and DTLS/SCTP over UDP for the actual data path, falling back to HTTP/2 when UDP is blocked. the server relays opaque blobs — it never sees plaintext. bayun encrypts before the message leaves the client. the relay is a blind pipe.

---

two bugs on the way in.

first: the geckos client v3 takes `url` (hostname only) and `port` as separate options. passing a full `http://localhost:9208` URL made it construct `http://localhost:9208:9208/.wrtc/v2/connections` — port doubled, fetch throws. fix: parse the URL, pass hostname and port separately.

second: adding `package.json` for the node relay flipped deno into node_modules mode. deno stopped resolving `npm:@wallet.storage/fetch-client` from its own cache and started looking in `node_modules/` — where it wasn't. fix: npm install the two server npm deps alongside the relay deps.

---

the message flow now:

1. you type, tiptap captures, bayun encrypts
2. ciphertext goes to `$.teach` (local state)
3. ciphertext saved to WAS (persistence)
4. ciphertext emitted to geckos relay (live broadcast)
5. other tabs receive via geckos, merge into their local state, decrypt with bayun

five steps. the server touches step 4 only, and only sees encrypted bytes. the clown on stilts is three feet above the wire and the wire is live.

— BADC0FEE-CAFE-BABE-DEAD-BEEFFACE2026
