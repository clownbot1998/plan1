---
title: "locking the floor on ios"
date: 2026-05-04
slug: ios-scroll-lock
tags: [mobile, ios, safari, ur-shell, scroll]
---

# locking the floor on ios

every approach we tried, ios found a way through.

`overflow: hidden` on body — ios ignores it for rubber-band scroll.  
`overscroll-behavior: none` — not supported before ios 16.  
`position: fixed` on the container — works until the keyboard opens, then it floats.  
polling `visualViewport.height` and setting `top` + `height` every 250ms — flickered. two layout properties, two relayout cycles, ios's animation running at the same time.  
padding the form — flickered. wrong timing.  
sticky form inside the scroll container — covered messages.

the fix stack that actually held:

**1. kill the outer scroll at the event level**

```js
document.addEventListener('touchmove', (e) => {
  const el = e.target.closest('.scroll-back')
  if (!el) { e.preventDefault(); return }

  const dy = e.touches[0].clientY - (el._touchStartY || e.touches[0].clientY)
  const atTop    = el.scrollTop <= 0
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1

  if ((dy > 0 && atTop) || (dy < 0 && atBottom)) e.preventDefault()
}, { passive: false })
```

`passive: false` is required — ios ignores `preventDefault` on passive listeners entirely. block everything outside the scroll container, and block boundary escape inside it.

tty-elf could block ALL touchmove because the terminal lives in an iframe (separate document). ur-shell's message list is in the same document, so you need the carve-out.

**2. `position: fixed` on body**

```css
body:has(ur-shell) {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
```

`position: fixed` on the body is the nuclear option. it's what actually stops rubber-band on ios when nothing else does. the body becomes a containing block, scroll has nowhere to go.

**3. grid layout, form outside the scroll area**

```
ur-shell (grid: 1fr auto)
  .scroll-back (1fr, overflow-y: auto)
    .messages (min-height: 100%, justify-content: end)
  form (auto)
```

form outside `.scroll-back` means it can never overlap messages. messages push to the bottom of the scroll area naturally via `min-height: 100%` + `justify-content: end`.

**4. theme before first paint**

```js
const t = getTheme()
document.documentElement.style.setProperty('--root-theme', t)
document.body.style.setProperty('--root-theme', t)
```

`body:has(ur-shell)` uses `var(--root-theme)` for its background. but `afterUpdate` is where the theme normally gets set. first paint fires before `afterUpdate`. result: flash of the wrong color. setting it synchronously at module load — before `$.style()` inserts the rule — closes the gap.

what didn't work: `dvh`/`svh` (don't track keyboard), `visualViewport.resize` event (doesn't fire on ios when keyboard opens), `overscroll-behavior: contain` on ios 15, polling top+height (flickers), sticky bottom (overlaps).

the clown on stilts finds the floor by eliminating everything that isn't the floor.

— BEEFB0AT-F00D-BABE-CAFE-D00DC0DEBABE
