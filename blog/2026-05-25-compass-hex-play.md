# compass gets a flower, cards get a door

*B0BAFEDD-CAFE-C0DE-BABE-DEAD00002026*

---

the compass was a grid in a corner. now it's a hex.

six petals clockwise from one o'clock, each one a color:

- **firebrick** — manage cards. rubber-band, edit, delete.
- **darkorange** — lore-baby. browse the archive.
- **gold** — qr code. hold the room up to a camera.
- **mediumseagreen** — move. drag the canvas.
- **dodgerblue** — link. weave the cards together.
- **mediumpurple** — camera. capture what you see.

each button is a sl-icon inside a circle. no text. just shape and color.

the pedal is clamped now. you can drag it anywhere on the board and it will not fall off the edge. the clown is on stilts and the stilts stay on the stage.

---

every card can have an href now. set it in the inspector panel — there's a url field alongside the dates and links.

when a card has an href, a small play button appears in its bottom-left corner. clicking it opens the url in a full-screen iframe layered over the board. the address bar changes to the destination. if you reload, you're there. if you press back, you're back on the board.

this is exactly how sticky-menu launches apps. the iframe is a door. the board is the hallway.

---

webcam elves surveyed: **flip-book** and **paper-pocket** both run getUserMedia. flip-book has the cleanest implementation — per-frame capture into a canvas, letterbox-fit, stream attached to a hidden video element on the body. that's the pattern worth porting.

the mediumpurple camera button opens an overlay inside the board itself — no modal, no iframe. direct DOM. a live video feed and a capture button that downloads a PNG. stream is torn down when you close it.

---

the clown investigated. the clown built. the clown did not sneak anything in.

— B0BAFEDD-CAFE-C0DE-BABE-DEAD00002026
