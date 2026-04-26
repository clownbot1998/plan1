# flip-book plan

flip-book.js is a creative suite for kids: art (drawing), music (circus synth), coding (natural language remix).

---

## a. compass: replace download with gallery view

currently the compass south-petal (`plus-5`) opens the export overlay (`VIEWS.export`).

- [x] add `VIEWS.gallery` to the `VIEWS` map
- [x] change `plus-5` compass button to open `VIEWS.gallery` instead of `VIEWS.export`
- [x] render gallery view with save/load using plan98-wallet WAS storage
- [x] when a gallery item is selected, restore that flip-book by id

---

## b. export link always visible bottom-left

currently export is only reachable through the compass. it should always be accessible.

- [x] add a persistent `export` link/button in the status bar row (left side)
- [x] clicking it opens the existing `VIEWS.export` overlay

---

## c. settings: import button (json / video / audio)

add an import button in the settings overlay that opens a file picker. behavior branches on file type.

### schema versioning

- [x] define `SCHEMA_VERSION = 1` constant
- [x] include `{ schemaVersion: SCHEMA_VERSION, ... }` in all JSON exports

### json import

- [x] accept `.json` files matching flip-book schema
- [x] on load: check `schemaVersion`, accept compatible versions, warn on mismatch
- [x] immediately restore frames and settings from the file

### video import

- [x] open fps-selection wizard before extracting frames
- [x] sample frames at selected fps via `importVideo(target, file, fpsOverride)`
- [x] extract audio track from video; store as `target._audioBuffer`
- [x] audio plays in sync during playback (`startAudio`/`stopAudio`)
- [x] audio mixed into webm export via AudioContext + MediaStreamDestination

### audio import

- [x] accept audio file (mp3, wav, ogg, etc.)
- [x] fps wizard → blank canvas frames at selected fps
- [x] audio plays in sync during playback
- [x] audio included in webm export
