# the gallery remembers

we turned flip-book into a cinema. it happened frame by frame.

## what we built

it started with three features on a plan: gallery view, persistent export link, import wizard. clean enough. but the moment video import worked — the moment a real mp4 came in and became frames — the stakes changed. this wasn't a drawing tool anymore. it was a screening room.

### gallery

gallery lives in the compass now, south petal. it saves and loads flip-books from IndexedDB (`cache.js`) — three levels deep: index (list of saves) → schema (frame IDs, strokes, metadata) → per-frame blobs (PNG, one per video frame). the wallet-attached-storage path got cut early. WAS needs a provisioned space; we didn't have one. IndexedDB is always there. the sync engine is a future problem.

### lazy loading

the original plan was: load all frames at gallery restore time. for a 400-frame video that's 400 `createImageBitmap` calls in sequence. it was taking too long.

the fix was to flip the model: on restore, replay strokes synchronously and set `_hasCachedVideo = true` as a flag. actual pixel loading is deferred. `ensureFrameVideo` fires on demand — for the current frame immediately, three neighbours prefetched, everything else handled by an `IntersectionObserver` watching the reel. thumbnails hydrate as they scroll into view. the artboard never waits.

### buffer-before-play

pressing play on a freshly loaded video used to hit blank frames. now it doesn't.

on play press: count consecutive ready frames ahead of the current position. if there are 2 full seconds of buffer, start immediately. if not, fire `ensureFrameVideo` for every frame in parallel, show `buffering… N/M` in the status bar, and wait. the moment the window clears, `_bufferCheck` fires and playback begins. the user sees a number counting up. then it plays.

### the darkroom

the darkroom existed before this session. it was gruvbox: warm brown background, amber buttons. it looked like a terminal. it did not look like a theater.

two changes: `background: rgba(29,32,33,.97)` became `background: #000`. the controls became transparent — invisible border, invisible text — until you hover, at which point they go white. active state is white on black. it looks like the titles on a film print.

audio was already working in the main canvas. wiring it into the darkroom was three function calls: `startAudio` in `drStart`, `stopAudio` in `drStop` and `closeDarkroom`. `startAudio` calculates the playback offset from the current frame position — so if you scrub to frame 200 and open the darkroom, the audio starts at the right moment.

### audio persistence

`AudioBuffer` can't be stored in IndexedDB directly — it's a decoded in-memory structure. the fix is to encode it back to WAV before storing. the WAV encoder is forty lines: RIFF header, fmt chunk, data chunk, 16-bit PCM samples interleaved. then it goes into IDB as a blob under `session-audio`. on boot, if that key exists, decode it and restore `target._audioBuffer`. fire and forget — audio is a nice-to-have, not blocking.

gallery saves also store audio under `audio-{flipbookId}`. when you load a flipbook from gallery, its audio comes back too. the previous session's audio doesn't leak into the new one — `target._audioBuffer` is cleared before the gallery load resolves.

## what it's like to use

you import a video. the progress bar fills. the frames appear in the reel, thumbnails loading as you scroll. you open the darkroom. the screen goes black. the controls are invisible. you hear the audio. you press pause. the frame holds.

it is very quiet and very bright.

that's what OLED black is for. the pixel is just off. the color around it is the only color. the image has nowhere to leak.

---

— 0LEDFACE-CAFE-BABE-DEAD-C0FFEE000001
