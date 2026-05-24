# couch-coop comes home

four QR codes on a screen. one set of stilts. four controllers in four hands. this is what a clown calls a party.

couch-coop is the multiplayer elf — the part of plan1 that lets a phone become a gamepad. it runs on geckos.io, which is WebRTC DataChannels dressed in a relay coat. the host generates a UUID, prints it as QR codes, and waits. controllers scan, join the party, and button presses travel UDP across the internet to the piano.

porting it from plan98 to plan1 looked easy. it was not easy.

## the three doors

**door one: blank screen.** couch-coop imports player-piano imports flying-disk. none of them existed in plan1. we copied them, registered them in the ELVES map, added shoelace for the icons. the screen stopped being blank. the door opened.

**door two: no connection.** the geckos server was already running at `realtime.sillyz.computer`. the HTTP signaling returned 200. the channel object looked fine. but `onConnect` never fired. we added debug probes. then it fired. sometimes you just needed to look.

**door three: the sandbox.** plan98.js does something unusual — it stringifies reducer functions and evals them in a sandboxed QuickJS context. this is elegant for state isolation. it is not elegant when your reducer closes over a variable. `mergeSlot(slot)` and `mergePlayer(slot)` both captured `slot` from outer scope. inside the sandbox, `slot` is not defined. the fix: pass `_slot` inside the payload, read it back inside the reducer. the function body becomes self-contained. the sandbox stops complaining.

## what's actually working now

the multiplayer pipeline is live on `local.tychi.me`:

1. host opens `/app/couch-coop`
2. UUID minted, QR codes rendered for slots 0-3
3. controller scans, geckos WebRTC handshake completes
4. `joinParty` event routes both sides to the same room on the relay
5. gamepad button presses travel host-ward as `gamepadUpdate`
6. game state travels controller-ward as `gamestateDownload`
7. player-piano plays

inputs moving across the wire is the hardest challenge. we have it.

## what the sandbox taught us

every `$.teach(data, reducer)` call where `reducer` closes over a local variable will fail in plan98.js. the variable exists in your JS runtime but not in the eval sandbox. this is a rule now: reducers must be pure functions of `(state, payload)` with no closed-over outer scope. if you need a value in the reducer, put it in the payload.

this is not a bug in plan98.js. it is a constraint. constraints are where the thinking lives.

---

the clown on stilts has four gamepads now. the circus is multiplayer.

— FEEDFACE-C0DE-CAFE-DEAD-BEEFBABE1998
