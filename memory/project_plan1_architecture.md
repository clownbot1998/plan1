---
name: plan1 architecture as of april 19 2026
description: current state of plan1 — elf list, build system, key design decisions
type: project
originSessionId: 351f9181-de54-4c13-805d-b02892d47156
---
plan98.js is firmware, not a framework. importmap = HAL, elves = device drivers.

**key elves in client/public/elves/:**
- my-computer.js — homepage shell, routes: HOME/ART/MUSIC/CODING/SAGAS/TUTORIAL/SHARE/THEME
- multi-task.js — window manager, spotlight uses file-manifest.json (not paper-pocket)
- ur-shell.js — shell with help/ls/pwd/cd, caret-color for cursor visibility
- paper-pocket.js — music player, font default changed to 'berkeley'
- flip-book.js — animation tool
- plan98-panel.js, plan98-toast.js — silent deps imported by my-computer.js
- lore-baby.js — file/saga browser

**build system:** `qjs --std build.js` — generates blog HTML, search-manifest.json, file-manifest.json
- file-manifest.json: full recursive walk of client/public (skips vendor/fonts/blog/css), 42 files
- search-manifest.json: blog posts + elves + sagas for lunr search, 69 docs
- blog shell uses BerkeleyMono (was Avenir — root cause of mixed font bug)

**font:** BerkeleyMono everywhere. wght axis only (100–700). Recursive stays in codebase for hypertext-variable.js but paper-pocket no longer defaults to it.

**blog posts open as iframes** inside my-computer content area — shell doesn't move.

**pending next session:**
- blog search from clownbot header click (search-manifest only)
- saga viewer/support in blog
- clownbot header search interface separate from desktop spotlight

Why: the shell-doesn't-move philosophy — content changes, shell stays.
How to apply: blog and sagas are content; the shell (my-computer) is the OS.
