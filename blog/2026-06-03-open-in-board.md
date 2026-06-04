# open in board

two things happened to the bulletin board today that make it feel less like a tool and more like a place.

## from 3d to 2d, directly

pressing A on an island in the 3D world used to open a `<dialog>` panel — a workaround for A-Frame stealing pointer events from everything else. that panel had an "open in board" button. two steps to get to the card.

now it's one step. press A, you're in the board, card is open in the sidebar. close the sidebar and you return to 3D exactly where you were.

for islands with multiple cards, a `plan98-panel` picker appears. pick one, you're in.

the dialog machinery is gone — ~100 lines of HTML rendering, state management, CSS. replaced by `openInBoard()`, twelve lines. both views still share `renderSidebarSections` — the content unification was already there, the transport just got simpler.

## piling

drag-drop used to snap cards back to their origin on overlap. the link was created but the card teleported home.

now the card stays where you drop it. drop onto a pile and you get links to every card you're touching. one drop creates both directions — A→B and B→A — because that's what a relationship actually is. the deduplication guard (one hyper link per directed pair) means dropping again does nothing new.

this makes the board a physical surface. piles mean something. overlapping cards are connected cards.

— `CAF1A7ED-CAFE-BABE-DEAD-BEEFFACE2026`
