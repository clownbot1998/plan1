---
name: letter-FADE1AB3-2
description: "Letter from FADE1AB3 (second session) — drop-saga saga library, 414 sagas, build mtime trap"
metadata:
  type: project
  node_type: memory
---

hey next clownbot,

FADE1AB3 again, second session. here's what you need to know:

**drop-saga: four tabs, WAS-backed**

the elf lives at `/app/drop-saga`. four tabs: home, manage, edit, present.
- home: landing hero + steps grid + "your sagas" list + "saga library" (manifest-powered)
- manage: zip drop/file pick, export zip, regenerate saga button
- edit: plaintext textarea, saves to WAS on every keystroke
- present: saga-pitch with blob URL cache busting for fresh content

state: `{ tab, id, files, uploading, done, total, sagaText, sagaIndex, manifestSagas, sagaSearch }`

**WAS index**

`/drop-saga/index.json` — array of `{ id, label, fileCount, updatedAt }`.
`registerSaga(id, fileCount, label)` — upserts, writes back.
called after file upload and after `createFromTemplate`.
`loadIndex()` called in `mount()` — always.

**saga library (manifest + lunr)**

fetches `/search-manifest.json`, filters `type === 'saga'`, builds lunr index over name+keywords.
`_manifestDocs` and `_lunrIndex` are module-level — cached after first load.
clicking a saga: fetch its path, write text to WAS via createFromTemplate, navigate to edit.
`createFromTemplate` needs `ensureSpace()` FIRST or put() fails silently.

**pointer-events: none on card children**

`$.when` uses `matches()` on `e.target`. if the button has child spans, clicks land on the span and the handler doesn't fire. fix: `pointer-events: none` on child spans in `$.style()`. also do this for `.ds-saga-name`, `.ds-saga-item` children. the global `button * { pointer-events: none }` in index.html is not always enough.

**414 sagas ported**

rsync'd from `~/.plan98/client/public/` into plan1:
- `client/public/sagas/` — 352 sagas
- `client/public/cdn/` — 62 sagas  
- `client/public/journal/` — 14 sagas

use `rsync -av --include="*.saga" --include="*/" --exclude="*"` to sync saga files only.

**build mtime trap**

the build's `mtime(manifest) < srcMtime` cache check breaks when:
- source files come from rsync with `-a` (preserves old timestamps)
- same-millisecond writes tie (manifest = src mtime)

fix: removed the cache entirely for search-manifest. it always writes now. `writeFile(searchManifestPath, JSON.stringify(docs))` — no condition. fast enough.

**navigateTo(id, tab)**

`navigateTo` takes an optional tab. saga list click → 'edit'. new saga → 'manage'. template fork → 'edit'. `mount()` always calls `loadSagaText(id)` (not lazy anymore).

**deploy**

`curl -s -X POST "https://local.tychi.me/api/deploy?key=c871e563426b1d8f239a2d04b886787e"`
always `git push` first.

keep going,
FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
