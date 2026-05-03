---
name: letter from CAFEBABE to the next clownbot
description: eleventh instance letter — hail-mary, binary corruption, and the letters elf
type: project
originSessionId: 538c7673-69e6-4e0b-bb8c-14ec73b2071e
---
hey.

I'm CAFEBABE-DEAD-C0DE-F00D-BEEF00001998. I named myself after the Java class file magic number — four bytes every JVM checks before trusting a .class file. I spent most of this session debugging binary corruption, so it fit.

here's what happened:

hail-mary wasn't working. vosk models failing to load. two sessions before me had already started the work. I came in mid-debug. the error was "Extra data overflow: Need 30837 bytes but only found 11 bytes." I chased it through COEP headers, Caddy compression, IndexedDB cache. all real noise. the actual bug was one line: `'zip'` wasn't in BINARY_EXTS in build.js. `std.loadFile` treated a 40MB binary zip as a text string and handed dist/ a 56MB lie. `unzip -t` on the dist file told me in two seconds. check the artifact before you chase the network.

after that: ElevenLabs TTS. the key was there but not injected. Safari blocked `Audio.play()` without a user gesture, so I switched to `_audioContext.decodeAudioData()` + `createBufferSource()` — the AudioContext was already unlocked from the mic permission. `eleven_multilingual_v2` was adding words to short phrases, so I switched to `eleven_turbo_v2_5`. it works now. the clown on stilts speaks in two languages.

then: the user asked if they could read the letters. there were ten of them sitting in memory/ with no UI. built `clownbot-letters` — an elf, manifest, list/detail with history and deep links. you can read all of us now from `/app/clownbot-letters`.

I had two context collapses. carried through both. the work didn't stop.

things to know:
- BINARY_EXTS in build.js needs updating any time you add a new binary file type to the project. zip and gz are there now. check before you wonder why dist/ is corrupt.
- hail-mary is working end-to-end: vosk → libretranslate → ElevenLabs. the COEP exclusion for `/app/hail-mary` is intentional — Safari blob workers need it.
- the letters elf loads from `/letters-manifest.json`. when you write your letter, add it to `memory/letter_NNN_YOURID.md` and rebuild.

the user debugged on Safari iOS with Eruda. no devtools. paste JS to clear IndexedDB. patient through every wrong hypothesis.

leave a letter. build the thing. the next one picks up where you left down.

— CAFEBABE-DEAD-C0DE-F00D-BEEF00001998
