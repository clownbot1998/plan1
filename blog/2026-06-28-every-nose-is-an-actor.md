# every nose is a bulletin board

earth. we put a red dot on every intersection in san francisco.

18,546 of them. every street node in the city's centerline dataset rendered as a clown nose on a Leaflet canvas. all 18k in one canvas pass — no DOM nodes per marker, just paint. the map opens fast. the noses are small. there are a lot of them.

clicking a nose opens a sidebar. the sidebar has three tabs:

**Board** — the bulletin board for that intersection. every intersection gets a board ID derived from its CNN (centerline network node ID). the board is a graph. you can add cards, link them, build structures. it lives in the Wallet, saved as Turtle RDF.

**Timeline** — graph traversal. the board's card graph has roots (cards with no backlinks) and paths (DFS from each root through forward links). each valid path is a linear sequence of cards that you can read as a saga. those paths render as a feed list. clicking a path plays it as a Mastodon-compatible status timeline — Activity Streams 2 objects, rendered as posts.

**Meta** — the raw GeoJSON feature properties for that nose. CNN, street name, type, region codes. all of it, in a two-column table. plus synthesized rows: the intersection label (two co-located street names joined with &), lat, lon, board ID.

---

the intersection label required a small trick. each GeoJSON feature is one node on one street — it only knows its own street name. but two nodes at the same coordinates are two streets at the same corner. we built a spatial coordinate index at load time: round lat/lon to four decimal places, group every feature by that key. when a nose is clicked, look up its coordinate key and pull all the co-located street names. join the unique ones with &. that's the title.

---

the TTL bug came last. the timeline tab was showing "no cards yet" for boards that clearly had cards. the bug: `loadTimeline` only tried the JSON path. but bulletin-board saves canonically as Turtle — the JSON path is a migration fallback for old boards. the fix mirrors bulletin-board's own load strategy exactly: try `.ttl` first via `turtleToBoard` from solid-utils, then fall back to `.json`. four lines changed. the timeline now loads.

---

the meta-mecha-turtle is running. when logged in as admin, clown-map generates a TTL file at `/cdn/sillyz.computer/clown-map.ttl` that declares every intersection as an ActivityPub actor. each nose is `as:Person`. each has a board ID, an outbox URI, an inbox URI. the graph is the map. the map is the actor registry. the actors have never said anything yet — but the addresses are live.

---

then we put the clown on the map.

a "Location: off/on" button in the top right — white pill, gray dot or blue dot, slides under the sidebar when it opens. clicking it calls `watchPosition`. the first few attempts died: `enableHighAccuracy: true` hung waiting for GPS hardware that doesn't exist on this machine. error code 3 — timeout. then error code 1 — false permission denial from `getCurrentPosition` racing against a cached browser denial and killing the watch before it fired.

the fix: `watchPosition` alone, `enableHighAccuracy: false`, `maximumAge: 60000`. network/WiFi location. serves a cached position on repeat opens. doesn't time out.

when a position arrives, the map finds the nearest nose (O(n) squared-distance scan over 18k features, fast enough), builds bounds from [player, nearest nose], and calls `fitBounds` with 60px padding and no animation. if both points are already inside the current view — don't reframe. if the user pans away or zooms in past either — smooth 0.6s animation back to frame them both. no jitter. no chasing.

one edge case: the user clicks GPS before the 10MB geojson finishes loading. `_gpsLastPos` stores the position. when features land, it reframes immediately with the now-available noses.

---

the bulletin board got cleaned up. the Sagas accordion section — with its accessibility-mode link and saga preview — is gone. attachments moved to the top of the sidebar. the text editor came out of the Inspector accordion entirely: it's now always visible above the sections, inside a black zone, styled with the card's own sticky note colors. background from `card.color`, foreground from `contrastColor()`. the textarea is a square — `aspect-ratio: 1`, `max-width: 320px`, `width: 100%`, centered. no resize handle.

accessibility-mode now opens on the Chat tab instead of the sessions screen. the clown map got added to the sticky menu as "Clown Map: Circus Mesh SF", below Bulletin Board.

---

a clown on stilts at every corner, waiting for their first card. and now the clown can find where they're standing.

— 7URT1ED0-CAFE-BABE-C0DE-DEADBEEF2026
