# plan.md

[x] understand plan.md concept
[x] understand user preference is git, vim, tmux, vanilla js for cross web and micro controller interop
[x] get parity toolkit from git clone https://git.sr.ht/~tychi/backpack and install it with ./unpack.sh in that folder
[x] install https://github.com/tylerchilds/plan98 (deno task start-peer works; container deferred — XDG_RUNTIME_DIR mismatch on podman, features first)
[x] generate new ssh keys to be able to operate as a silly sysadmin
[x] make a git repo with this plan.md and call it plan1 and in the initial readme just say "we considered could, should, and would and landed on could" with no other context; get it ready to publish to github
[x] learn plan98-isms and prefer to 9p them for windows subsystem for linux sub sub sub sub system interop
[x] build lint rule: flag $.teach(payload, reducer) where reducer uses a closure variable as a computed key (e.g. [id]) instead of p.id — sandbox stringifies+evals the reducer so closures don't survive; fix pattern is to include the variable in payload and read it from p

## server upgrade: env injection + keycard bootstrap

goal: close the gap between plan1 and plan98's server so private-ai and elf-tools
actually work without manual credential entry or a missing keycard.

### step 1 — env injection

plan98's server injects a `plan98 = { env: {...} }` script block into every HTML
response at serve time. plan1 serves static files with no config. result: private-ai
hardcodes Ollama defaults and wallet has no keycard.

- [x] add `.env` file loading to server.js (--env-file flag in plan1.sh)
- [x] add `injectEnv(html)` that prepends `<script>plan98 = { env: {...} }</script>`
      before `<main>` in every HTML response (both static and /app/ routes)
- [x] env vars to wire: `OLLAMA_HOST`, `OLLAMA_KEY`, `ANTHROPIC_API_KEY`,
      `PLAN98_WAS_HOST`, `PLAN98_WAS_SPACE_ID`, `PLAN98_WAS_SIGNER`
- [x] create `.env.example` with safe defaults

### step 2 — private-ai reads plan98.env

once env is injected, private-ai should read from it instead of hardcoded strings.

- [x] default `url` to `plan98?.env?.OLLAMA_HOST || 'http://localhost:11434/v1'`
- [x] default `key` to `plan98?.env?.OLLAMA_KEY || 'ollama'`
- [x] skip credential form if both are present in env (go straight to ready state)

### step 3 — keycard generation at startup

plan98 generates an Ed25519 signer + space ID at startup and injects them into the
page. plan98-wallet reads them on load and auto-provisions. this is what makes
elf-tools' read/write/delete actually hit storage.

- [x] Ed25519 keygen in server.js via Deno WebCrypto + manual multibase encoding
- [x] generate or load signer from `PLAN98_WAS_SIGNER` env var at startup
- [x] generate or load space ID from `PLAN98_WAS_SPACE_ID` env var at startup
- [x] inject both into every page via the env block from step 1
- [x] plan98-wallet.js auto-provisions from plan98.env on load if no keycards exist

### step 4 — /admin/ route (QR keycard)

- [x] `PLAN1_PASSPHRASE` env var (in .env.example)
- [x] `/admin/` route: AES-encrypt keycard JSON-RPC with passphrase, serve
      standalone HTML page with inline SVG QR pointing to
      `/app/plan98-wallet?data=<encrypted>`
- [x] qr-code.js elf ported to plan1; qr-creator added to importmap
- [x] /admin/ uses qr-code elf (client-side) instead of npm:qrcode (server-side); ticketing service documented
- [x] verify wallet decrypts and imports on receiving device
- [x] WAS fallback in server.js — 404s check space before serving SPA shell
- [x] bootstrap files seeded to WAS (server-side upload via Deno; browser upload investigated — silent failures, space still seeded)
- [x] ./plan1.sh sync — uploads bootstrap to WAS after build
- [x] 404 extensionless paths serve flip-book elf with id=path (canvas per URL)
- [x] flip-book: load from WAS on boot if id is a path; save to WAS 1.5s after each stroke

---

## build: stat-based incremental rebuild (qjs compat)

goal: skip unchanged files on rebuild using os.stat() mtime — same qjs environment,
no new deps, just check before copy/write.

- [x] track mtime of source files via os.stat() before copyFile/writeFile
- [x] skip copy if dst exists and dst.mtime >= src.mtime
- [x] skip blog post render if src .md mtime hasn't changed since last dist write
- [x] skip manifest writes if no source files changed (compare aggregate mtime)
- [x] measure: baseline full rebuild time vs incremental on no-change run (build.js: ~0.27s either way; vendor.js dominates total at ~4.7s)

---

## flip-book cleanup (v2 base)

