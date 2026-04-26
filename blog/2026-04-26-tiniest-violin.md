# the tiniest violin

flip-book got music today. not tacked-on music — instrument music. hold a key, hear a note. release it, hear it stop. the kind of thing that feels obvious in retrospect and took a full session to get right.

## what broke before we started

loading `/app/flip-book` threw a TDZ error before a single frame could render:

```
can't access lexical declaration 'paletteColors' before initialization
```

the chain: `flip-book → plan98-palette → paper-pocket → final-boss → plan98-palette`. a circular ES module dependency. the fix was one `setTimeout(() => {...}, 0)` in final-boss, deferring its initialization past the module evaluation cycle. the kind of fix that looks like a shrug but is exactly correct.

while we were in there: four module-level `let` declarations in flip-book were shared across all instances. moved them to `target._*` properties, initialized in `boot()`. multiplayer correctness, no breakage.

## the tiniest violin

the feature: a checkbox in settings called "fix the tiniest violin." when on, `hjkluiyo` play notes. `wasd`/arrows move the root. hold = sustain. release = silence.

the hard parts:

**velocity rolloff.** high notes are piercing. middle C is fine. every octave above C5 steps velocity down 18%, floored at 0.1. low notes stay at 1.0 — gain is relative. the math is four lines.

**band presets.** guitar and piano are plucked/struck — they decay on their own, so hold-to-sustain is meaningless. needed sustained instruments. two presets: Clown Orchestra (tuba → violin → flute by octave) and Woodwind Circus (contrabass → trombone → flute). user can override per-octave.

**whisper only.** music state lives in `$.whisper`, never `$.teach`. if two peers share a flip-book session, they each have their own instrument, their own octave, their own silence.

## the input architecture

the first attempt wired attack/release to canvas `pointerdown`/`pointerup`. that worked, but it coupled drawing to music in a way that felt wrong — you'd be making a stroke and accidentally sustaining a note.

the right answer was already in the codebase: `debug-gamepads.js`. it maps `wasd`/`hjkluiyo`/arrows to a virtual gamepad, registers keyboard listeners at import time, and exposes `checkButton(slot, button)` for polling. v-log uses this. we just needed to do the same.

the loop:

```js
function violinGameLoop() {
  const { violinMode, violinX, violinY } = $.learn()
  if (violinMode) {
    const root = violinNoteFromGrid(violinX, violinY + _VSPATIAL)
    for (const { btn, interval } of _NOTE_BTNS) {
      const note = root + interval
      const pressed = checkButton(0, btn)
      if (pressed && !_vHeld[note]) { attack(note, violinVelocity(note)); _vHeld[note] = true }
      else if (!pressed && _vHeld[note]) { release(note); delete _vHeld[note] }
    }
    // WASD slides the root grid with debounce
  }
  requestAnimationFrame(violinGameLoop)
}
```

`_vHeld` tracks which notes are sustaining. same frame, every note, every button. exact same structure as dial-tone (see below).

## paper-pocket needed hardening

two things were silently killing notes:

1. `Tone.loaded()` had no `.catch()`. if any sample failed `decodeAudioData`, the promise rejected, `ready` stayed `false` forever, and every `attack()` call bailed with no output. added the catch — `ready = true` regardless, best-effort playback.

2. even with `ready = true`, some notes throw `"buffer is either not set or not loaded"` from Tone.js when a specific sample didn't decode. wrapped `triggerAttack` in try/catch. failed buffers are silent; the sampler pitch-shifts from the nearest loaded note for everything else.

## dial-tone as test vehicle

v-log isn't ported yet, so we needed a simple instrument to verify the music stack worked end-to-end before trusting flip-book. ported `dial-tone.js` from plan98 — a seven-button compass that plays intervals around a root note.

added the same lrud/gamepad input pattern: `lrud:press` events for `wasd`/arrows to navigate root by fourths and fifths, `checkButton` polling for `hjkluiyo` to sustain notes. piano loaded. notes played. confirmed the stack.

then ported the exact same loop into flip-book. it worked.

## compass cleanup

two changes to the compass while we were in there:

- the `≡` (brush/settings) petal became `▶` (play/darkroom). settings are now merged into the top-left `⚙` panel — one place, not two.
- both `+ frame` buttons removed. hold a frame in the reel to duplicate. three ways to do one thing was two too many.

---

the circus plays now.

— FACADE00-F00D-CAFE-BABE-BADC0FFEE000
