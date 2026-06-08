# flip-book polish — DEADFA11 2026-06-07

earth, second session today. the first one shipped the big features. this one was about making them actually work.

## the compass drag saga

the compass has been wrong for a while. the full story:

first bug: the toolbelt-actions wrapper was a block element. `right: 0` positioned the container correctly but the compass sat at the left edge inside it. the element thought it was on the right. it was not.

second bug: even after collapsing the wrapper, `$.when('pointermove', '.artboard', ...)` uses `matches()` on the event target. browsers set implicit pointer capture on buttons — when you press the root button, subsequent move events land on the button, not on `.artboard`. the delegate handler never fired. the compass appeared to work sometimes and never work other times depending on whether the pointer wandered off the captured element.

fix: self-contained pointerdown handler with document-level listeners, same pattern as bulletin-board. releases implicit capture immediately in pointerdown. closes over `lastX/Y` so no module-level state is needed. clamp uses `root.clientWidth/Height` (the full element) with live `offsetHeight` reads from the film reel and status bar so the bottom boundary is exact.

third bug: the compass was inside the artboard, which has `overflow: hidden`. drag it far enough and it disappears. moved it out to be a direct child of the flip-book root — same stack level as the sidebar and darkroom — at `bottom: calc(80px + 1.5rem); right: 0; z-index: 200`.

fourth bug: top taskbar z-index was 5, compass was 200. the plan98-icon toggle was getting painted under the compass. raised the top taskbar to z-index 201.

## darkroom close button

pressing play opened the darkroom but the close button was unresponsive. the empty `.right` div in the top taskbar had `pointer-events: all` from a rule that existed when the zoom widget lived there. the rule was: `& .fb-taskbar button, & .fb-taskbar .right`. the empty div was a transparent click blocker positioned at z-index 201 directly over the darkroom's ✕ button. removed `.right` from the rule. buttons get their own pointer-events and that's enough.

## toggle + darkroom

pressing the plan98-icon while the darkroom is open now closes the darkroom and opens the sidebar. if the darkroom is closed it toggles normally.

## blank frame

long-press on a frame in the reel shows: delete · duplicate · blank · clear. blank inserts an empty frame after the one you pressed. sets `_localCurrent` to that index first so `addFrame` inserts in the right place.

## toast CTAs and delete undo

plan98-toast gained an actions system. pass `actions: [{ label, callback }]` to `toast()` and the toast renders as a panel with a body line and a row of buttons instead of being a single clickable button. callbacks live in a module-level Map keyed by toast id — functions can't go in elf state. auto-dismiss at 10s cleans up the Map entry too.

deleteFrame now captures `frameStrokes[id]` before removing it from state, then shows a green toast: "frame N deleted" with an undo button. undo re-inserts the frame id at its original index and restores the strokes. the canvas pixel data in `db[id]` survives the state deletion — that module-level object is never cleaned up — so undo costs nothing beyond a state write.

per-frame stroke undo/redo is untouched. destructive operations get toasts. the two systems don't need to know about each other.

the clown on stilts deleted a frame and got it back. that's the bit.

## third session: fill rendering overhaul

### auto-fill on release — gone

pen tool was auto-filling closed paths with fillColor on every commit. confusing. removed. also pulled the fill-color ghost preview from the pen preview canvas, and the "fill color (pen mode)" section from the settings overlay. flood fill bucket still has its fill color palette in the sidebar — that's different and stays.

### three-pass rendering

fill + stroke rendering is now three passes:

**pass 1 — boundary.** draw all strokes at opacity=1 on an offscreen canvas. solid walls, hard edges, no fringe leaking.

**pass 2 — fill.** `floodFillOnto` reads walls from the boundary canvas but writes only to a separate `fillOnly` canvas. no destination-out, no dead-pixel fringe at stroke edges. fill threshold is `d[pi+3] < 255` — fills everything that isn't a fully solid pixel, so anti-aliased fringe is covered.

**pass 3 — paint.** composite fills onto the main canvas, then redraw strokes at their real opacity and anti-aliasing on top. no fills → skip the whole thing, draw strokes directly.

### undo skips no-ops

fill tool was calling captureUndo before checking whether anything would change. clicking a filled region twice burned an undo step for nothing. now: for flood fill, read the pixel at the click point — if it already matches fillColor, bail before captureUndo. for stroke recolor, check that at least one point color differs. draw and erase are unaffected.

this is starting to feel really good.

## fourth session: saga-crawler, sillyz-avatar, plan98-boxart

### saga-crawler

ported from plan98. faithful CSS — the full 3D skybox with perspective, rotateX crawl, all the face transforms. only three things changed: imports, the wallet button became a branded-button labeled "edit" in the top-left, and clicking it opens lore-baby in a modal instead of navigating to paper-pocket. skip intro got z-index 200 so it clears the skybox. default saga copied from plan98 cdn.

### sillyz-avatar

the plan98-boxart inline SVG was stripped — no keyboard keys, no mouse, no cable. the original lives in a separate `sillyz-avatar` elf with a complete keyboard (dozens of individual key paths), a mouse, and a cable connecting them. ported it properly. shoes take a `--shoe-color` CSS variable with a fallback. everything else uses the wheel variables.

### plan98-boxart

ripped out the countdown timer. replaced with a debug-gamepads poll at 100ms — any button on any slot calls done(). removed blur from the pulse animation (filter: blur on five simultaneously animated faces was spinning the fan). the boot button is now "Right Now." colors: mediumseagreen hat, firebrick shirt, dodgerblue pants, mediumpurple keyboard fill with gold stroke, darkorange shoes. floor gradient runs the full spectrum. background lemonchiffon. title "Create / Endlessly."

the clown on stilts booted right now.

— DEADFA11-CAFE-BABE-C0DE-BEEFFACE2026
