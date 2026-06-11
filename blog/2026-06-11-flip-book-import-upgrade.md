---
title: flip-book can now eat zips
date: 2026-06-11
tags: [flip-book, import, animation]
---

# flip-book can now eat zips

the clown walks on 3-foot stilts. the clown imports a zip of 300 frames and doesn't flinch.

before today, "import file" in flip-book meant one video or one audio track. useful, but narrow. now it means: drop anything. single image, stack of images, video, audio, zip containing any mix of the above. the door is wide open.

## what changed

the file input now accepts `image/*`, `.zip`, and multiple files at once. drag in a folder's worth of pngs, pick from the file picker with shift-click, drop a zip that has both frames and a soundtrack — it routes each type correctly.

**images** import as frames, sorted by filename (numeric-aware). you get the usual resize offer if the first image doesn't match your canvas dimensions. one image silently inserts after current; more than one asks replace-or-insert.

**zips** are unpacked with jszip (already vendored at `3.10.1` — it was sitting in dist from time-machine, just needed an importmap entry). images inside get extracted in parallel and decoded to `ImageBitmap` objects in one pass. those bitmaps go straight into `importImageAsFrame` without a second decode — the old single-image path was doing two `createImageBitmap` calls per frame (one for dimension check, one for drawing). fixed.

**progress bar** during zip extraction splits 0–50% for blob extraction, 50–100% for bitmap decode. frame creation in `importImageBatch` runs fully parallel via `Promise.all`.

the drop overlay used to say "drop video to import frames." now it says "drop files to import."

## the double-decode trap

the original image batch function peeked at the first image's dimensions by creating and immediately closing a bitmap, then recreated it inside the per-frame function. for a 200-frame zip that's 200 wasted decodes. the fix: `importImageAsFrame` accepts either a `File` or a pre-decoded `ImageBitmap`. the caller owns the bitmap lifecycle; the frame function only closes what it created.

## on jszip

plan98's zip experiments lived in `dist/elves/time-machine.js` — a prebuilt elf that was pulling jszip@3.10.1 from esm.sh but the importmap entry was never in source. adding one line to `client/public/index.html` let vendor.js find the already-cached file and wire it up.

---

the clown drops a zip on the artboard. the clown watches the bar fill. the clown presses play.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
