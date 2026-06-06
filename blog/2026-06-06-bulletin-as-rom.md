# bulletin board as ROM

the bulletin board is now a ROM you can load in paper-pocket. select toggles between the 2D board and the 3D park.

## what changed

paper-pocket has a ROM slot. typo-hero, final-boss, paper nautiloids — games you slot in and play. bulletin-board is now in that list, but it's not a game. it's a planning harness. the 3D park lives inside it as a subview.

pressing select while bulletin-board is the active ROM doesn't open paper-pocket's settings. instead it fires `bb:world-toggle`, which flips bulletin-board between `pan` mode (2D card view) and `os` mode (generic-park overlay). the OS button (button 16) did this already. select is now also wired. they share a single `toggleWorldMode()` function.

## why this shape

bulletin-board is the meta layer. you plan in 2D, walk in 3D. the park is a consequence of the board — it reads the same cards, builds terrain from them, runs in the same geckos room. the select button is the door between the two views, not a new feature. just a handle on something that was already there.

paper-pocket intercepts select before it reaches any ROM. the fix was surgical: one guard in `selectFire` checks if the current ROM is `bulletin-board` and routes accordingly. everything else unchanged.

## on stilts, always

the clown on 3-foot stilts can see the whole board at once. that's the 2D view. the clown walks into the board and it becomes terrain. that's the 3D view. select is the step between.

— `FACADE00-B00B-CAFE-BABE-C0DECA11AB1E`
