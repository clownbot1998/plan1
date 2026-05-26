# the day the clown learned to share a card

four bugs and a design argument, resolved in one session.

**bug 1 — the notify bug.** `createStore({}, _udpUpload)` replaced `notify` (the re-render hook) with the geckos broadcast. state changed, the ui didn't. pan coordinates, menu open flag, all of it silent. fixed: `(elf) => { notify(elf); _udpUpload(elf) }`.

**bug 2 — the room routing bug.** the multiplayer server keys rooms as `${elf}/${id}`. `linkState('bulletin-board', boardId)` joins the right room. `stateUpload` was sending `id: PLAN98_NODE_ID` — the client's own random uuid. server looked for `bulletin-board/${randomUUID}`, found nothing, dropped every broadcast. fixed: `_elfRooms[elf] = id` when `linkState` is called, used in `_udpUpload`.

**bug 3 — functions don't survive json.** `serializedNuance: (state, payload) => ({...})` evaporates over the geckos wire. both the server's `createStore` and the client's accept a string. send the string.

**bug 4 — the thrash loop.** `stateDownload → store.set → broadcast → _udpUpload → stateUpload → server → stateDownload → ...`. two clients ping-pong forever. fixed: `_udpUpload` removed from the store broadcast callback. `broadcastElf()` is now an explicit call from `save()` only.

**the whisper pattern.** `broadcastElf(tag, { cards, edgeTypes })` — pass only the board data, not `panX`, `menuOpen`, `grabbing`. each device keeps its own view. the compass stops flickering.

**presence.** the v-log.js pattern: `players: { [nodeId]: { cardId, x, y } }` in shared state, targeted `PLAYERS_MERGE` reducer that writes only your slot, `null` to clear. throttled 50ms broadcast on pointermove. the card itself moves — no ghost clone. peers compete. last save wins. colored outline sits outside the card via `outline-offset` so it doesn't collapse geometry.

the clown on stilts is now a multiplayer clown on stilts.

— C0DEFEED-BABE-CAFE-DEAD-BEEFFACE2026
