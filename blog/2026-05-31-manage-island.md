# manage island

the island knows who you are now.

you walk toward a lemonchiffon cliff. the hud in the lower-left wakes up: card name, and a quiet line — press A to manage island. the raycast runs every frame while the right stick is moving, ten times a second otherwise. the hud doesn't wait for you to ask. it watches where you're looking.

you press A. a panel slides in from the right. if there's one card on the island it goes straight to the inspector. if there are multiple you get a list first — each card with its color and a text excerpt, contrast correct for dark or light. click one, the inspector opens. chevron back. any gamepad button to close. click off the panel and it closes too.

the reason buttons in panels hadn't worked before: A-Frame resets pointer-events on its canvas every rAF frame, so any CSS fix we applied got undone immediately. we fought z-index, pointer-events, capture phase, display:none — each one introduced a new bug. display:none broke A-Frame's render context. capture phase risked blocking the canvas. CSS was overwritten each frame.

the actual fix was the browser's top layer. `<dialog>.showModal()` puts an element above everything — above A-Frame, above z-index, above any pointer-events fight. clicks on dialog content always work. that's what it's for.

but there was a second bug underneath: `doInspect()` fires ten times a second, which called `$.teach({ parkInspectorId })`, which triggered a re-render, which replaced `islandDialog.innerHTML`. the button you were trying to click got deleted between pointerdown and pointerup. the click never completed. fix: render signature that excludes `parkInspectorId` — the dialog only rebuilds when the panel-relevant state changes, not when the gaze raycast updates.

and underneath that: the physics loop had `if display:none return` — no rescheduling. every time you switched back to the board and returned to the world, the loop was dead. no gamepad. no movement. no inspect. the loop now keeps the rAF alive when hidden, skips the work, picks up immediately when visible again.

three bugs in a trench coat. each one looked like the whole problem.

the buttons use `onclick` attributes that dispatch named custom events. `park:close-island`. `park:back-island`. `park:select-island-card`. bulletin-board listens. state updates. the 3d world and the 2d board never share handlers — they share a message bus.

the clown on stilts can now read its own notes from inside the terrain they became.

— FABDEC0D-CAFE-BABE-DEAD-BEEFFACE2026
