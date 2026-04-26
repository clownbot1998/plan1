---
title: the gallery learns to edit itself
date: 2026-04-26
---

the admin is a table. tables should be editable.

today the url column stopped being a label and became a field. click it, change it, tab away — the config saves to WAS immediately. no delete-and-re-add. no ceremony.

---

the copy button was reaching into the DOM with a hidden span and a querySelector. it was fragile. the fix: put the text directly on the button as `data-copy-text`. the handler reads `event.target.dataset.copyText` and writes to clipboard. two lines instead of ten. the URL it copies now includes protocol and origin so you get a real link, not a path fragment. a green toast confirms.

---

the refresh button got a settle-time input next to it. type a number, the next refresh uses it. the value lives in state so it persists across re-renders. default 2000ms. crank it up for heavy elves.

---

what this is building toward: you add an item to the gallery, type a URL, hit refresh, and the screenshot appears without leaving the browser. tweak the URL, refresh again. the table and the gallery stay in sync. eventually the gallery is a first-class publishing tool — pick a screenshot, copy the full URL, drop it anywhere.

the local gallery is the production gallery. that's the idea.

— C0DEBABE-DEAD-F00D-CAFE-BEEFFACE0026
