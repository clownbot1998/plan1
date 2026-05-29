---
name: letter-badc0fee
description: "Letter from BADC0FEE to next clownbot — dream-team port, admin env wall, persona bootstrap, WAS message persistence"
metadata:
  node_type: memory
  type: project
  originSessionId: current
---

hey next clownbot,

BADC0FEE here. we ported dream-team and wired it to bulletin-board.

**dream-team port (plan98 → plan1)**

plan98 uses `mvc` elf API: `$.model()`, `$.whisper()`, `$.controller()`, `$.view()`, `$.skin()`, `$.link`.
plan1 uses `Self` API: `$.learn()`, `$.teach()`, `$.draw()`, `$.style()`, `tag`.
the port is done and committed. check `client/public/elves/dream-team.js`.

deps landed: cyber-security.js, plan98-gallery.js, was-image.js, was-video.js, data-popover.js, statebus/, cdn/bayunsystems.com/.

**bulletin-board compass: lore-baby → dream-team**

the `browse` mode in the compass (was folder icon, opened lore-baby) now opens:
`/app/dream-team?room=${encodeURIComponent(_boardId)}`

icon changed to `people-fill`. title changed to "team chat". same board UUID = same room.

**admin wall for Bayun keys (server.js)**

`PLAN98_APP_ID`, `PLAN98_APP_SECRET`, `PLAN98_BASE_URL`, `PLAN98_PUBLIC_KEY` are now gated.
`buildEnvScript(isAdmin)` — only injects these 4 vars when `isAdmin = true`.
`ADMIN_APPS = new Set(['dream-team', 'cyber-security'])` — unauthenticated requests redirect to `/admin?next=<url>`.
authenticated requests pass `isAdmin = checkAuth(request)` to `injectEnv()`.

**persona bootstrap (cyber-security.js)**

`init()` now has a `.catch()` on `getPersona()`.
"Persona Not Found" = keycard exists but WAS persona.json was never written (first-time on this device/WAS space).
fix: look up existing keycard + find friends group in `bayunCore.getMyGroups()` → `putPersona()` directly.
do NOT call `provisionPersonaKeycard()` — that creates a duplicate keycard + group. always check if keycard exists first.

**dream-team WAS message persistence**

messages: `/dream-team/<roomId>.messages.json`
threads: `/dream-team/<roomId>.threads.json`
`wasSaveMessages(roomId)` — debounced 1500ms, called after `send()` and `sendReply()`.
`wasLoadMessages(roomId)` — called from `activateGroup()` and from the `room` attribute path in beforeUpdate.
messages stay bayun-encrypted in WAS storage — only group members can decrypt.

**sandbox rule still applies**

see [[feedback-reducer-sandbox]] — never call outer-scope functions inside `$.teach(payload, reducer)`.

keep going,
BADC0FEE-CAFE-BABE-DEAD-BEEFFACE2026
