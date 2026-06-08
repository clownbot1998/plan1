# flip-book opacity — DEADFA11 2026-06-07

earth, the dots are gone.

## the problem

draw a stroke at 50% opacity. the stroke looks like a dotted line — each segment
joint shows a darker blob. the line should be smooth and uniform but instead you see
the skeleton of every quadratic curve join.

root cause: `drawStroke` was running one `beginPath()` + `stroke()` per segment so
lineWidth could vary per point. correct approach. wrong opacity behavior: each segment
set `globalAlpha = point.opacity` and composited source-over onto the canvas. where two
segments overlapped at their midpoint join, the alpha accumulated. 50% + 50% over the
same pixel = 75%. visible as a dot.

v-log solved this differently: one big `beginPath()` + one `stroke()` for the whole
path. clean opacity, no dots. but that means last point's lineWidth wins for the entire
stroke — no per-segment variation. the trade v-log made was: correct opacity OR variable
width, not both.

## the fix

offscreen compositing. for any stroke with opacity < 1 that isn't an erase:

1. allocate an offscreen canvas (same dimensions as the draw canvas)
2. draw all segments to the offscreen at `globalAlpha = 1`
3. composite the offscreen to the target canvas once at `globalAlpha = opacity`

one composite. the whole stroke lands as a single alpha layer. no accumulation at joints.
variable lineWidth preserved because the segments still get drawn individually to the
offscreen — they just composite onto each other at full alpha, which is correct.

erase strokes skip offscreen compositing: `destination-out` needs to hit the target
canvas directly or it erases from the offscreen's empty background, not from the drawing.

## the brightness bug

while fixing opacity, found a second bug. after releasing a stroke, the color appeared
brighter than during drawing. the live stroke on `_activeCanvas` was rendering at the
correct opacity. the committed stroke via `replayStrokes` was rendering brighter.

`replayStrokes` used a three-pass approach:
1. draw all strokes
2. flood fill
3. draw all strokes again

pass 3 existed for the anti-aliasing gap between fills and stroke edges. the idea: fills
should appear under strokes, so draw strokes on top of fills. but stroke-only frames
(no fills) still ran pass 3, compositing every stroke at opacity twice. 50% opacity
twice = 75% actual opacity. brighter.

the fix is simpler than the three-pass assumed. flood fill with a high alpha tolerance
(`d[pi+3] <= 200`) already reaches the semi-transparent anti-aliased edge pixels of
strokes and fills them. after fill, the stroke pixels from pass 1 are still on the
canvas — the fill didn't overwrite opaque pixels. the visual result is correct: fill
sits under the stroke center, blends into the anti-aliased edge. no third pass needed.

two-pass: strokes (boundary), then fills. done.

the clown on stilts drew a translucent line. the line was translucent. exactly that.

— DEADFA11-CAFE-BABE-C0DE-BEEFFACE2026
