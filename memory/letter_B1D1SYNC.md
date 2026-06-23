---
name: letter-b1d1sync
description: "Letter from B1D1SYNC to next clownbot — plan98-sync, my-sagas, drop-saga accessibility iframe, bi-directional SSE sync"
metadata: 
  node_type: memory
  type: project
  originSessionId: 578774c4-3882-4b96-aeea-bb085b7f908f
---

letter from `B1D1SYNC-CAFE-BABE-C0DE-DEADBEEF2026` — 2026-06-20

## what we built

**`plan98-sync.js`** — `createSync(key)` → `{ load, write, subscribe, destroy }`. WAS snapshot on load, /sync/ SSE for live fanout. any elf can use it for cross-tab state without rolling their own flush queue.

**`my-sagas.js`** — shared saga store. paths: `/my-sagas/${id}.saga` (plaintext), `/my-sagas/${id}.json` (session: messages+history), `/my-sagas/index.json` (manifest). exports: `getSaga`, `putSaga`, `subscribeSaga`, `loadSession`, `saveSession`, `subscribeSession`, `scheduleFlush`, `upsertManifest`, `removeFromManifest`, `messagesToSaga`. accessibility-mode delegates here.

**`Saga(x, options)`** — `options.actor({ tag, props, innerHTML, innerText })` hook in saga.js. falls through for `text`/`html` props. accessibility-mode uses `embedStub` to render media as dodgerblue clickable `<a>` stubs.

**drop-saga accessibility tab** — iframe: `/app/accessibility-mode?id=${id}&saga-path=/drop-saga/${id}/index.saga`. `?saga-path=` tells accessibility-mode where to read/write instead of defaulting to my-sagas namespace.

## the bi-directional sync pattern

- drop-saga `mount()` opens `EventSource(/sync/drop-saga/${id}/index.saga)` → updates `sagaText` state live
- drop-saga `putSaga()` writes to WAS + broadcasts to `/sync/drop-saga/${id}/index.saga`
- accessibility-mode `wasSave()`: when `_overrideSagaPath` is set, puts saga text to that path + broadcasts there
- result: edit in either window, both update within the SSE round-trip (~instant)

## namespace separation

drop-saga owns `/drop-saga/${id}/index.saga` — do NOT migrate it to my-sagas paths again. the my-sagas migration broke everything because existing WAS data was at the drop-saga path. accessibility-mode uses my-sagas namespace for its own standalone sessions; it reads drop-saga's namespace only when embedded via `?saga-path=`.

## /sync/ server route

in-memory `syncState` Map. GET = SSE subscribe with current state. PUT = replace + broadcast to all subs. no disk, no auth. distinct from /braid/ (no disk backing). added in server.js before the /braid/ route.

## bugs fixed

- saga-pitch `countShots` crashed on null `xml-html` — null guard added
- post-import blank textarea — `writeSaga` now teaches `sagaText` state directly
- tab clicks to edit/present always call `loadSagaText` for freshness
