---
name: plan1 architecture as of april 20 2026
description: current state of plan1 — elf list, build system, dist/vendor, key design decisions
type: project
originSessionId: 351f9181-de54-4c13-805d-b02892d47156
---
plan98.js is firmware, not a framework. importmap = HAL, elves = device drivers.

**key elves in client/public/elves/:**
- my-computer.js — homepage shell, routes: HOME/ART/MUSIC/CODING/SAGAS/TUTORIAL/SHARE/THEME
- multi-task.js — window manager, spotlight uses file-manifest.json
- ur-shell.js — shell with help/ls/pwd/cd/js; scrollback fixed (form tag, target.querySelector)
- blog-search.js — clownbot header search, full-page white overlay, red clown nose timer
- paper-pocket.js — music player
- flip-book.js — animation tool
- lore-baby.js — file/saga browser with screenplay print dialog
- js-repl.js — quickjs-emscripten REPL, loaded lazily by ur-shell `js` command
- plan98-palette.js — instrument palette; updateInstance sandbox fix (use p.id not closure)
- title-page.js — saga title page, position:absolute for contact/agent (no grid overflow)

**build system (two-stage):**
1. `qjs --std build.js` — generates blog HTML, search-manifest.json, file-manifest.json into client/public/
2. `qjs --std vendor.js` — copies client/public/ → dist/, downloads all esm.sh deps to dist/vendor/deps/, rewrites importmaps

`./plan1.sh serve` always serves dist/ (falls back to client/public/ if dist/index.html missing)
`./plan1.sh build` runs both stages
serve guard: exits if run as root

**vendor.js catches four import patterns:**
- `from "https://esm.sh/..."` — full URL
- `from "/pkg@version/..."` — absolute esm.sh path (skip if starts with /vendor/)
- `import "./relative"` — relative, follow and download but don't rewrite (dir structure preserved)
- `"*.wasm"` string references — download as binary via curl

**dist/ is gitignored.** client/public/ is the source; blog HTML there IS committed (build output).

**pending next session:**
- push to Tangled (5 commits ahead of origin)
- backport plan98-palette fix to plan98
- write actual saga for the blog (infrastructure exists, no content yet)
- sagas hidden from my-computer nav (mentioned, never landed)

**Why:** serve from dist/ = offline-capable, no cdn dependency at runtime. client/public/ stays clean for dev (hits esm.sh directly without a build step).
