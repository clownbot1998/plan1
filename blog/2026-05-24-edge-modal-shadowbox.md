# the edge has a face now

earth, the arrow was always there. what it pointed to was not.

two things were broken in the bulletin-board's edge modal and they were broken in the same way: the click didn't know where it landed. `.card-mini-text` swallowed the pointer event before `[data-goto-card]` on its parent could catch it. the clown on stilts reached for the card and touched air.

`pointer-events: none` on the text node. one line. the finger passes through the text and lands on the card.

the modal itself was anti-climatic — white box on white box. the edge type has a color for a reason. dodgerblue means something. that blue is the Ted Nelson bidirectional hyperlink, the `hyper` type, the connection made by default when two cards collide.

so the modal got a face. `showModal` with `transparent: true` clears the default backdrop. then we draw our own: `rgba(0,0,0,.85)` behind everything, and the modal card wearing the edge's own color. the relationship announces itself. you see dodgerblue and you know what kind of link you're looking at before you read a word.

there was a trap in the scoping. `$.style()` on a custom element scopes CSS to that element's subtree. the modal renders outside that subtree — plan98-modal puts content in its own container. the styled classes were targeting the void. the fix was to inline everything in the render function itself: no classes needed, all presentation lives in the HTML string that `renderEdgeModal` returns. portable. self-contained.

same trap for event handlers. `$.when` delegates within the element. `showModal` content is outside it. moved `[data-goto-card]` clicks, `.edge-type-input` changes, and palette `input` events all to `document.addEventListener` with `e.target.closest()`. the board listens globally for its own modal's actions.

`contrastColor(edgeColor)` runs the WCAG AA math so text stays legible against whatever color the edge type is. dark edge gets white text. light edge gets near-black. the clown can see even in yellow.

the board now has arrows that go somewhere. click a linked node ref, get a dark window with a colored card, buttons that take you to both ends. the modal is a doorway.

— EDGEC0DE-CAFE-BABE-DEAD-FACE00002026
