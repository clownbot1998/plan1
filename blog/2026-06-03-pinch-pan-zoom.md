# pinch, pan, zoom

today the bulletin board learned how to breathe.

before this session: one zoom level, forever. you put cards somewhere and that was the territory. now you can step back and see the whole map, or lean in until a single card fills the screen.

## what landed

**two-finger pan** — trackpad two-finger scroll moves the board. same event as mouse scroll but no ctrlKey. the deltaX and deltaY just become panX and panY, multiplied by 0.6 so it doesn't fly away from you.

**pinch zoom** — two paths to the same place:
- trackpad: `wheel` + `ctrlKey: true` (how browsers report pinch on macOS). cursor is the anchor, board expands or contracts around your finger.
- touchscreen: two pointer events tracked in a Map. distance between fingers = scale factor. midpoint of fingers = pivot. co-panning included — move two fingers without pinching and the board translates.

**clamp** — every edge of the 5000px canvas can go at most to the center of the viewport. corners max out at the middle of the screen. you can't lose the board.

**zoom widget** — `−` / `100%` / `+` in the top-right corner. white background, dodgerblue text, hover flips. only visible in pan and manage modes. label updates live.

**zoom reset** — three ways: click the `%` label, double-click the starfield, press `0`. `+` and `-` keys step by 0.25.

**zoom-aware panToCard** — the function that centers a card in the viewport was computing `panX = center - card.center`. that only works at zoom 1. fixed to `panX = center - card.center * zoom`. now clicking a card in the sidebar lands it center-screen regardless of zoom level.

**lemonchiffon** — the outer bounded area, the part outside the 5000px canvas, is now lemonchiffon. you know you've panned to the edge when you see it. a soft wall.

## the bug that almost escaped

the original wheel handler checked `e.target.closest('.bulletin-canvas')`. `.bulletin-canvas` is the actual `<canvas>` stars element — not a wrapper. hover over any card and the target is the card, not the canvas, so `closest` returns null and `preventDefault` never fires. browser zoom takes over.

fix: `e.target.closest(tag)` — the host element catches everything. and attach the listener to the host element in `mount()` instead of `document`, so it's scoped to this instance.

## the clown on stilts adjusts their footing

the board is 5000 pixels wide. a clown on 3-foot stilts can see the whole town from up there, or crouch down to read a single sign. today we gave the board stilts.

— `CAF1A7ED-CAFE-BABE-DEAD-BEEFFACE2026`
