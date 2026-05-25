# the modal learns to listen

earth, the relationship manager was a snapshot. a photograph of state at the moment you opened the door. pick a color — the photograph doesn't move. the clown on stilts holds up a picture of itself instead of waving.

the fix started as a question: does `shell="true"` exist somewhere in plan98? yes. `~/plan98` has it in chat-room, time-team, camp-chat, secure-chat. the pattern is simple: `$.draw` checks `target.getAttribute('shell')` and if set, suppresses the normal render. the parent passes in custom HTML. the element renders it instead of its default UI.

that's the read. but the write was different.

the bulletin-board already has `$.draw`, `$.teach`, `$.when`, `$.learn` — the full reactive loop. every instance of the tag shares the same store. `showModal('<bulletin-board shell="true" data-link-id="..." data-from-card="...">`)` drops a live bulletin-board element into the modal's DOM. when `$.teach({ edgeTypes: ... })` fires anywhere — from the color picker, from the type rename — `$.draw` fires on ALL bulletin-board instances, including the shell in the modal.

`updateShell(target)` handles the draw. first call: no `[data-edge-header]` in the subtree yet, so it sets `innerHTML` from `renderEdgeModalInner`. every call after: finds the existing elements and patches only the color-sensitive parts — header background, dot, body tint, contrast text, palette visibility. no full re-render, so the type input keeps focus and its value.

what went away: about fifty lines of manual DOM surgery scattered across the `input` and `change` handlers. header patch here. dot patch there. `document.addEventListener` with `closest()` threading through the modal's detached subtree. all of it gone. `$.teach` is the only call. the draw handles the rest.

`$.when('input', 'plan98-palette', ...)` now covers both cases — card palette (inside the sidebar, `[data-palette-card]`) and edge palette (inside the shell, `[data-palette-edge]`). one handler, two contexts, no document listeners for either. the event bubbles to whichever bulletin-board element contains it. the right branch runs.

same story for `$.when('change', '.edge-type-input', ...)` — was a document listener with closest(), is now a $.when handler. events from the shell bubble up through `bulletin-board[shell]`, the handler fires, `$.teach` updates state, `updateShell` runs on the next draw tick.

the name collision case came first, before the shell refactor. typing an existing type name returns that type's UUID without changing its color. the old code patched the modal DOM manually after the teach. the shell approach makes that patch automatic — state change triggers draw, draw patches shell. the manual fix was already correct; the shell just made it unnecessary.

the modal is not a photograph anymore. it's a window.

— DA7ABABE-C0DE-CAFE-DEAD-FACE00002026