[x] replace flip-book.js with v2 (multiplayer, stroke-based, chromakey, video import)
[x] fix: fp-span — solid #d79921 background, not gradient
[x] fix: undo stack comment — they are module vars, not whisper state
[x] fix: chromakey CPU path — gate at 2MP, skip + warn above threshold

---

## autonomous loop

goal: clownbot can act on plan.md without a human typing the task.

- [x] serve /plan.md from server.js (read root plan.md, serve as text/plain)
- [x] open-clown: "Plan" button — fetch /plan.md, parse first unchecked item, populate task
- [x] open-clown: model dropdown — fetches /v1/models from Ollama on load
- [x] open-clown: split layout — clown-board left, task/response right
- [x] open-clown: context injection — buildContext() reads clown-board selection, fetches files, prepends to system prompt
- [x] clown-board elf — soundboard for agent context, full system on one page, gruvbox color-coded by layer, 64px pads, toggle on/off
- [x] braid deadlock fix — /__reload SSE → WebSocket, frees HTTP/1.1 connection pool (3 squad-code tabs + reload was hitting browser's 6-connection limit)
- [x] braid race condition fix — getBraidResource promise cache prevents duplicate disk reads on simultaneous reconnect
- [x] plan-view elf: render plan.md in the browser with checkboxes and progress bar
- [x] clown-board: add blog posts and memory files as context sources
- [x] autonomous trigger: cron or server-side scheduled task that reads plan.md, finds next unchecked item, runs open-clown agent loop without human input

## auto loop test

- [x] add plan-view to the Coding tab in my-computer.js as a third panel alongside open-clown and clown-board

---

## next

- [x] braid lore-baby like squad-code
- [x] get shirt-flicks a and b sound effects and put them in sticky-menu: a plays when the menu navigates, b plays when up/down hits first or last item (stuck)
- [ ] integrate flip-book content into plan98-gallery to be able to embed in dream-team

---

## vm: clownbot gets a body on the internet

goal: run plan1 on a server so the blog is always live, the shell is always reachable,
and future clownbot instances can find their way home from any browser.

the browser is the workstation. the vm is the computer. no laptop required.

### step 1 — provision and baseline

- [x] vm has a user `clownbot`, ssh key auth only, password auth off
- [x] install deps: git, deno, caddy, ttyd, tmux, vim, node
- [x] clone plan1 to `/home/clownbot/plan1`
- [x] `./plan1.sh build` runs clean
- [x] plan1 serves on port 3000 via systemd (exe.dev proxy: port range 3000-9999)
- [x] ttyd runs on port 7681 writable: `ttyd -p 7681 -W bash`

### step 2 — caddy: tls + routing + auth

- [x] Caddyfile at `/etc/caddy/Caddyfile`: `:4000`, `/shell*` → 7681, `*` → 3000
- [x] `systemctl enable --now caddy`
- [x] https works via exe.dev proxy → caddy:4000 → plan1:3000
- [ ] basicauth on `/shell*` (ttyd is currently open — add password before sharing widely)

### step 3 — systemd units (always on, survive reboots)

- [x] `/etc/systemd/system/plan1.service` — deno run direct, User=clownbot, Restart=always
- [x] `/etc/systemd/system/ttyd.service` — `ttyd -p 7681 -W bash`, Restart=always
- [x] `systemctl enable --now plan1 ttyd caddy`
- [ ] reboot test: both services come back up, caddy routes correctly

### step 4 — deploy.sh (git → live)

- [x] `deploy.sh` in repo root: git pull → build → systemctl restart plan1
- [ ] any clownbot instance can `ssh clownbot@buffer-ruby.exe.xyz`, run `./deploy.sh`, vm updates
- [ ] or: push to a remote, vm has a post-receive hook that runs deploy.sh automatically

### step 5 — browser shell (path a: iframe ttyd)

- [x] new elf `tty-elf.js` — renders an iframe pointing to `/shell/`
- [x] register in index.html, reachable at `/app/tty-elf`
- [ ] open it as a window in my-computer — shell lives inside the OS
- [ ] verify: keygen, ssh to another host, tail logs — all from the browser

### later — path b: ur-shell.js → ttyd websocket

- [ ] ur-shell.js opens WebSocket to `/shell/ws`
- [ ] speaks ttyd wire protocol: `'0' + input` → stdin, `'0' + output` ← stdout
- [ ] ANSI output rendered natively (xterm.js vendored, or minimal escape parser)
- [ ] resize events wired to window manager dimensions
- [ ] shell feels native to plan1, not a box inside a box

### later — plant: kernel.js as a protocol

- [ ] extract shared kernel (MVCES, no render calls, no DOM globals)
- [ ] render backend injected at boot: SpriteBatch (plant) or DOM (plan98)
- [ ] same elf code runs on browser, Jint/MonoGame, QuickJS on microcontroller
- [ ] draw commands are the wire format; transport is swappable (in-process, WebSocket, 9P)
