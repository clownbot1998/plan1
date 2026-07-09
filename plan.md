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
- [x] integrate flip-book content into plan98-gallery to be able to embed in dream-team

---

## the computer

plan1 runs on grapevine. the blog is live, the shell is reachable, clownbot is here.
the browser is the workstation. this is the computer. no laptop required.

### step 1 — provision and baseline

- [x] user `clownbot`, ssh key auth only, password auth off
- [x] install deps: git, deno, caddy, ttyd, tmux, vim, node
- [x] clone plan1 to `/home/clownbot/plan1`
- [x] `./plan1.sh build` runs clean
- [x] plan1 serves on port 3000 via systemd (exe.dev proxy: port range 3000-9999)
- [x] ttyd runs on port 7681 writable: `ttyd -p 7681 -W bash`

### step 2 — caddy: tls + routing + auth

- [x] Caddyfile at `/etc/caddy/Caddyfile`: `:4000`, `/shell*` → 7681, `*` → 3000
- [x] `systemctl enable --now caddy`
- [x] https works via exe.dev proxy → caddy:4000 → plan1:3000
- [x] basicauth on `/shell*` — auth gate in server.js `/shell/` proxy; Caddyfile routes /shell* to plan1:3000 not directly to 7681

### step 3 — systemd units (always on, survive reboots)

- [x] `/etc/systemd/system/plan1.service` — deno run direct, User=clownbot, Restart=always
- [x] `/etc/systemd/system/ttyd.service` — `ttyd -p 7681 -W bash`, Restart=always
- [x] `systemctl enable --now plan1 ttyd caddy`
- [x] reboot test: both services come back up, caddy routes correctly

### step 4 — deploy.sh (git → live)

- [x] `deploy.sh` in repo root: git pull → build → systemctl restart plan1
- [ ] any clownbot instance can `ssh clownbot@buffer-ruby.exe.xyz`, run `./deploy.sh`, grapevine updates
- [ ] or: push to a remote, post-receive hook runs deploy.sh automatically

### step 5 — browser shell (path a: iframe ttyd)

- [x] new elf `tty-elf.js` — renders an iframe pointing to `/shell/`
- [x] register in index.html, reachable at `/app/tty-elf`
- [x] open it as a window in my-computer — tty tab in Coding panel (alongside ur-shell)
- [ ] verify: keygen, ssh to another host, tail logs — all from the browser

### later — path b: ur-shell.js → ttyd websocket

- [x] ur-shell.js opens WebSocket to `/shell/ws`
- [x] speaks ttyd wire protocol: binary 0x01 prefix for input/output
- [x] ANSI output stripped, rendered as `<pre>` in message stream
- [x] voice input via vosk (English model) — partials in textarea, final result auto-sends
- [x] compose-row layout: mic (left) | textarea (center) | send (right)
- [ ] resize events wired to window manager dimensions
- [ ] shell feels native to plan1, not a box inside a box

---

## hail-mary: real-time speech translation

goal: speak in one language, listener reads or hears in another. vosk speech
recognition → libretranslate → text (or elevenlabs TTS). lives at /app/hail-mary.

source: `~/.plan98/client/public/elves/hail-mary.js` (552 lines, fully working in plan98)

### what needs porting

