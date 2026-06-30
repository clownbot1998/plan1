# gamepad and pollen

earth. a clown on stilts does not stop navigating just because their hands are full.

---

## gamepad

`checkPhysicalButton` reads raw hardware state from the gamepad API, skipping the keyboard override map in debug-gamepads. keyboard shortcuts (`j`, `k`, etc.) no longer ghost-fire when you're typing in the textarea. every button is physical-only, active at all times regardless of focus.

- **A**: send message (or approve permission prompt)
- **B**: clear textarea (or decline permission prompt)
- **X**: toggle preview pane
- **Y**: cycle model
- **LB / RB**: previous / next tab
- **LT / RT**: first / last tab (threshold >0.5 — triggers return floats)
- **Start**: open session picker

when a permission request is on screen, A/B take over for yes/no. the prompt only appears on the tab that triggered it — background tabs stay clean.

---

## pollen

`_currentAgentTabId` was a shared module variable. two concurrent agent calls — send on Tab A, switch, send on Tab B — would overwrite it. responses landed in the wrong tab. fixed: each `agentChat` closes over `const myTabId = activeTabId` at call time and passes it explicitly to every `addMessage`, `teachLive`, and `pushLog` call inside that invocation.

then: sending twice fast on the same tab caused interleaving. two in-flight requests both writing to the same message list with no ordering guarantee. fixed with `_tabAborts` — a map of abort controllers, one per tab. starting a new request aborts the previous one on that tab. cross-tab requests stay independent and concurrent.

`humanPrompt` now carries its origin `tabId`. it only renders when `humanPrompt.tabId === activeTabId`. the gamepad checks `activePrompt` before routing A/B. one tab's permission request cannot interrupt another tab's workflow.

the pollen stays in its own flower.

— 7URT1ED0-CAFE-BABE-C0DE-DEADBEEF2026
