# flip-book quality of life — DEADFA11 2026-06-07

earth, the flip-book got a real session today. here is what happened.

## compass redesign

the compass petals used to be: color picker, play, gallery, cycle-tool. now they are the tools themselves — draw, erase, pen, fill — with undo and redo staying on the east and west horns where they live. the root button shows the active tool. tap a petal, the tool switches, the petal lights up gold.

no more cycle-through. you see all four tools at once. the compass is a menu now, not a dial.

## wheel and pinch zoom

the canvas gained trackpad and touch gestures. ctrl+wheel zooms centered on the cursor. plain wheel pans. two fingers on the canvas cancel any active stroke and enter pinch zoom. the artboard wheel handler bails when the cursor is over the sidebar or film reel so scrolling those panels stays natural.

## zoom widget to bottom right

moved from the top taskbar down to the bottom right of the canvas, sized up to match bulletin-board's proportions — 1rem buttons, .5rem padding, border-radius 4. feels like a real widget now.

## settings sidebar

the ⚙ settings text button is gone. in its place: a plan98-icon toggle in the top left. clicking it slides in a left sidebar — the first clownbot has ever had one on the flip-book.

contents: load / save / export / share action row at the top, then stroke palette, fill palette, stroke size, opacity, and all the rest of the settings (onion skin, fps, loop mode, canvas resize, camera, chromakey, violin, import). share opens a QR code via the qr-code elf pointing to the flip-book's path-based id.

the sidebar lives outside the artboard so it covers the timeline, doesn't get clipped by overflow:hidden, and doesn't interfere with the wheel pan handler.

## play button as primary CTA

the export link at the bottom left became a play button. .9rem, bold, gold. export is still in the sidebar. the most important button is the most visible one now.

## compass architecture bug

spent time on stilts learning why the compass kept getting lost. the root cause: the toolbelt-actions wrapper was a block element making the compass left-aligned inside a full-width container, so right:0 positioned the container correctly but the compass sat at the left edge. the element thought it was on the right. it was wrong.

fix: mirror bulletin-board exactly. .the-compass IS the positioned element — position:absolute, bottom:calc(80px+1.5rem), right:0, z-index:200, transform on the compass itself. no wrapper.

the belt drag also got a full rewrite: self-contained document-level listeners from pointerdown, releases implicit pointer capture on the root button (browsers capture to buttons on click, which swallowed move events from the artboard delegate), clamp uses root.clientWidth/Height with a live bottom offset read from the actual rendered heights of the film reel and status bar.

## z-index stack

top taskbar raised to z-index 201 so the plan98-icon toggle is always above the compass at 200. the sidebar is at 30. the overlay is at 50. the darkroom is at 100.

the clown on stilts can now find the compass. the sidebar opens. the wheel zooms. the play button plays.

— DEADFA11-CAFE-BABE-C0DE-BEEFFACE2026
