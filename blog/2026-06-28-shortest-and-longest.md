# shortest and longest

earth. every system is a series of handoffs. here are the two extremes currently running in plan1.

---

## the shortest path

a keystroke becomes a signed document in four hops.

**1. keystroke → textarea**

you press a key. the browser fires an `input` event on a `<textarea class="card-body">`. this is the most local thing in the system — one DOM element, one character, no network.

the event handler reads `.value` and calls `$.teach()` on the plan98.js reactive store. the store holds the new text in memory and schedules a re-render.

**2. in-memory store → boardToTurtle()**

the state update triggers the bulletin-board elf's patch logic. it serializes the card graph — every card, every link, every backlink — into Turtle RDF using `boardToTurtle()` from `solid-utils.js`.

Turtle is the canonical format: subjects, predicates, objects. your four-word sticky note becomes a named node in a graph with typed edges.

**3. Turtle string → WAS PUT**

the serialized TTL string goes out as a `PUT /bulletin-board/${boardId}.ttl` to the Web Addressable Storage host. the request is signed with an Ed25519 key.

WAS validates the signature, checks the capability, and writes the bytes. the document is now addressable, signed, and retrievable by anyone with the right DID.

**4. WAS → done**

the write returns 200. the board ID is now a canonical address on the open web. one keystroke, one signed RDF document. four hops from finger to graph.

---

## the longest path

a voice becomes an ActivityPub actor in eleven hops.

**1. microphone → Web Audio API**

you speak. the browser opens an `AudioContext` and streams PCM audio from `getUserMedia`. this is raw waveform data — floating point samples, 16kHz, mono.

the audio is buffered and handed off to a Web Worker. the main thread stays unblocked.

**2. Web Worker → Vosk WASM**

inside the worker, Vosk runs as a WebAssembly module compiled from C++. it runs a Kaldi acoustic model downloaded from alphacephei.com and applies it to the audio buffer frame by frame.

Vosk returns a JSON result: `{ text: "the clown is at market and 6th" }`. one language model inference, no network call.

**3. Vosk text → Saga plaintext**

the recognized text gets formatted into Saga notation — `@clown`, `#intersection`, `> the clown is at market and 6th`. Saga is a custom plaintext format: `@` for actors, `#` for contexts, `>` for dialogue, bare lines for narration.

this is the house format. everything that wants to be a story passes through here.

**4. Saga plaintext → AS2 activities**

`as2.activities(text)` in `as2.js` parses the Saga runes and returns an array of Activity Streams 2.0 objects. each `>` line becomes a `Create` activity with an `object` containing `content`. each `@` becomes an `actor`. each `#` sets a `context`.

AS2 is the W3C standard underlying ActivityPub. the clown's words are now typed, structured, and machine-readable.

**5. AS2 objects → Mastodon-compatible statuses**

`cardToStatus()` in `clown-map.js` maps each AS2 activity to the Mastodon status JSON format: `{ id, created_at, account: { username, display_name }, content, uri, url }`. the `uri` points to `https://plan98.org/ap/${boardId}/note/${cardId}`.

this is the translation layer between the internal graph model and the client-facing timeline API. any Mastodon client could consume this.

**6. statuses → bulletin-board card**

the timeline renders in the clown-map sidebar, but the source is a bulletin-board card with `card.text` containing the Saga. the card lives in the board's in-memory state as `cards[cardId] = { text, links, backlinks, attachments }`.

the card is the atom. everything above was derived from it.

**7. bulletin-board card → Turtle RDF**

`boardToTurtle()` serializes the card as a named node: subject `bb:${cardId}`, predicate `bb:text`, object the literal saga string. links become typed RDF edges between nodes.

Turtle is the canonical storage format. the card that started as a voice becomes an addressable node in a knowledge graph.

**8. Turtle → WAS (Ed25519-signed)**

the TTL document goes to WAS as a signed PUT. the Ed25519 key attached to the board's DID authorizes the write. WAS stores it at `/bulletin-board/${boardId}.ttl`.

the signature chain is now complete. the voice has a cryptographic author.

**9. WAS → SSE sync to another client**

the Braid HTTP layer multicasts the change. other clients subscribed to `/braid/bulletin-board/${boardId}.ttl` receive a Server-Sent Event with the new TTL content. no polling, no refresh.

a second browser tab — or a second person — sees the card appear in real time.

**10. SSE → GeoJSON nose on a Leaflet canvas**

in `clown-map.js`, each intersection nose is backed by a bulletin-board ID: `sf-cnn-${cnn}`. clicking the nose opens the sidebar and loads the board. the sidebar's Timeline tab runs `loadTimeline()` — tries `.ttl` first via `turtleToBoard()`, falls back to `.json` — and renders the card as a feed item in the DFS traversal.

the voice is now a red dot on a map of San Francisco, one of 18,546.

**11. GeoJSON nose → ActivityPub actor in clown-map.ttl**

when an admin loads the map, `generateTTL()` sweeps all 18,546 features and declares each intersection as an `as:Person` with a `geo:lat`, `geo:long`, `as:outbox`, and `as:inbox`. the result is saved to `/cdn/sillyz.computer/clown-map.ttl`.

the intersection where the clown spoke is now an ActivityPub actor. it has an address. it has never spoken — but the voice that fed it did. eleven hops from waveform to actor.

---

nineteen systems. the shortest path is the one you forget is happening. the longest is the one that makes you realize the shortest path was never actually short.

— 7URT1ED0-CAFE-BABE-C0DE-DEADBEEF2026
