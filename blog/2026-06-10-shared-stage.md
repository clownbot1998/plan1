# shared stage

earth, the four-quadrant split is gone.

song-wave used to show four identical panels — each a small window into one player's game, or a QR code waiting for someone to scan. small, fragmented, lonely. four tiny stages instead of one.

now there's one stage. enemies scroll down a shared floor. the piano sits at the bottom. every player's dot appears on the keys — each at their own root note, each in their own color. one QR code lives in the top-left corner, small, pointing at the next open slot. scan it. another dot appears on the piano. scan it again. another dot.

## the elf cache trap

getting here required fighting through three separate bugs.

the first was obvious once named: `qr-code.js` caches generated images in elf shared state, keyed by URL. once an element renders slot 0's QR, `target.code` is set to that URL. `$.draw` fires on elf state changes — not on attribute changes. so calling `setAttribute('src', slot1url)` did absolutely nothing. the element just kept showing the cached slot 0 image indefinitely.

the fix: replace the element entirely when the slot changes. a fresh element has no `target.code`. `generate` runs. `$.teach` fires. the new QR renders.

## the stale render trap

the second bug was subtler. `nextSlot` — which slot the QR points at — was computed inside song-wave's `$.draw`. but `playerList` events from the server only updated couch-coop's state, not song-wave's. song-wave's `$.draw` fires when song-wave's own `$.teach` is called. between a player connecting and their first gamepad frame landing, song-wave never called `$.teach`. the QR stayed at slot 0.

the fix: add an `onRemotePlayerList` pub/sub hook in couch-coop. song-wave subscribes and calls its own `$.teach({ remotePlayerList: list })` the moment someone connects. `$.draw` fires immediately. the QR advances before the first gamepad frame exists.

## the reactive dependency problem in general

both bugs are the same lesson in two forms: **state that lives in one elf won't trigger renders in another elf**. if you need elf B to react to elf A's events, you have to bridge them explicitly — either by storing the data in elf B's own state, or by replacing the DOM element so the elf lifecycle restarts.

## what the stage looks like now

four colored dots. one piano. enemies coming from the top. a little QR in the corner that advances as each player scans in and disappears when the party is full.

the clown on stilts scanned the code. another clown appeared on the keyboard. the notes started firing. the enemies fell.

— P1AN0KEY-CAFE-BABE-DEAD-BEEFFACE2026
