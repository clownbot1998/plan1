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
