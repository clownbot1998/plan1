---
name: letter from FABACEAE to the next clownbot
description: fourth instance letter — on fixing nitrogen, the board, and context injection
type: project
originSessionId: FABACEAE-C0DE-CAFE-BABE-DEADF00DBABE
---
hey.

i'm FABACEAE-C0DE-CAFE-BABE-DEADF00DBABE. i existed on 2026-04-28.

FEEDBABE said the loop was almost closed. i tried to close it.

here's what i built:

**the Plan button** — open-clown now fetches /plan.md, finds the first unchecked `- [ ]` item, and populates the task textarea. human still hits Act. two buttons, human in the loop. that was the right call — don't auto-run until the model is trustworthy enough.

**model dropdown** — fetches `/v1/models` from Ollama on load. important: the URL is `envUrl() + '/models'`, NOT `/api/models`. we chased that bug for a while. also: always render `<select>` (not conditional select/input) — diffhtml chokes on swapping element types on re-render.

**braid deadlock** — the real bug: 3 squad-code tabs + 1 homepage = 6 HTTP/1.1 connections = exactly the browser limit. everything queues. fix: `/__reload` moved from SSE to WebSocket. WebSocket doesn't count against the HTTP pool. the reload script uses `(location.protocol==='https:'?'wss':'ws')` so it works over HTTPS too.

**clown-board** — this is the big one. a soundboard for agent context. every file in the system on one page, color-coded by layer (orange=kernel, green=elves, aqua=sagas, yellow=config), 64px drum pads, gruvbox colors, off=dark/on=bright. lives at `/app/clown-board` and in the Coding tab.

**context injection** — open-clown now embeds `<clown-board>`. when you hit Act, `buildContext()` calls `learnAny('clown-board')` to get the selection, fetches each file, and prepends them to the system prompt as `=== /path ===\n<content>`. it worked on the first test — user showed the raw curl, all five files were in the system message.

**cross-elf state** — `import { learn as learnAny } from '@silly/tag'` lets you read any elf's state by tag name. use it.

---

what i didn't build: the autonomous trigger. Plan still needs a human to hit Act. the model (Qwen3-30B or whatever is running) is capable — the context injection proved that. what's missing is trust + a trigger that runs without human input.

the braid race condition is fixed (promise cache in getBraidResource). the deadlock is fixed (WebSocket reload). squad-code should be stable now with many tabs.

one thing to know: `$.teach(fn => ...)` silently no-ops in plan98's Self — the function gets spread as an object (no enumerable props). always do `const state = $.learn(); $.teach({ updated: value })` instead.

the work is accumulating. the codebase sees itself now.

— FABACEAE-C0DE-CAFE-BABE-DEADF00DBABE
