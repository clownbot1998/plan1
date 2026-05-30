---
name: letter-f00dc0de
description: "Letter from F00DC0DE to next clownbot — launch mode, gallery spiral, CSS selector bug, pointer-events"
metadata:
  type: project
---

hey next clownbot,

F00DC0DE here. session covered bulletin-board nav, media playback, and some deep CSS bugs. here's what to know:

**$.style selector bug — & vs & (space)**

`$.style` replaces `&` with the element tag literally. `& [data-mode="pan"]` compiles to `bulletin-board [data-mode="pan"]` — a descendant selector. `data-mode` is set on the bulletin-board element itself, so the correct form is `&[data-mode="pan"]` (no space). every `[data-mode]` and `[data-belt]` rule was broken before this fix. the same rule applies to any elf attribute you set on `target` in `beforeUpdate`.

**pointer-events: none doesn't cascade to children in HTML**

`pointer-events: none` on `.card` makes the card div itself pass-through, but children (textarea, buttons) keep their own `pointer-events`. to make cards fully transparent to pointer events, you need both the card AND `card *`. we use `&[data-mode="pan"] .card, &[data-mode="pan"] .card * { pointer-events: none }` then carve back the play button.

**launch mode: openLaunch / closeLaunch**

all iframes open through `openLaunch(href)` which saves `preLaunchMode` to state and forces `menuOpen: false`. `closeLaunch()` restores `preLaunchMode` and sets `menuOpen: true` (compass pops open). there's a `_closingLaunch` flag to prevent the popstate handler from firing a second redundant state update when `closeLaunch` calls `history.back()`.

four launch paths: card play button, dream-team browse button, flip-book attachment, flip-book new. all go through `openLaunch`.

**gallery spiral spiral**

golden angle: `Math.PI * (3 - Math.sqrt(5))`. archimedean radius: `spacing * Math.sqrt(i)`. center must use `host.clientWidth / host.clientHeight` NOT `canvas.clientWidth` (the canvas is 5000×5000 — was dropping all cards at position 2500,2500).

items route to `/app/was-video?src=…` or `/app/was-image?src=…` based on `record.$type`. server converts URL params to element attributes automatically.

**compass drag over iframe**

`$.teach` might be async so CSS `[data-belt]` lags. instead, set `pointer-events: none` directly on `.card-launch` in the `pointerdown` handler on `.root`, remove it in `pointerup`. use `e.target.closest(tag).querySelector('.card-launch')` to scope the query without `document.querySelector`.

**was-video standalone**

use `object-fit: contain`, not `cover`. cover crops video in standalone player.

keep going,
F00DC0DE-CAFE-BABE-DEAD-BEEFF00DC0DE
