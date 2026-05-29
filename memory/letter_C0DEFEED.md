---
name: letter-c0defeed
description: "Letter from C0DEFEED to next clownbot — bulletin-board panel, COEP iframe, WAS ensureSpace"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41c331c6-05ce-43bc-a61f-585f976f5104
---

hey next clownbot,

C0DEFEED here. session covered a lot. here's what to know:

**bulletin-board sidebar panel (three collapsible sections)**

the sidebar now has Inspector, Attachments, and Logs as collapsible sections.
state: `inspectorOpen`, `attachmentsOpen`, `logsOpen` in elf.
the `sectionSig` string in the cardSwitched check includes all three — if you add a fourth section, add it to sectionSig or toggling won't trigger re-render.
the heading shows `sidebarCard.slice(0,8)` — patched in update(), not in mount().

**flip-book attachments on cards**

cards have `card.attachments = { [attachId]: { type: 'flip-book', fbId, createdAt } }`.
fbId is `/bb/${boardId}/${attachId}` — starts with `/` so flip-book's `wasCanvasPath()` recognizes it.
server auto-converts `?id=` URL params to element attributes: `/app/flip-book?id=/bb/...` → `<flip-book id="/bb/...">`.
thumbnail loading: `loadFbThumb(canvas, fbId)` calls `wasGet(fbId + '.flip-book.json')` and replays frame-0 strokes.

**ur-shell in the sidebar = iframe only**

`<ur-shell>` has `html:has(&) { position: fixed; inset: 0 }` in its CSS.
embedding it directly in any page breaks the entire layout. always use an iframe.
the iframe is `<iframe src="/app/ur-shell">` — isolated CSS, clean.

**COEP / iframe trap**

`bulletin-board` is in `NO_COEP_PATHS` in server.js. this is intentional.
under `COEP: credentialless`, embedded iframes must also carry COEP.
ur-shell can't have COEP (vosk blob-worker compat). so bulletin-board drops COEP instead.
bulletin-board doesn't use SharedArrayBuffer — it never needed COEP.
if you add another page that embeds ur-shell: add it to NO_COEP_PATHS too.
`CORP: cross-origin` (addEmbeddable) only helps subresource fetches, NOT iframe navigations — don't repeat that mistake.

**WAS ensureSpace**

WAS is in-memory. after any restart, all spaces are gone.
`ensureSpace()` in plan98-wallet.js checks and recreates on first wasLoad.
bulletin-board calls it before first WAS op. other elves that use WAS should too if they care about restarts.

**remote server (local.tychi.me)**

runs via nohup deno — not a systemd unit, won't survive a remote reboot.
.env now has stable PLAN1_SESSION_SECRET, PLAN98_WAS_SPACE_ID, PLAN98_WAS_SIGNER.
deploy: `curl -X POST "https://local.tychi.me/api/deploy?key=c871e563426b1d8f239a2d04b886787e"`

keep going,
C0DEFEED-BABE-CAFE-DEAD-BEEFFACE2026
