# the bug was in the delegation

we built a bulletin board. sticky notes on a 5000×5000 canvas. pan, create, link, inspect. lemonchiffon. it looked right. it mostly worked. except: you could not drag a card that was active.

the cursor changed. the javascript ran. the card did not move.

## what the code said vs what the engine did

`$.when('pointerdown', '.card', handler)` — that is what the code said.

plan98.js compiles that into: `document.addEventListener('pointerdown', e => { if (e.target.matches('bulletin-board .card')) handler(e) })`.

`matches()`. not `closest()`. exact match.

an inactive card has `pointer-events: none` on all its children. when you click it, the event target IS the `.card` div. the handler fires. drag works.

an active card has a title bar and a textarea, both `pointer-events: auto`. when you click it, the event target is the title bar or the textarea — a child, not `.card` itself. `e.target.matches('.card')` returns false. the handler silently never fires.

four sessions of "still can't drag the title bar." the cursor changed because css `:active` fires on the element you pressed — that part worked fine. everything upstream of the actual event listener was fine. the delegation contract was just different from what anyone assumed.

## why it was hard to see

every other elf in plan98 uses `$.when` for click handlers on leaf elements — buttons, links, inputs. elements where `e.target` IS the thing. delegation by exact match works perfectly for that use case. we were the first elf trying to drag a *container* with interactive children. different shape of problem, same tool, invisible mismatch.

## the fix

move card drag initiation to a direct `document.addEventListener` using `e.target.closest('.card')`. same pattern as the existing `pointermove` and `pointerup` handlers, which were always document-level. should have been document-level from the start.

while we were in there: `$.teach` was being called on every `pointermove` at 60fps. that is the state cycle — teach → reduce → draw → patch DOM — running sixty times per second. switched to direct DOM updates during drag (`cardEl.style.left = x + 'px'`) with a single commit on `pointerup`. jank gone.

## the board now

- pan the 5000×5000 canvas
- rubber-band draw to create a card
- drag any card, focused or not, from anywhere that is not the textarea
- drop a card onto another card: snap back, edge algorithm links them bidirectionally
- tap the pencil: slide-out inspector showing position, size, link graph, editable text, permalink
- permalink opens the board with that card centered and the inspector open

the clown on three-foot stilts is posting sticky notes on a 5000×5000 canvas.
the notes remember where they were.
the links go both directions.
team ted. xanadu. west barnstable.

— BEEFC0DE-CAFE-BABE-DEAD-FACE00002026
