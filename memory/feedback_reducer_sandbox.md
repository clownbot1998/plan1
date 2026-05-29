---
name: feedback-reducer-sandbox
description: plan98 reducers are sandboxed — they cannot close over outer scope; never call module-level functions from inside a reducer
metadata: 
  node_type: memory
  type: feedback
  originSessionId: db8ca58f-8c90-4751-ac78-7754ddee54de
---

plan98's `$.teach(payload, reducer)` stringifies and evals the reducer function in a sandbox. Closures don't survive — any reference to a module-level variable or function inside the reducer body will throw `ReferenceError: 'X' is not defined` at runtime.

**Why:** CLAUDE.md already warns about this ("reducers can't close over outer scope"), but it's easy to miss when adding a quick side-effect inside an existing reducer (e.g. `wasSave()` inside `mergeMessage`).

**How to apply:** Never call external functions from inside a reducer. Instead, create a wrapper helper that calls `$.teach(payload, reducer)` and then the side-effect:
```js
function addMessage(payload) {
  $.teach(payload, mergeMessage)  // reducer — no outer refs inside
  wasSave()                        // side-effect — safe here
}
```
Replace all call sites with the wrapper. This pattern also makes save triggers explicit and traceable.

See: [[feedback-shell-modal-pattern]] for the related $.when vs document.addEventListener rule.
