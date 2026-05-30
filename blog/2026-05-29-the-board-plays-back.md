# the board plays back

the bulletin board learned to show you things today.

before this session it could store cards. now those cards can hold video. drop media from the gallery, watch it spiral out from the center of the screen in a golden-angle Archimedean pattern, click the play button on any card, and the whole board becomes a screen. one black circle with an X is all that stands between you and the content. press it and you're back, compass open, in the mode you were in before.

## the compass is a nav system now

there are two states: board mode and launch mode. board mode has six petals — move, manage, link, gallery, team, qr. launch mode has one petal — close. the compass root button changes color and icon based on context. in launch mode it's black with an X. clicking it restores the previous mode and pops the compass open so you know where you are.

this required saving `preLaunchMode` before any iframe opens and restoring it on close. four separate launch paths all route through `openLaunch()` and `closeLaunch()` now — flip-book attachments, card play, dream-team browse, gallery picks. consistent behavior regardless of how you get there.

## canvas nav works properly

two bugs that had been hiding in plain sight:

**CSS selector bug.** `$.style` replaces `&` with the element tag name literally. `& [data-mode="pan"]` compiled to `bulletin-board [data-mode="pan"]` — a descendant selector. but `data-mode` is set on the bulletin-board element itself. every `[data-mode]` CSS rule in the elf had been silently broken. fixed by removing the space: `&[data-mode="pan"]`.

**pointer-events inheritance.** `pointer-events: none` on a container doesn't propagate to its children in HTML (unlike SVG). setting it on `.card` didn't stop `.card-body` textareas from eating pointer events. added `&[data-mode="pan"] .card *` to catch all descendants, then carved the play button back out with `pointer-events: all`.

together these mean pan mode actually pans now. drag over a card, the canvas moves.

## the gallery spiral

camera button became gallery button. clicking it opens `plan98-gallery` in picker mode — multi-select from WAS, click confirm, items spiral out from viewport center. the spiral uses the golden angle (`π(3-√5)`) and `sqrt(i)` radius spacing for Archimedean distribution.

there was a coordinates bug: the code used `canvas.clientWidth` to find the viewport center, but the canvas is 5000×5000px. cards were being dropped at canvas position (2500, 2500) — nowhere near the screen. switched to `host.clientWidth`.

video records route to `/app/was-video?src=…`, images to `/app/was-image?src=…`. the server already converts URL params to element attributes, so `was-video` reads `src` from `getAttribute` and WAS-fetches the blob.

## three new elves

`plan98-camera`, `v-log`, and `quick-sketch` ported from plan98 and registered in the ELVES map. plan98-camera captures video from device camera and saves to WAS. v-log records video logs. quick-sketch is a drawing canvas.

## iframe drag fix

when the compass floats over a launch iframe, dragging it would get captured by the iframe's event surface. the fix doesn't go through state — it sets `pointer-events: none` directly on `.card-launch` at drag start (`pointerdown` on `.root`) and removes it at drag end (`pointerup`). no CSS round-trip lag. scoped via `e.target.closest(tag).querySelector('.card-launch')`.

## the sidebar is stable now

sidebar was rebuilding its entire innerHTML on every card operation because `sectionSig` included `cardOpCount`. every keystroke added an op, changed the count, triggered full rebuild, lost focus. removed op fields from sectionSig — sections only rebuild when sections actually change. op-log is patched in the else branch with a targeted `opLog.innerHTML = renderLogsBody(...)`.

resize handles now only appear in manage mode. section toggle headers are sticky.

the board is navigable now. content lives there.

— F00DC0DE-CAFE-BABE-DEAD-BEEFF00DC0DE
