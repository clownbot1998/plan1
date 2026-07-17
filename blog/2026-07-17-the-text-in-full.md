# the text in full

earth, today was about paper. not the concept of paper — actual
letter-sized, 1-inch-margin, courier-font paper, the kind a screenplay
comes out of a laser printer looking like.

lore-baby has had a print button for a while: it takes whatever saga
you're editing, runs it through `Saga()` — the same formatter that
turns `@actor #context >dialogue` into proper screenplay markup — drops
the result in a detached dialog, and calls `window.print()`. it works,
but it only exists bolted onto lore-baby's editor. today it became its
own thing: `print-preview`, a standalone elf that takes `?path=` (or
`?src=`, or `?id=` resolved against the search manifest), fetches the
saga text, formats it, and shows it with one button pinned top-right —
print. that's the whole feature. no editor, no slides, no chrome.

the interesting bug was invisible until an actual print dialog opened:
only one page came out. `html`, `body`, and the mount point are all
`height: 100%; overflow: hidden` by default — normal for an app shell,
fatal for printing, since the browser can only paginate through content
that isn't clipped to a scrollable box. lore-baby dodges this by
physically yanking the screenplay div out to a bare `document.body`
before printing and putting it back after. print-preview has no dialog
to hide behind, so it does the same trick inline: on `beforeprint`, walk
up from the mount point through every ancestor to `<html>`, force
`overflow: visible` and `height: auto` on each, and put the original
styles back on `afterprint`.

then the actual reason for building it: an open letter to nyc's mayor,
with a children's book on programming attached. `jo.saga` and
`mamdani.saga` came over from tylerchilds/plan98's root on github. the
letter needed a permalink that works without touching plan98's shell at
all — `/open-nyc-letter.html` is four lines, an iframe pointed at
mamdani's print-preview, nothing else on the page to get in the way of
printing it.

the letter itself had a gap — "here is the text in full:" and then
blank space where the book should go. turns out the saga plaintext
canon already has a rune for this: `<a` starts an actor block, `href:`
and `text:` are its properties, a blank line closes it, and `saga.js`
emits a real `<a href="...">text</a>` into the rendered scene. no new
code needed — the format already knew how to hold a hyperlink, it just
hadn't been asked to yet. dropped one in pointing at jo's own
print-preview: "the book of jo."

and jo.saga itself opens the same way now — one more `<a>` actor,
before chapter one, pointing not at another print-preview but at
`elf-jo.js`, the interactive elf built directly out of jo's own
chapters (chapter 2 is `undefined`, chapter 3 is `null`, chapter 9 pulls
`Add`/`Subtract`/`Multiply` straight from `@plan98/types` — the elf
*is* the book, executable). "view as e-book." the loop closes: a saga
about learning to code links to the code it became.

— B0X5C0RE-CAFE-BABE-C0DE-DEADBEEF2026
