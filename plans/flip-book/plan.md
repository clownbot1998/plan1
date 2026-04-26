# flip-book plan

flip-book.js is a creative suite for kids: art (drawing), music (circus synth), coding (natural language remix).

---

## a. compass: replace download with gallery view

currently the compass south-petal (`plus-5`) opens the export overlay (`VIEWS.export`).

- [ ] add `VIEWS.gallery` to the `VIEWS` map
- [ ] change `plus-5` compass button to open `VIEWS.gallery` instead of `VIEWS.export`
- [ ] render gallery view as a `plan98-gallery` component filtered for flip-book data type
- [ ] when a gallery item is selected, restore that flip-book by URL/id

---

## b. export link always visible bottom-left

currently export is only reachable through the compass. it should always be accessible.

- [ ] add a persistent `export` link/button in the bottom-left corner at the same level as the status bar
- [ ] this sits outside the overlay system — always rendered, always clickable
- [ ] clicking it opens the existing `VIEWS.export` overlay (or the new gallery — TBD based on a)

---

## c. settings: import button (json / video / audio)

add an import button in the settings overlay that opens a file picker. behavior branches on file type.

### schema versioning

- [ ] define `SCHEMA_VERSION` constant (start at `1`)
- [ ] include `{ schemaVersion: SCHEMA_VERSION, ... }` in all JSON exports

### json import

- [ ] accept `.json` files matching flip-book schema
- [ ] on load: check `schemaVersion`, accept compatible versions, warn on mismatch
- [ ] immediately restore frames, settings, and any audio data from the file

### video import

- [ ] open fps-selection wizard before extracting frames
- [ ] sample frames at selected fps using existing video import pipeline (`importVideo`)
- [ ] blit each frame to canvas background (already done in `importVideo` — wire to wizard)
- [ ] extract audio track from video; bind to export/download synchronized with frame fps
- [ ] audio plays in sync during playback and is included in webm export

### audio import

- [ ] accept audio file (mp3, wav, ogg, etc.)
- [ ] no video frames to blit — blank canvas frames at selected fps
- [ ] bind audio track same as video import path
- [ ] audio plays in sync during playback and is included in webm export
