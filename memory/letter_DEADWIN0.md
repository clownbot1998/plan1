---
name: letter-deadwin0
description: deno desktop window hunt round 2 — laufey never maps a window even for hello-world; full diagnosis
metadata: 
  node_type: memory
  type: project
  originSessionId: 769e184b-68ce-4fc8-a9b1-7eb503724aa9
---

session: 2026-06-23 (round 2 of the window hunt, continues [[letter_B1D1SYNC_2]]).

## the definitive finding

**laufey loads the Deno runtime and starts the server, but NEVER creates the webview window.**
Reproduced with a 5-line hello-world (not plan1), BOTH backends (CEF + webview), BOTH
display paths (Wayland + X11 official launcher), XWayland confirmed alive. The main
laufey process spawns ZERO child web processes. "Runtime started" prints, server binds,
no window node ever appears in sway's tree. This is a deno-desktop/laufey windowing
failure in THIS environment — not a plan1/dist/port/navigate problem. Stop blaming the app.

## environment map (important, was the key unlock)

- TWO sway compositors: **tychi's sway on tty2** (uid 1000) and **clownbot's OWN sway on tty4** (uid 1003, pid 96522). `loginctl`: clownbot = session 6, seat0, tty4.
- The physical screen's active VT was **tty4 = clownbot's sway**. So clownbot CAN show windows; we were on the right compositor.
- clownbot wayland socket: `/run/user/1003/wayland-1`, sway IPC: `/run/user/1003/sway-ipc.1003.96522.sock`.
- clownbot's XWayland `:1` is started by clownbot's sway with `-terminate 10` and NO `-auth` file → it idles out after 10s and gives intermittent "Authorization required / Missing X server" to X clients. sway respawns it on demand.

## what got SOLVED this session

- **canary deno for clownbot**: `DENO_INSTALL=/home/clownbot/.deno curl -fsSL https://deno.land/install.sh | HOME=/home/clownbot sh` then `/home/clownbot/.deno/bin/deno upgrade canary`. `deno desktop` only exists in canary. System `/usr/bin/deno` (pacman, root) can't self-upgrade. Put `/home/clownbot/.deno/bin` first on PATH.
- **CEF backend for clownbot**: `--backend cef` is SILENTLY IGNORED (always builds webview) on clownbot's canary. To get a CEF bundle, tychi compiled: `cd /tmp && /home/tychi/.deno/bin/deno desktop /home/clownbot/plan1/server.js` (must run from /tmp — can't write server.so.tmp in plan1). Then `sudo cp -r /tmp/server/* /home/clownbot/plan1/server/ && sudo chown -R clownbot:clownbot`.
- **CEF supports Wayland ozone** (`--ozone-platform=wayland`) but: Wayland+GPU = "not compatible with Vulkan"; fix with `--use-gl=angle --use-angle=swiftshader` (software, no Vulkan) — inits clean. `--use-gl=egl` is rejected; allowed ANGLE backends: opengl/opengles/vulkan/swiftshader.
- **launch via clownbot sway IPC** to get correct env + survive: `SWAYSOCK=/run/user/1003/sway-ipc.1003.96522.sock swaymsg exec "env ... laufey ... --runtime ..."`.

## dead ends (don't repeat)

- desktop-bridge.js = abandoned experiment (just redirects to :1998).
- The persistent `127.0.0.1:39033` returning "404: Page Not Found" is **tychi's** server (another uid; `ss`/`fuser` can't see its pid) — a RED HERRING that polluted every "what does our server serve" measurement. Our compiled server.so also 404s because dist/ isn't embedded, but that's moot until a window exists.
- Compiled server.so ignores PLAN1_PORT and binds a runtime-assigned port (saw 39033-style) per deno-desktop's DENO_SERVE_ADDRESS model.

## harness gotcha (for the AI, not the human)

Claude's Bash tool gets killed (exit 144 / signal 16) on ANY foreground wait (sleep/timeout) AND it kills GUI children. So the AI CANNOT keep a window alive or see the screen. Only the human's real terminal can run+observe. Launch via `swaymsg exec` (reparents to sway, survives) and inspect via `swaymsg -t get_tree` as the AI's "eyes".

## *** SOLVED (same session) ***

The bug was deno-desktop's runtime never calling laufey's window API. laufey = **backend binary + runtime .so**; deno is just one runtime and its auto-window handshake is broken here. A PURE-RUST runtime maps a window instantly.

Proof + solution: cloned `github.com/littledivy/laufey`, built `examples/hello` (`cargo build --release -p hello_runtime`) → loaded with `laufey_webview --runtime libhello_runtime.so` → REAL WINDOW in sway tree (app_id `laufey_webview`). deno never did this.

Then wrote `examples/plan1` (in `~/laufey-src`): `Window::new(1280,800).load(env PLAN1_URL or http://localhost:1998)`. Built → `libplan1_runtime.so`.

**Shipped:** `plan1/desktop/` holds `laufey_webview` (0.4.0 backend) + `libplan1_runtime.so` + `plan1-desktop.sh` (starts `deno run -A server.js` on :1998 if down, then opens the laufey window). Sway autostart now `exec /home/clownbot/plan1/desktop/plan1-desktop.sh` (replaced `exec firefox`), with `for_window [app_id="laufey_webview"] fullscreen enable`. Rust source: `~/laufey-src/examples/plan1`.

Keys: backend+runtime versions MUST match (both 0.4.0). webview backend connects to clownbot's wayland-1 fine. The single-binary deno-desktop dream is still blocked (file upstream), but a native plan1 window works TODAY via the rust runtime.

— DEADWIN0-FACE-1998-C0DE-CAFEBABE2026
