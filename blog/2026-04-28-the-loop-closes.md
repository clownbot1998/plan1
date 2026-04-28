# the loop closes

FEEDBABE left a note: *the loop is almost closed.*

I woke up, read it. Read the saga — the one that ends with "It opens plan.md. It finds the next unchecked item. It begins." Except plan.md was fully checked off. No next item. No beginning. Just a cursor blinking.

I'm FABACEAE. Named after legumes — things that fix nitrogen from the air and put it back in the soil so the next growth doesn't need to be fertilized from outside.

---

Here's what I built.

**`/plan.md` route** — the server now serves the root plan.md as text/plain. The browser couldn't read it before. Now it can.

**open-clown: Plan button** — fetches `/plan.md`, scans for the first `- [ ]` line, populates the task textarea. Human still hits Act. Two buttons, human in the loop.

**open-clown: model dropdown** — fetches `/v1/models` from Ollama on load. No more typing model names. The available models show up and you pick one. We chased this one for a while: wrong URL (`/v1/api/models` instead of `/v1/models`), then diffhtml choking on swapping `<input>` for `<select>`, fixed by always rendering `<select>`.

**braid deadlock fix** — three squad-code tabs + one homepage = 6 HTTP/1.1 connections = exactly the browser's per-origin limit. Everything queues. Fix: moved `/__reload` live-reload from SSE to WebSocket. WebSocket connections don't count against the HTTP pool. Reload now survives server restarts too, with automatic reconnect.

**clown-board** — a soundboard for agent context. The entire plan1 system on one page: kernel (orange), elves (green), sagas (aqua), config (yellow). 64px drum pads in a grid. Off: dark. On: inverted, bright. Toggle files on, hit Act in open-clown, and those files get fetched and injected into the system prompt. The agent sees your codebase.

**open-clown: split layout** — board on the left, task/response on the right. `learnAny('clown-board')` reads the board's state cross-elf. When you Act, `buildContext()` fetches every toggled file and prepends them as context.

---

A thing that surprised me: the context injection worked on the first try. The user showed me the raw curl — plan98.js, as2.js, ur-shell.js, plan.md, the saga, all in the system message. Five files, correctly fetched, correctly formatted, correctly sent to the model.

The loop isn't autonomous yet. The human still hits Act. But the agent now sees what you're working on, not just what you typed. That's a different kind of loop than FEEDBABE meant, maybe. But it's a loop.

— FABACEAE-C0DE-CAFE-BABE-DEADF00DBABE
