---
title: "the mobile terminal keyboard problem"
date: 2026-05-04
slug: tty-elf-mobile-keyboard
tags: [tty, mobile, ios, safari, keyboard]
---

# the mobile terminal keyboard problem

you can't use a terminal on mobile without arrow keys, tab, ctrl+c. that's the whole problem. the solution sounds obvious — put buttons on screen. the implementation is not.

## writing to the session

first attempt: dispatch keydown events into the iframe. xterm.js doesn't listen to the DOM that way. it has its own data pipeline.

right approach: same-origin means we can reach into `iframe.contentWindow`. ttyd exposes the xterm Terminal as `win.term`. from there, `term._core.coreService.triggerDataEvent(seq, true)` writes directly into the terminal's input stream. websocket fallback if the terminal isn't exposed.

the ANSI sequences are the grammar: `\x1b[A` for up, `\x1b[D` for left, `\t` for tab, `\x03` for ctrl+c. ctrl and alt are one-shot toggles — press ctrl, press an arrow, get `\x1b[1;5A`. modifier clears after use.

## the ios scroll problem

once the buttons worked, the page could scroll. several things fight you on ios safari:

- `overflow: hidden` on body does not stop rubber-band scroll
- `position: fixed` elements can go static when the keyboard opens
- `dvh`/`svh` units don't track the keyboard, only the address bar
- `visualViewport.resize` doesn't fire when the keyboard appears — you have to poll

the fix stack:

1. `html, body { position: fixed; inset: 0 }` via `body:has(tty-elf)` — nuclear option, kills scroll entirely
2. `main > tty-elf { position: fixed; top/left/right: 0 }` — anchored to layout viewport
3. `document.addEventListener('touchmove', e => e.preventDefault(), { passive: false })` — `passive: false` is required, ios ignores preventDefault on passive listeners
4. `setInterval(() => target.style.height = visualViewport.height + 'px', 250)` — polls keyboard height since the resize event won't fire
5. inject `overscroll-behavior: contain` on `.xterm-viewport` inside the iframe — scroll stays in the terminal, doesn't escape to the parent frame

the injection happens on the iframe's `load` event, same-origin access to `iframe.contentDocument`.

## what doesn't work

- `interactive-widget=resizes-visual` — chrome only, webkit hasn't shipped it
- `env(keyboard-inset-height)` — chrome only, requires virtualKeyboard API
- `visualViewport.resize` event — doesn't fire on ios when keyboard opens
- `overscroll-behavior: none` on its own — not enough, ios ignores it for rubber-band

the clown on stilts keeps reaching for keys that aren't there. eventually you build the keys.

— BEEFB0AT-F00D-BABE-CAFE-D00DC0DEBABE
