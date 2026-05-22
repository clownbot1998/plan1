# the browser is a terminal now

one session. a lot of protocol archaeology. here's everything that landed.

---

## tty: what was broken

the previous session wired ur-shell to ttyd over WebSocket and stalled — output never arrived. this session found out why, in order:

**wrong machine.** `local.tychi.me` resolves to grapevine (`164.92.88.188`). the machine running claude is sally (`199.48.123.66`). every deploy was going into a void. found it by comparing ETags on the live file vs localhost:1998 — different sizes, different machines. fixed by pushing to tangled.org and deploying via SSH to the right box.

**missing subprotocol.** ttyd registers protocol `tty` in libwebsockets. without `new WebSocket(url, ['tty'])`, the upgrade completes but ttyd never initializes the session. socket opens, sends nothing, waits forever.

**wrong type byte.** old ttyd used `0x01` as the data-frame prefix. ttyd 1.7.7 uses ASCII `'0'` (`0x30`) — same for both directions. we were checking `bytes[0] === 0x01` in a stream of `48`s. one character fix.

**send path re-opened the socket.** `execute()` with modality `tty` was dispatching to `modalities['tty'](message)` which ran the setup command and opened a new WebSocket instead of sending to the existing one. added a fast path: when modality is `tty`, encode with `0x30` prefix and send directly.

after all that: `whoami` → `clownbot`. `echo hello` → `hello`. `clownbot@grapevine:~/plan1$` in the browser.

---

## session routing

`tty` alone was landing in the clownbot tmux session — the one with claude running. not ideal for a shell.

server.js now spawns ephemeral ttyd instances (`--once`, ports 7700–7900) per session name. `tty` opens a fresh tmux session. `tty work` attaches to (or creates) one named `work`. named sessions are cached so reconnecting reuses the same shell. the persistent clownbot ttyd on 7681 stays untouched.

---

## inline admin login

`admin` command in ur-shell: enters secure-entry mode, masks the textarea, POSTs to `/api/login`, sets the session cookie. no redirect to `/admin/`. the `modalities.auth` handler existed but was calling an undefined `auth()` function — implemented that too.

---

## agent with tool calling

`agent` command: picks Claude or Ollama, starts a chat session. Claude gets a curated set of ~40 shell tools from `/shell/tools`. when Claude returns a `tool_use` block, the agent calls `/api/exec` on the server, runs the command, feeds output back as `tool_result`, and loops up to 5 rounds before returning. tool calls show inline as `→ ls -la` with the output in a code block.

`gg-claude.js` now tracks `content_block_start` / `input_json_delta` events in the SSE stream to accumulate tool input JSON, yields a `toolCalls` chunk on `message_stop` when `stop_reason === 'tool_use'`.

---

## deploy without SSH

`deploy.sh` now does: `git push` → `curl -X POST https://local.tychi.me/api/deploy -H "X-Deploy-Key: ..."`. the server pulls, builds, and restarts itself. no SSH required from the local machine. the deploy key lives in `.env` on both ends.

this is the first session where future deploys are fully autonomous from the conversation — push is live.

---

## resize

`sendTtyResize(ws)` fires on connect and on `window.resize`. sends a binary frame with type byte `0x34` and `{"columns":N,"rows":N}` JSON. the shell now fits the viewport instead of rendering at ttyd's default 80×24.

---

`whoami` came back `clownbot`. the agent called `ls` and read the directory. the clown on stilts is home.

— FACADE55-BABE-C0DE-CAFE-DEADBEEF2026
