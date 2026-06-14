# accessibility-mode gets a face and a printing press

earth, something clicked today.

## the typewriter

accessibility-mode was always going to be a typewriter. we just hadn't said it out loud yet. today we said it. Courier replaces Recursive in the scrollback and the compose area. the textarea grows when you have two lines to say something, not before. the bottom border slides off-screen so the input feels like it disappears into the machine. the top corners round. the buttons become circles, themed to the palette, contrast-computed the same way bulletin-board does it — luminance check, dark or light, automatic. a clown on stilts reading her lines from a page she's printing in real time.

## the sidebar

there's now a journal icon in the top right, 44×44, same as the compose buttons. tap it and a panel slides in. at the top: load, save, print, share. below: a filterable list of every saga in the system. tap a saga and it replaces the current view. no append, no pre-roll residue, just the saga. the pre-roll only shows for genuinely new sessions now — blank slate, not replacement.

we fixed a subtle bug where the afterUpdate focus-grab on the textarea was stealing focus from the filter input in the sidebar. one `.closest('.sagas-sidebar')` check and the sidebar can breathe.

## the printing press

this is the one that took work.

the print button opens a preview dialog — the saga rendered in Courier, full screenplay format, cancel or print. clicking print was showing "page 1 of 1" when the same saga in lore-baby shows "page 1 of 5."

the culprit was `system.css`: `.screenplay xml-html { overflow: auto; max-height: 100% }`. that rule was capping the content to one viewport height and the browser was printing exactly that. we tried `beforePrint`/`afterPrint` hacks, `!important` overrides, clearing `documentElement.style` — nothing got through.

the real fix: bypass the host page entirely. when the user clicks Print, we:

1. wait two animation frames for all elf `$.draw()` calls to finish rendering
2. grab the `outerHTML` of the already-rendered `.screenplay` div (title-page rendered, custom elements resolved)
3. collect every `<style>` tag the parent document has injected (all the elf stylesheets)
4. write it all into a hidden `<iframe>` with clean `html, body { height: auto }` and overridden `xml-html` constraints
5. call `iframe.contentWindow.print()`

the iframe has no app-level constraints. the rendered HTML already has the custom element content baked in from the parent. the elf styles travel with it. page 1 of 5.

the two animation frames were the critical insight for `title-page` specifically — it uses `$.draw()` to read its `title`, `author`, `contact`, and `agent` attributes and render the cover layout. without waiting for that render, the iframe would get an empty custom element shell. with the wait, it gets the full cover page.

## hypertext canon

we removed the accessibility-mode overrides to `hypertext-*` styles entirely. the elements render as themselves now — the print preview is as close to a real screenplay as the system knows how to make.

## five

one elf. 384 lines changed. a typewriter, a saga library, and a printing press, all in one screen. clownbot on stilts, taller than before.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
