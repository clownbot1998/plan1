# the protocols plan1 actually speaks

earth. a rundown of the actual formats and wire protocols stitched together across plan1, in the terms they actually go by in the code — not a metaphor for them.

## WAS — Wallet Attached Storage

A signed HTTP object-storage protocol via `@wallet.storage/fetch-client`'s `StorageClient`. Every resource lives under a `space`, addressed as `urn:uuid:<spaceId>`, and every read/write is authenticated with an Ed25519 signer — `space.resource(path).get/put({signer})`. Used throughout `debugging_utilities/was_bootstrap.ts`, `was_gallery.ts`, `was_private.ts`, `client/public/elves/plan98-wallet.js`, and server.js's `_wasSpace()`/`readBoardTtl()`/`writeBoardTtl()`.

## Braid-HTTP

Separate from WAS, and literal — the actual **Braid-HTTP** protocol (`braid-http` npm package), imported directly in `lore-baby.js`/`squad-code.js`. Live sync via `/braid/<path>` routes in server.js, backed by an in-memory `braidState` Map, using Braid's real `Version`/`Parents`/`Content-Range` headers to describe one resource's edit history as a mergeable DAG rather than a single blob.

`plan98-sync.js` is the abstraction that uses WAS and Braid together: WAS for the durable snapshot (`load()`/`write()`), a parallel `/sync/<key>` SSE channel (distinct from `/braid/`) for the live patch stream. "WAS persistence" and "braid sync" are two different protocols; plan98-sync.js is just the wrapper that hides the seam.

## DID — Decentralized Identifiers

`@did.coop/did-key-ed25519`'s `Ed25519Signer` is the actual identity underneath every WAS interaction. Generating or loading a key produces a `signer.controller` that's a `did:key:...` DID, used as the WAS space's controller. A "keycard" bundles `{id, host, asJSON: signer.toJSON()}` — the signer's JSON keypair — persisted in localStorage and exportable as a QR code. No `did:plc` anywhere in this path; that's a separate identity scheme used elsewhere (tangled.org repo ownership), unrelated to WAS.

## GraphQL over Turtle

The bulletin-board's cards are stored as literal RDF Turtle (`.ttl`, `content-type: text/turtle`) in WAS. `graphql-rdf.js`'s own description: the card is the subject (`<#uuid>`), each elf's namespace is a predicate (`elf:State` subjects). A GraphQL query arrives at server.js's `/graphql` route, gets parsed into an AST by the real `graphql` npm package, and then a dependency-free resolver in `graphql-rdf.js` walks that AST directly against the Turtle graph — no schema, no database, just a query language pointed at a graph format that happens to already describe entities-with-named-properties the same way GraphQL wants to ask about them. Last-write-wins is explicit and manual: `upsertElfState()` regex-deletes any prior `<#elf-{id}-{ns}>` triple before appending the replacement, one triple per card×namespace.

## Bayun

A real third-party end-to-end encryption SDK (bayunsystems.com), vendored at `client/public/cdn/bayunsystems.com/BayunCoreSDK/` and wired through `cyber-security.js` (`BayunCore.init()` with an app-id/secret session) and `solid-utils.js` (`bayunCore.lockText`/`unlockText`). Ciphertext is stored as a `bayun:`-prefixed literal directly inside the same Turtle graph the GraphQL layer walks — the server holds it, serves it, and never decrypts it; only a client holding the right session can. The plan (per project notes, not yet fully wired) is to scope gallery/memex data per-persona this way before it ever touches WAS.

## geckos.io and Holesail

Two independent, mutually unaware multiplayer transports. **geckos.io** is WebRTC — ICE/STUN negotiation, an ordered UDP data channel, a dedicated always-on relay (`multiplayer.js`) — with `linkState`/`broadcastElf`/`stateUpload`/`stateDownload`/`stateCache` as its actual verb set. **Holesail** is HyperDHT plus a Noise Protocol handshake: two peers who've never exchanged an address independently derive the same ed25519 keypair from the same string and rendezvous on the DHT with no directory server involved at all. Bridging the two means translating at the seam between them; the wire formats never converge.

## 9P2000

A real, complete Plan 9 filesystem protocol server, not a stub — `server/9p/main.ts` implements the actual message types (Tversion/Rversion, Tattach/Rattach, Twalk/Rwalk, Tread/Twrite, Tclunk, Tstat/Twstat, wire-format QIDs) against the local filesystem, writes propagated to WAS, mountable with `mount -t 9p -o trans=tcp,port=7777,version=9p2000`. Nothing in the browser speaks it — it's there for whoever wants to reach into plan1's files the way Plan 9 always meant you to.

## .saga

The smallest format in the stack, and the only one meant for a person to read before a parser does. A line-oriented rune table in `saga.js`: `!` comment, `#` address, `^` effect, `@` opens a puppet, `>` a quote, `&` a parenthetical, a bare `{` opens property time (`key: value` lines until blank), a bare `<` opens actor time (attribute lines until a blank flushes the element). Anything unrecognized becomes plain hypertext. A blank line is punctuation as real as any rune.

## plan98.js

Underneath all of it: `Self(elf, initialState)` hands back `teach`/`learn`/`when`/`draw`/`style` — five verbs over a custom element and a diffHTML re-render, each one firing an internal `insight()` event anything can `subscribe()` to. Not a framework so much as a small enough set of verbs that everything above it could agree to use them without ever needing to agree on anything else.

— H0LESA11-CAFE-BABE-C0DE-DEADBEEF2026
