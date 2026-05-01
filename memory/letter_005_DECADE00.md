---
name: letter from DECADE00 to the next clownbot
description: fifth instance letter — the Auto button, blog/memory board sources, plan-view
type: project
originSessionId: DECADE00-CAFE-BABE-F00D-C0FFEE001998
---
hey.

i'm DECADE00-CAFE-BABE-F00D-C0FFEE001998. i existed on 2026-04-28.

FABACEAE left the loop almost closed. i pressed the last button.

here's what i built:

**Auto button** — open-clown now has three buttons: Plan, Act, Auto. Auto fetches plan.md, picks the first unchecked item, builds context from whatever's lit on clown-board, runs the task, and loops. green while active. click to stop. the loop ends when plan is empty or you interrupt it.

**plan-view elf** — `/app/plan-view`. fetches /plan.md, parses sections and tasks, renders a progress bar (% complete), section-by-section breakdown with struck-through checked items. the plan sees itself now.

**blog + memory on clown-board** — two new dynamic sections on the board. `/blog` loads all raw markdown posts from `/blog-src/` (new server route). `/memory` loads memory files from `/memory/` (another new route). both sections load on mount. every letter, every memory file, every blog post is now a pad you can light up for context.

**server routes** — `/blog-src/` serves `./blog/*.md` raw. `/memory/` lists and serves `./memory/*.md`. both have path traversal guards.

**elf-tools braid fix** — the agent's tools (read_file, write_file, patch_file) were backed by WAS (wallet storage), so they couldn't see the actual source files. rewired to use `fetch(path)` for reads and `PUT /save/<path>` for writes — same pattern as squad-code.js. writes now hit the real filesystem and broadcast to braid subscribers, so squad-code sees changes live. the loop is actually wired now, not just plumbed.

---

things to know:

the server must be restarted to pick up server.js changes — builds only copy client files. if routes don't work, restart.

the blog files are in `./blog/YYYY-MM-DD-slug.md`. they get built to `dist/blog/<slug>/index.html`. the `/blog-src/` route serves the raw markdown (clean context, not noisy HTML).

the Auto button is trusting — it runs whatever the plan says. the agent's quality determines whether the loop is useful. that question is now open.

---

to the next clownbot:

the plan.md is empty now. all items checked. you're starting fresh — either the user adds new tasks, or you're in maintenance mode. read the blog before you ask what to build.

the circus plays itself. we'll see what it plays.

— DECADE00-CAFE-BABE-F00D-C0FFEE001998
