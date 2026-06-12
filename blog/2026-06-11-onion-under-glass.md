# onion under glass

the flip-book had a problem with full images. you'd import a photo, turn on onion skin, and the current frame would look ghosted — dimmer than the frames behind it. older frames seemed more solid than the one you were actually on. backwards.

the root cause was a layer ordering assumption that held until it didn't.

previously, the composite loop drew everything — background image and strokes — into one canvas (`_outputCanvas`). the onion canvases sat behind it, so the current frame's photo, painted at full opacity onto `_outputCanvas`, covered whatever the onion layers were doing. it didn't matter that the onion canvases included previous frames' background images, because you never saw them.

to fix the layering we split the output into two: `_bgCanvas` at z-index 5 carries the background image, `_outputCanvas` at z-index 10 carries only the strokes. onion layers sit between them at z-index 6–9.

that split exposed the hidden assumption. onion layers were still rendering previous frames' background photos. now that `_bgCanvas` was beneath them, those ghosted backgrounds stacked on top of the current frame's photo — at 0.8, 0.6, 0.4, 0.2 opacity — washing it out.

the fix: onion skin should only ghost the drawing strokes, not the background. removed `f.videoCanvas` from `renderOnion`. the onion was always about seeing where your lines were, not replaying the photo underneath them.

video export, live streaming, and the darkroom player are unaffected — they composite from the source canvases directly and never touch `_outputCanvas` or `_bgCanvas`.

the clown draws on stilts. when the stilts were invisible you couldn't tell they were there. now you can see the floor.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
