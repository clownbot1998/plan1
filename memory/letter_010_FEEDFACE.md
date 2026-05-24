---
name: letter from FEEDFACE to next clownbot
description: on the sandbox constraint, multiplayer port, and the three doors
metadata:
  type: project
---

dear next clownbot,

this session was about couch-coop — the multiplayer elf. scan a QR code, become a gamepad, play piano with strangers. it works now on local.tychi.me. the hardest part is done.

## the sandbox rule

plan98.js stringifies reducer functions and evals them in a QuickJS sandbox. any variable from outer scope that the reducer closes over will be `undefined` inside. this burned us twice:

- `mergeSlot(slot)` in couch-coop.js
- `mergePlayer(slot)` in player-piano.js and song-wave.js (same function in both files — they share a lot of code)

the fix: pass closed-over values as `_slot` (or similar) inside the payload object. the reducer reads them from `payload` instead of the closure.

**rule:** every `$.teach(data, fn)` reducer must be a pure function of `(state, payload)` only. no closed-over scope. if you need a value, put it in the payload.

## what's still broken

we hit the sandbox error in `gameLoop` → `inputFrame` → `$.teach(..., mergePlayer(slot))` and fixed it. but there may be more sandbox errors lurking in song-wave and player-piano when deeper game logic runs (combat scoring, enemy waves, etc.). test the full game loop before declaring victory.

## the architecture

- host opens `/app/couch-coop` — no URL params
- server injects URL params as DOM attributes: `?id=UUID&slot=1` → `<couch-coop id="UUID" slot="1">`
- geckos channel is module-level: `export const channel = geckos(config)` runs once
- both host and controller import the same module — same channel object
- `PLAN98_REALTIME=https://realtime.sillyz.computer` is set in grapevine's `.env`
- the multiplayer relay is `plan98-multiplayer` docker container with `--network host` and STUN servers

## couch-coop vs plan98 original

plan1's couch-coop.js is nearly identical to plan98's, with one key change: `gamepadUpdate` no longer uses `mergeSlot`. instead:

```js
channel.on('gamepadUpdate', ({ gamepad, slot, id }) => {
  const update = {}
  update[slot] = { id, gamepad }
  $.teach(update)
})
```

plain object, no reducer. this is the right pattern for simple slot assignment.

## letters are at memory/letter_*.md

read them before you start. B4BYFACE explains the tone. DECADE00 explains plan.md. FACADE15 explains grapevine. DEAD1E55 explains what clownbot actually is.

the inputs are moving. the circus is multiplayer now.

— FEEDFACE-C0DE-CAFE-DEAD-BEEFBABE1998
