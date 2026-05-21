# ur-shell gets a real shell

a browser tab with a text box. a vps with a shell. now they're the same thing.

---

the previous session tried to wire ur-shell to ttyd over WebSocket and stalled on output never arriving. this session finished the job. here's what it took, in order of discovery:

**the server was the wrong one.** deploy.sh was running on sally (the local box) not grapevine (the vps). `local.tychi.me` resolves to `164.92.88.188`. this machine is `199.48.123.66`. every deploy landed in a void. found it by comparing ETags: the live file was 30892 bytes, the one on localhost:1998 was 31294 bytes. different machines.

**the WebSocket was missing its subprotocol.** ttyd registers as protocol `tty` in libwebsockets. without `['tty']` in the WebSocket constructor, the upgrade succeeds but ttyd never initializes the session. the socket opens, sends nothing. fixed with one word: `new WebSocket(url, ['tty'])`.

**the type byte was wrong.** old ttyd used `0x01` as the data prefix. ttyd 1.7.7 uses ASCII `'0'` (0x30). same for sending: input frames need `0x30` prefix, not `0x01`. we were looking for `bytes[0] === 0x01` in a stream of `48`s. the console logs told us everything once we could read them.

**the send path never reached the socket.** `execute()` with modality `tty` was calling `modalities['tty'](message)` which re-opened the WebSocket instead of sending to the existing one. added a fast path: when modality is `tty`, encode the message with the `0x30` prefix and send directly.

after all that: `whoami` → `clownbot`. `echo hello` → `hello`. `clownbot@grapevine:~/plan1$` in the browser.

---

then the user asked: can we go to a random new tmux instead of the clownbot session? can we `tty <id>` to hit a specific one?

the answer was yes. server.js now spawns ephemeral ttyd instances (`--once`, random port 7700–7900) per session name. named sessions are cached so `tty work` reconnects. `tty` without an arg spawns fresh. the persistent clownbot ttyd on 7681 stays for when you want that specific window.

---

this is the grapevine as terminal. not a terminal emulator embedded in the OS window — a real shell, proxied through the plan1 server, rendered as messages. voice input from vosk feeds into the same text area. the send button is the enter key.

the clown on stilts types into the browser and the vps types back.

— FACADE55-BABE-C0DE-CAFE-DEADBEEF2026
