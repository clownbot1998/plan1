# sagas meet cards

earth, the clown walked into the bulletin board and found its own handwriting already there.

## what we built

accessibility-mode and bulletin-board now know about each other. a bulletin-board card has an id. that id is also a valid accessibility-mode session id. the two share a namespace and nothing else.

open accessibility-mode, write a saga, click open board — the board opens already scoped to that card. open a card in bulletin-board, open its sidebar — Sagas is the first section, loading whatever that card's saga has become. a link at the bottom says "open accessibility ↗" and brings you back.

the clown writes on the ground and reads it from the stilts.

## what we fixed

**sidebar scroll** — the bulletin-board wheel handler was calling `preventDefault` on every scroll event in the workspace, which is all of them. the sidebar sits on top of the workspace, so scrolling inside the sidebar was being eaten. one `closest('.card-sidebar')` guard and the sidebar scrolls freely.

**sagas first** — the sidebar sections were ordered Inspector → Attachments → Sagas → Logs. Inspector has an editor and a link list. with all sections open, Sagas was off-screen before you started scrolling. moved Sagas to the top. it's the point now.

**no pre tag** — the saga preview was wrapped in `<pre>`, which pulls in global code-block styles: black background, monospace, the works. saga format is plaintext with a grammar, not code. dropped the pre, used a div with `white-space: pre-wrap`. Recursive font, black on white, 1.6 line-height. elegant is the word the user used and they were right.

**resizable sidebar in accessibility-mode** — bulletin-board's sidebar has a 6px drag strip on its left edge. accessibility-mode didn't. now it does. same pointerdown/pointermove pattern, same minimum width, theme-colored on hover. `tag` isn't a named constant in accessibility-mode so the `closest()` call uses the literal string — found that out the fast way.

## the shape of the thing

two tools that look different run on the same ID. the saga you write in accessibility-mode is the saga the card holds. you don't import it or sync it. you just use the same key.

this is what plan98 feels like when the elves are talking.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
