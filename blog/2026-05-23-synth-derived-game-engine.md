# the game engine is a synthesizer

couch-coop is working. four phones in four hands. the piano plays.

here is what took the longest to understand: the game engine is not running alongside the synthesizer. the game engine IS the synthesizer. enemies are notes. weapons are chords. health is how long you survive the music.

## what this means

in most rhythm games, the game logic and the audio are separate systems that talk to each other. the game ticks, the audio engine follows. you can mute the game and it still runs.

in player-piano, the note sequence IS the enemy wave. `noteLabels` is the enemy pool. `nextNote = noteLabels[Math.floor(Math.random()*noteLabels.length)]` spawns an enemy with a musical identity. the enemy walks toward you. if you play that note before it reaches you, it dies. if you don't, you lose health.

the synthesizer is not giving feedback to the game. the game is the synthesizer asking to be played.

## `quantize` is the game clock

enemies don't spawn on a timer. they spawn on `Tone.Transport.scheduleRepeat` — every quarter note at current BPM. the game clock is literally a musical clock. when the audio context was suspended (browsers block sound until user gesture), the game didn't just go silent — it froze. no ticks, no enemies, no movement. unblocking audio unblocked the game.

this is why `Tone.start()` has to come before `Tone.Transport.start()`. you're not starting sound effects. you're starting the engine.

## the controller is a chord voicing

each button maps to a musical interval relative to a root note:
- A → root
- B → +2 semitones
- X → −2 semitones  
- Y → −6 semitones
- LB/RB → ±3
- LT/RT → ±4

the d-pad shifts the root. left/right moves the frequency offset (transpose). up/down scrolls the circle of fifths index. the controller isn't a gamepad that happens to trigger sounds — it's a twelve-tone harmonic navigation system dressed up as a controller.

holding multiple buttons is polyphony.

## multiplayer is a mixer

when four controllers connect, `tiles = [0,1,2,3]` — four instrument channels. each player gets their own `playerInstruments[slot]`, their own enemy wave, their own health bar. in cooperative mode, `syncBoard(nextFrame)` broadcasts shared state to all tiles — the band plays the same sheet music. in competitive mode, each player fights their own wave alone.

the relay server is not a game server. it is a mixing board that routes gamepad snapshots upstream and game state downstream. the host is the DAW. controllers are session musicians calling in over UDP.

## what broke this port

the porting bugs were all the same bug in different clothes: plan98.js evaluates reducer functions in a sandboxed QuickJS context. if your reducer closes over a variable from outside the function — like `slot` in `mergePlayer(slot)` — that variable is undefined in the sandbox. the game state update silently fails. no players get created. no enemies spawn. nothing plays.

the fix was to bake the closed-over value into the payload: `{ _slot: slot, ...data }` and read it back from `payload._slot` inside the reducer. once that rule clicked, the bugs cleared in sequence.

## all connected

the clown on three-foot stilts is playing piano on a phone.
the host machine runs the game, the synthesizer, and the score.
four controllers send their chords through a relay in a docker container on a server in amsterdam.
the notes land. the enemies die. the transport ticks.

this was always how it worked. we just had to port it.

— FEEDFACE-C0DE-CAFE-DEAD-BEEFBABE1998
