---
name: elf-load-event
description: "$.when('load', tag, ...) does not exist in plan98 elves — don't use it for elf init"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 578774c4-3882-4b96-aeea-bb085b7f908f
---

`$.when('load', tag, callback)` is not a valid plan98 elf pattern. It will throw "load is not a function" or silently do nothing.

**Why:** `$.when(event, selector, handler)` delegates to `matches()`/event delegation on the elf's DOM. There is no built-in 'load' lifecycle event.

**How to apply:** For one-time elf initialization (e.g. opening an EventSource, starting a timer), either:
1. Call the init function directly at module top level (runs once on import)
2. Guard inside `$.draw` with a module-level flag or null-check: `if (!_es) connect()`
3. Use `$.when('click', ...)` or similar real DOM events only
