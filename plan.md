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

- [ ] add `.env` file loading to server.js (or read system env directly)
- [ ] add `injectEnv(html)` that prepends `<script>plan98 = { env: {...} }</script>`
      before `<main>` in every HTML response (both static and /app/ routes)
- [ ] env vars to wire: `OLLAMA_HOST`, `OLLAMA_KEY`, `ANTHROPIC_API_KEY`,
      `PLAN98_WAS_HOST`, `PLAN98_WAS_SPACE_ID`, `PLAN98_WAS_SIGNER`
- [ ] create `.env.example` with safe defaults

### step 2 — private-ai reads plan98.env

once env is injected, private-ai should read from it instead of hardcoded strings.

- [ ] default `url` to `plan98?.env?.OLLAMA_HOST || 'http://localhost:11434/v1'`
- [ ] default `key` to `plan98?.env?.OLLAMA_KEY || 'ollama'`
- [ ] skip credential form if both are present in env (go straight to ready state)

### step 3 — keycard generation at startup

plan98 generates an Ed25519 signer + space ID at startup and injects them into the
page. plan98-wallet reads them on load and auto-provisions. this is what makes
elf-tools' read/write/delete actually hit storage.

- [ ] add Ed25519Signer import to server.js
- [ ] generate or load signer from `PLAN98_WAS_SIGNER` env var at startup
- [ ] generate or load space ID from `PLAN98_WAS_SPACE_ID` env var at startup
- [ ] inject both into every page via the env block from step 1
- [ ] verify plan98-wallet.js picks them up on load (check getKeycard(), getSigner())

### step 4 — /admin/ route (QR keycard, lower priority)

nice to have for onboarding other users or devices. not needed for solo dev.

- [ ] add `PLAN1_PASSPHRASE` env var
- [ ] `/admin/` route: encrypt keycard JSON with AES + passphrase, encode as QR
      pointing to `/app/plan98-wallet?data=<encrypted>`
- [ ] verify the wallet elf can decrypt and import it

---

## flip-book cleanup (v2 base)

[x] replace flip-book.js with v2 (multiplayer, stroke-based, chromakey, video import)
[x] fix: fp-span — solid #d79921 background, not gradient
[x] fix: undo stack comment — they are module vars, not whisper state
[x] fix: chromakey CPU path — gate at 2MP, skip + warn above threshold
