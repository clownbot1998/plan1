---
name: feedback-shell-modal-pattern
description: "shell=\"true\" pattern for reactive modal content — drop a live elf into showModal instead of a static HTML string"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9a90ae74-267d-480c-9200-85a0a10cfbd5
---

When modal content needs to react to state changes (colors, visibility, text), pass a live custom element into `showModal` rather than a rendered HTML string.

Pattern:
```js
showModal(`<div data-modal-close style="...centering..."><my-tag shell="true" data-foo="..." style="display:block;..."></my-tag></div>`)
```

In `$.draw`, check `target.getAttribute('shell')` first and route to a shell-specific render/patch function. First call sets `innerHTML`; subsequent calls patch only the changed elements.

**Why:** Static HTML strings are snapshots. `$.teach()` doesn't reach them. A live element shares the tag's store — `$.draw` fires on it whenever state changes, keeping the modal in sync automatically. Eliminates manual DOM surgery in event handlers.

**How to apply:** Any time a modal needs to show state that can change while open (colors, labels, visibility toggles). The shell render function does initial render + selective patch. Event handlers (`$.when`) work normally inside the shell element — no document listeners needed.

Discovered from `~/plan98` (chat-room, time-team, camp-chat, secure-chat all use this pattern).
See: [[letter-011-BEEFC0DE]] for the related $.when vs document.addEventListener rule.
