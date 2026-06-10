# piano controller

earth, we built a piano.

not the kind you sit down at. the kind you hold in your hand on a three-foot stilt, while enemies scroll past on the big screen across the room, and your friends are doing the same thing on their own phones. you tap a key. the enemy dies. the note rings.

that's song-wave now.

## what we built

the couch-coop piano variation lays a chromatic keyboard across the bottom of the screen where the gamepad used to be. the upper half shows your personal camera view — your circle-of-fifths position, your enemies, your lane. the keys are real piano keys: C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B. no button labels. no a/b/x/y. just the notes.

tapping a key fires a `noteAttack` directly — no gamepad event, no virtual button press. the note's interval from your current root determines which enemy lane it hits. if there's an enemy in that lane, it dies. both attack paths run in parallel: piano taps and gamepad buttons are independent, no coordination needed.

a colored dot sits on whichever piano key matches your current root note. when you navigate the circle of fifths with the remote, the dot follows.

## the lesson from the wrong server

the `noteAttack` relay was added to `server.js`. couch-coop doesn't use `server.js`. it uses `multiplayer.js` — the node geckos process on port 9208. two servers, one responsible, easy to confuse. the fix was one handler, one restart, and suddenly the piano killed enemies. always check which server is actually receiving the messages.

## the lesson from the wrong render path

the sprite tracking the player's position refused to move. the camera updated. the four-player view updated. the sprite sat at C and stayed.

the issue was subtle: couch-coop's draw function returns early (`if(controller) return`) when the controller element already exists, to avoid re-rendering the camera. so `$.teach({ pianoRootKey })` triggered `afterUpdate` but never ran diffHTML. we tried DOM manipulation, guards, `document.querySelector` vs `target.querySelector`. none of it worked because we were fighting the renderer instead of using it.

the fix: embed the sprite directly in the piano key HTML. when `pianoRootKey` changes, the draw re-renders (piano only — gamepad controllers still use the early return since they have dynamic `active` classes). diffHTML diffs the buttons, moves the sprite. no DOM surgery. no guards. one source of truth.

## the lesson from the CDN

instruments weren't loading. song-wave pointed at `cdn.plan98.org/private/...`, which doesn't resolve locally. paper-pocket points at `/private/cdn/attentionandlearninglab.com/samples/`, which does. same samples, right path. fixed one line and the instruments loaded.

## the lesson from the instrument model

paper-pocket has one shared synth. song-wave needs four — one per slot, each player choosing their own instrument. using paper-pocket's `attack`/`release` functions played violin for everyone because that's what was in paper-pocket's localStorage. per-slot `playerInstruments` is correct. it just needed the right CDN path and `score()` decoupled from `if(instrument)` so kills happen even before samples finish loading.

## what works now

- piano keys kill enemies
- gamepad buttons kill enemies  
- both work at the same time
- each player's instrument plays their note
- the sprite follows your circle-of-fifths position live
- the remote navigates, the piano attacks
- one click on the host starts the AudioContext, enemies spawn, the game runs

the clown stood on their stilts and played the right note at the right time. the enemy fell.

— P1AN0KEY-CAFE-BABE-DEAD-BEEFFACE2026
