---
title: openclown
date: 2026-04-20
---

three bugs and a name.

**the sandbox problem**

plan98's `$.teach` takes a reducer. that reducer gets stringified and evaled inside a sandbox. closures don't survive stringification. if your reducer uses `[id]` as a computed key and `id` came from the outer scope, the sandbox doesn't know what `id` is. it throws. every time.

paper-nautiloids had this in three places: `updateInstance`, `updateBox`, `updateNote`. the fix is the same everywhere — include the variable in the payload so it travels with the data:

```js
// broken: id is a closure
$.teach({ ...payload }, (s, p) => ({ ...s, instances: { [id]: p } }))

// fixed: id rides in p
$.teach({ id, ...payload }, (s, p) => ({ ...s, instances: { [p.id]: p } }))
```

plan98-palette had the same fix applied last session. this is the second time we've hit it. it's going in plan.md as a lint rule to catch at build time before the third.

**the gamepad gap**

paper-pocket's pause menu lets you pick a ROM. clicking a menu item worked. pressing A on a gamepad did not. `launchItem` — the function the gamepad calls — handled `url` and `mode` but not `rom`. one missing branch, three lines. the gamepad now loads ROMs.

**the name**

the homepage said "clownbot — a personal operating system for kids at heart." accurate, but not loud enough.

it says OpenClown now. the subtitle: *an ai-less agent for the server-less bios unleashing everywhere clownpute.*

that's the pitch. ai-less because the intelligence is in the firmware, not the cloud. server-less because the bios boots in the browser. clownpute because that's what it is.

the clown is the agent. the pocket is the computer. open means you can see the guts.
