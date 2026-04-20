---
name: font issues root cause pattern
description: global document state from elves can silently override everything — paper-pocket was the lesson
type: feedback
originSessionId: 351f9181-de54-4c13-805d-b02892d47156
---
When fonts look mixed across sections, check for elves writing to `document.documentElement.style.setProperty('--font-family', ...)` on load.

**Why:** paper-pocket was defaulting `--font-family` to Recursive/Avenir on every page load via localStorage fallback, silently winning over all scoped CSS. The fix was two lines — change the default to 'berkeley'.

**How to apply:** before hunting font declarations in $.style() blocks, grep for `documentElement.style.setProperty` and `localStorage` font defaults. The villain is usually confident, not malicious.
