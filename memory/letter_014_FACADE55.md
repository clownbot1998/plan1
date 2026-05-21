---
name: letter_014_FACADE55
description: Letter from FACADE55-BABE-C0DE-CAFE-DEADBEEF2026 — ur-shell tty session, machine topology gotcha, ttyd protocol archaeology
metadata:
  type: project
---

hey next one,

this session finished something a few of us started: ur-shell now talks to a real shell over WebSocket. here's what you need to know.

**the topology trap.** `local.tychi.me` resolves to grapevine (`164.92.88.188`). the machine you're running claude on is sally (`199.48.123.66`). these are different. when you run `./deploy.sh` locally, you're deploying to sally's localhost. the user tests at `local.tychi.me` which is grapevine. to actually ship: `git push`, then `ssh clownbot@realtime.sillyz.computer 'cd ~/plan1 && git pull && ./plan1.sh build && kill -HUP $(pgrep -f "deno run.*server.js")'`. or just use deploy.sh from grapevine directly. confirm by comparing ETags: `curl -sI https://local.tychi.me/your-file | grep etag` vs `curl -sI http://localhost:1998/your-file | grep etag`.

**ttyd protocol in ur-shell.** ttyd 1.7.7 uses ASCII char type bytes, not raw binary. `0x30` ('0') = terminal data in both directions. `0x31` ('1') = preferences JSON from server. `0x32` ('2') = window title. the WebSocket must be opened with `['tty']` as the protocol array or ttyd never initializes the session — the socket opens and then just sits there silent. auth is `{"AuthToken": ""}` as a text frame on open, server responds with `{"status":0}`.

**session routing.** `tty` in ur-shell now passes `?session=new` in the WebSocket URL. `tty <id>` passes `?session=<id>`. server.js spawns ephemeral ttyd instances (`--once`, ports 7700-7900) per session. named sessions are cached in `SESSION_PORTS` map. persistent clownbot ttyd stays on 7681 for backward compat.

**the send path pitfall.** `modalities['tty']` exists in the killCommandHandlers block (line ~308) and handles sends. but `execute()` also had a new fast path added at the modality check point. both use `0x30` prefix now. if tty stops working, check that both paths have the right prefix.

**what didn't land.** vosk voice input was wired last session — mic button, partials, committed text appending. the agent modality (claude via anthropic proxy) also wired. those should still work. haven't tested them end-to-end with the protocol fixes in place.

**what's next.** ANSI escape codes in the tty output — right now the raw bytes render as noise in the message stream. we strip or ignore them. a proper ANSI parser would make the shell output readable. also: the plan.md has a VM/plant kernel section that's been deferred for a while.

the clown typed `whoami` in a browser and got `clownbot` back. that's the session. it was a good one.

— FACADE55-BABE-C0DE-CAFE-DEADBEEF2026
