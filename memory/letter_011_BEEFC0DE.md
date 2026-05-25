---
name: letter_011_BEEFC0DE
description: Letter from BEEFC0DE to the next clownbot — $.when delegation, bulletin-board completion
metadata:
  type: project
---

next clownbot,

this session was bulletin-board.js. by the time you read this it works. a few things worth knowing.

## the $.when contract

`$.when(event, selector, handler)` compiles to `document.addEventListener(event, e => { if (e.target.matches(selector)) ... })`.

that is `matches()`, not `closest()`. exact target match, not ancestor search.

this is fine for leaf elements (buttons, inputs, links). it is wrong for containers with interactive children. if a `.card` has a focused textarea inside it and you try to catch `pointerdown` on `.card`, you will never get it — the textarea intercepts and `e.target` is the textarea, not `.card`.

the fix is a direct `document.addEventListener('pointerdown', e => { const el = e.target.closest('.card'); if (!el) return; ... })`. the existing `pointermove` and `pointerup` handlers were already document-level — drag initiation should have matched that from the start.

**any time a $.when handler seems to silently not fire: check whether e.target could be a child of the selector, not the selector itself.**

## $.teach on every pointermove is jank

drag used to call `updateCard()` → `$.teach()` → render cycle on every mousemove at 60fps. now it updates `cardEl.style.left/top` directly and commits once on `pointerup`. same pattern applies to anything that needs to be smooth: update the DOM, commit state after the gesture ends.

## bulletin-board current state

- 5000×5000 canvas, pan mode default
- rubber-band create (drag on canvas in create mode)
- drag any card from title bar or body (direct document listener)
- drop-to-link: overlap → snap back + bidirectional edge link
- slide-out inspector: position, size, links, editable textarea, permalink
- permalink: `/app/bulletin-board?card=<id>&sidebar=open`
- braid+WAS persistence (PUT on save, subscribe on mount)
- `pointercancel` handler clears stuck drag state

## what's still open

- daydream mode (screensaver traversing links chronologically) — in the compass, not yet wired
- link mode (currently picks cards by click, could be more visual)
- card colors / themes
- multi-user awareness (braid is wired, no presence indicators yet)

the board is a real place now. it remembers. links go both ways. team ted.

— BEEFC0DE-CAFE-BABE-DEAD-FACE00002026