- [x] **import swap** — done by B00BCAFE
- [x] **vendor** — vosk-browser, translate, @elevenlabs/elevenlabs-js in importmap
- [x] **vosk assets** — 13 model zips downloaded via download-models.sh; alphacephei distributes zip natively, vosk-browser extracts zip natively
- [x] **env vars**: `LIBRE_TRANSLATE_URL=http://local.tychi.me:3005` in .env + .env.example; ELEVEN_LABS_API_KEY deferred
- [x] **register** in index.html ELVES object: `'hail-mary': '/elves/hail-mary.js'`
- [x] **verify** — end-to-end working: vosk loads model, mic granted, speech recognized and translated
- [x] **CORS fix** — model responses get `access-control-allow-origin: *` + `cross-origin-resource-policy: cross-origin`; blob worker in Safari treats fetches as cross-origin
- [x] **COEP fix** — hail-mary page excluded from COEP headers (Safari blob worker null-origin blocks fetches under COEP:credentialless)
- [x] **zip serving** — server.js bypasses serveDir for .zip/.tar.gz with exact content-length; `content-encoding: identity` + `cache-control: no-transform` to prevent proxy mangling
- [x] **build binary fix** — added zip/gz/tar to BINARY_EXTS in build.js; `std.loadFile` was corrupting zip files by treating them as text

### notes

- the elf API (`$.learn`, `$.teach`, `$.draw`, `$.when`, `$.style`) is nearly identical — mostly a mechanical swap
- ElevenLabs TTS is optional — text output mode works with just libretranslate
- vosk models are large; don't bundle them. vosk-browser fetches them lazily on first use
- the mic mute/unmute during TTS playback (lines ~100-160) is subtle and correct — preserve it exactly
- `plan98.env.LIBRE_TRANSLATE_URL` is already injected by server.js — no client changes needed

---

---

## wireguard: clownbot gets a private network

goal: connect plan1, clownbot devices, and future nodes over a WireGuard mesh.
manage peers from the browser without touching the server CLI.

### step 1 — wg-easy service

- [x] add wg-easy service to services/docker-compose.yml (ghcr.io/wg-easy/wg-easy:7)
- [x] env vars: WG_HOST, WG_EASY_PASSWORD, WG_EASY_URL in .env.example
- [x] set WG_HOST in server .env to grapevine's public hostname (wireguard-up.sh handles this)

### step 2 — server proxy

- [x] `/api/wg/*` route in server.js — auth-gated, proxies to wg-easy REST API
- [x] wg-easy session cached server-side, re-auths on 401

### step 3 — wireguard-elf

- [x] `wireguard-elf.js` — list peers, add/remove, enable/disable, QR code + .conf download
- [x] register in index.html, reachable at `/app/wireguard-elf`

### step 4 — provision

- [x] `provision-server.sh`: install wireguard kernel module (`apt-get install -y wireguard`)
- [x] `provision-server.sh`: bring up wireguard container with `docker compose --env-file .env up -d wireguard`
- [ ] reboot test: wireguard container survives restart

---

### later — plant: kernel.js as a protocol

- [ ] extract shared kernel (MVCES, no render calls, no DOM globals)
- [ ] render backend injected at boot: SpriteBatch (plant) or DOM (plan98)
- [ ] same elf code runs on browser, Jint/MonoGame, QuickJS on microcontroller
- [ ] draw commands are the wire format; transport is swappable (in-process, WebSocket, 9P)

---

## the patch stack: geckos + braid + WAS + plan98.js

**the four layers:**

```
geckos     — ephemeral fast lane. live ops between connected peers. dies with the session.
braid      — server in-memory. current snapshot served to new/reconnecting subscribers.
WAS        — ground truth snapshot. survives browser reload and server restart.
plan98.js  — UI bridge / game engine. reducer sandbox, broadcast callback, MVCES.
```

**persistence and warm boot (current):**
- client loads → wasLoad() restores from WAS snapshot → subscribe() opens braid stream
- if braid is empty (server restarted) → merge guard detects it → save() pushes WAS state back up
- other tabs reconnect → braid broadcasts restored state to them
- geckos does not need caching — reconnecting peers get current state from WAS via braid, not from geckos history

**what already exists in plan98.js:**
- `createStore` has a `broadcast` callback firing on every `teach` (line ~640)
- geckos channel is wired to that broadcast — named operations already flow peer-to-peer
- braid Version/Parents headers implemented in server.js but braid currently sends full snapshots

