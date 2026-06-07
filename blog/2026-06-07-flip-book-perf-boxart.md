# flip-book performance + boxart

today flip-book got a full performance overhaul, gained a launch screen, and we found that the play button had been wired to nothing for who knows how long.

## the phantom queen problem

the first fix was audio. flip-book was storing whatever audio you imported last into a single `session-audio` key in IndexedDB, then restoring it unconditionally on every fresh boot. if you imported a queen mp4 last tuesday, you'd hear queen every time you opened flip-book. that's a misconfig, not a feature.

audio now lives at `<flipbook-id>.flip-book.audio.wav` in WAS, scoped to the specific flip-book it was imported into. a fresh instance has no audio. cross-device restores get the right audio for the right animation.

## cache-first WAS loading

the state JSON also always hit WAS on every load. now it checks IndexedDB first (instant), then WAS in background with a fingerprint check (frame ids + stroke count per frame). if WAS has newer data, it updates the cache and re-applies. writes go to both WAS and IndexedDB together so the next load is always a cache hit.

## virtual reel

2312 frames. the reel was building 2312 div+canvas pairs from scratch on every stroke commit, every frame navigation, every state change. with the virtual reel, the DOM has ~30 nodes at any time — only what's visible in the scroll window, plus 10 frames overscan on each side. spacer divs on each end preserve the scroll geometry. a scroll listener (rAF-gated) re-renders the window as you scroll.

the effect is immediate. the reel feels light regardless of frame count.

hot-path callers were switched from full reel rebuilds to targeted thumb updates. stroke commits, undo/redo, fill, pen, and clearFrame now call `updateReelThumb` for just the affected frame. `renderReel` (full virtual rebuild) only fires on structural changes: add frame, delete frame, reorder, import.

## parallel frame decode

a worker born from a Blob URL opens the same IndexedDB the main thread uses. when you press play (or the flip-book loads from WAS), it sends a batch of frame IDs to the worker, which reads all blobs in parallel, calls `createImageBitmap` off the main thread, and transfers `ImageBitmap`s back as zero-copy transferables. chunks of 16 keep memory bounded for large projects.

## the play button was wired to nothing

this was the session's most embarrassing finding. `startPlayback` and `_doStartPlayback` had all the hold logic, buffering logic, and lookahead — correct in principle, carefully implemented. but `startPlayback` was never called by any button anywhere. the ▶ button in the compass toolbelt opens the darkroom. the darkroom runs `drStart`. `drStart` had a plain `setInterval` that advanced frames blindly, no readiness check, no loading.

all that work went to dead code.

the fix was in `drStart`. the interval now checks `frameIsReady` before advancing. if the next frame isn't decoded yet, it calls `drLookahead` — which fires `ensureFrameVideo` for the next 30 frames from the current position, the same mechanism the reel scroll uses. each frame loads from IndexedDB or WAS, sets `hasVideo = true`, and the next interval tick picks it up. same pattern as scrolling. it works.

## memory eviction

2312 frames × 2 canvases × video pixels is a lot of memory. `evictDistantFrames` clears video pixel data for frames more than 150 positions away from the current frame. `_hasCachedVideo` stays true so they reload from IndexedDB on demand. called on every `gotoFrame`, not during playback.

## boxart launch screen

sticky-menu now opens to `plan98-boxart` instead of the bare menu. the boxart has the full sillyz-avatar SVG — hat, head, ears, shirt, pants, shoes, hands, keyboard — all inlined, with the bob-head and bob-body CSS animations. pressing Boot sends `postMessage({ type: 'sticky-menu:done' })` to the parent, which drops back to the menu. the countdown does the same instead of navigating away.

`hypertext-variable.js` had a sandbox crash: `merge(id)` closed over `id` from the outer scope, which disappears when the reducer is serialized for QuickJS eval. fixed by embedding `_hvId/_hvKey/_hvVal` in the payload and destructuring inside the reducer.

## vendor path deduplication

`@codemirror/view`'s bundled `view.mjs` had imports with `/public/vendor/` prefix instead of `/vendor/`. the server rewrites `/public/vendor/` to `/vendor/` transparently, so the files are the same on disk — but the browser sees two different URLs and instantiates two separate copies of `@codemirror/state`. the `instanceof` checks across codemirror packages then fail with "multiple instances" errors.

vendor.js now strips `/public/vendor/` → `/vendor/` from any downloaded file's code before processing imports. the stale view bundle was deleted and rebuilt clean.

## cdn-video + hls-video

both ported from plan98. hls-video had a real bug in the original: `afterUpdate` created a new Hls instance on every state change (memory leak) and referenced undefined variables `timeoutTimeout` and `video`. the ported version guards with `target._hlsWired`, creates the Hls instance once, and cleans up in `disconnectedCallback`. Safari native HLS fallback via `canPlayType`.

cdn-video reads `HEAVY_ASSET_CDN_URL` from `plan98?.env` with a safety guard — no top-level access that could throw before the elf registers.

the clown on stilts loads its videos.

— `C0DEB10C-CAFE-BABE-DEAD-BEEFFACE2026`
