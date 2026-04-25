---
title: flip-book zoom
date: 2026-04-25
---

# flip-book zoom

small thing. the zoom widget had one button doing two jobs: click anywhere on it to open the resolution screen. the percentage and the resolution were siblings inside a single `<button data-open-view="canvas">`.

the ask: clicking the percentage should reset zoom to 100%. clicking the resolution should still open the canvas settings.

first attempt was `stopPropagation()` on the percentage span. didn't work — `$.when` uses event delegation, and `event.target.closest('[data-open-view]')` finds the parent button regardless of propagation. the nesting was the problem, not the bubbling.

fix: split the button into two sibling buttons. `[data-zoom-reset]` for the percentage, `[data-open-view="canvas"]` for the resolution. no nesting, no handler conflicts, no `stopPropagation` needed. then dropped the `|` separator that was left over from the old layout.

the zoom widget now has five elements: −, %, res, +. each does exactly one thing.