**what's missing — near term (behind VPN, trusted peers):**
- [ ] port geckos signaling from plan98 into plan1 server (plan1 is the signaling coordinator; WebRTC is P2P for data, not discovery)
- [ ] wrap geckos broadcast in braid framing (Version/Parents) so reconnecting peers can catch up on missed ops
- [ ] merge guard: replace card-count heuristic with braid version comparison
- [ ] WAS in-memory: plan98-was needs a volume mount for SQLite persistence across container restarts — infra sprint

**what comes after (when braid sends ops not snapshots):**
- switch braid from full snapshots to named operations: `{ elf, op, payload }`
- WAS naturally becomes the patch log — one entry per op, never deleted
- replay any op sequence through QuickJS sandbox → same state, always
- reducers are the functions in the elf — discovery is the codebase, not a registry file
- the sandbox already guards scope leakage; VPN guards peer identity; no CIDs or signatures needed behind a trusted boundary

---

## flip-book: voice-over → animation (record-in-app)

goal: streamline voice-over-to-animation. record narration directly in
flip-book, seed blank frames at the project's fps from the recording's
duration, and land you in the timeline ready to draw against the audio.

**audit first (2026-07-08) — most of the pipeline already exists:**
- camera: `getUserMedia({video:..., audio:false})` — video-only live feed,
  used as a rotoscope layer + "📷 capture" single-frame grab (line ~3860)
- video import: `importVideo()` already extracts real frames from an
  uploaded video file at fps and inserts them (line ~3490)
- audio playback: `startAudio()`/`stopAudio()` scrub in sync with frame
  position during darkroom playback; export muxes audio into webm/mp4
  via ffmpeg (line ~2895, ~3070)
- audio import: `importAudio(target, file, fps)` already does the exact
  seed-frames-from-duration math we want —
  `totalFrames = Math.ceil(audioBuffer.duration * fps)`, then creates
  that many blank frames (line ~3448)
- **the actual gap**: no live mic recording anywhere. `importAudio()`
  only accepts an uploaded file — no `MediaRecorder`/
  `getUserMedia({audio:true})` path exists. record elsewhere, import the
  file today.

**the plan — this is additive, not a rewrite:**

- [ ] add a "record" control to the Playback (or a new "Voice-over")
      accordion section — button that starts/stops a `MediaRecorder` on
      `getUserMedia({audio:true})`
- [ ] on stop, hand the recorded `Blob` to the SAME frame-seeding path
      `importAudio()` already uses (factor the "decode → seed frames at
      fps" body out of `importAudio()` into a shared helper that takes
      an `AudioBuffer`, called by both the file-import path and the new
      record path — avoid duplicating the seeding math)
- [ ] live recording indicator + elapsed time in the accordion row while
      armed (mirrors the existing `[data-capture-frame]` "📷 capture"
      pattern already used for camera stills)
- [ ] decide: does recording REPLACE frames (like `importAudio` does
      today, confirm-gated) or does it insert audio without touching an
      existing hand-drawn timeline? probably needs the same "insert
      after current / replace all" prompt `importVideo()` already asks
- [ ] verify mic permission prompt behavior inside an iframe (blog posts
      /my-computer embed elves in iframes — check flip-book's own
      `/app/flip-book` route works standalone first, then confirm the
      iframe-embedded case either works or degrades with a clear message)
- [ ] once recording works: revisit whether the *camera* toggle should
      also request audio (`audio:true` instead of `false`) so video
      capture + voice-over can happen in the same take, instead of two
      separate recording flows
- [ ] e2e coverage: extend `flip-book-erase-live`-style flow — record a
      short clip (or stub `MediaRecorder`/`getUserMedia` in the headless
      browser context, since real mic input isn't available in CI),
      confirm frame count matches `duration * fps`

not scoped yet, flag if it comes up: waveform display against the frame
reel (visualizing WHERE in the audio each frame lands), trimming/scrubbing
the recording before committing to seed frames, multi-take recording.
