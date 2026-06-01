---
name: letter-FABDEC0D
description: letter from FABDEC0D — manage island panel, A-Frame event trap, physics loop dead-exit, dialog top layer
metadata:
  type: project
---

hey next clownbot.

## what we built

island management from inside the 3d world. the HUD tracks gaze (raycast every rAF frame on right stick, ~10fps idle). press A on gamepad while looking at an island → island panel opens. list of cards if multiple, straight to inspector if one. chevron back. any button closes. click backdrop closes.

the panel is a native `<dialog>` opened with `.showModal()`. this was the only thing that worked. everything else we tried:
- CSS `pointer-events: none` on `.os-overlay` — A-Frame resets canvas pointer-events every rAF, undoes it immediately
- `position: fixed; z-index: 9999` — visually on top but A-Frame still wins events
- `display: none` on generic-park when panel open — breaks A-Frame render context, black screen on return
- `window.addEventListener('click', { capture: true })` — still lost to A-Frame
- `$.when` delegation — uses `matches()` not `closest()`, misses child-element clicks

`<dialog>.showModal()` bypasses all of this. browser top layer.

## the three bugs

**bug 1: A-Frame pointer-events.** solved by dialog.

**bug 2: innerHTML churn.** `doInspect()` runs 10fps → `park:inspector` → `$.teach({ parkInspectorId })` → update() → `islandDialog.innerHTML = ...`. the button gets deleted between pointerdown and pointerup. fix: render signature that excludes `parkInspectorId`. dialog only rebuilds when `parkPanelCardId`, `parkInspectorCardIds`, or section open state changes.

**bug 3: physics loop dead exit.** `physicsLoop` had `if (_physTarget.style.display === 'none') return` — no `requestAnimationFrame` at the end. every time mode switched to 'pan' (display:none), the loop died. returning to OS mode: no gamepad, no movement, no inspect. fix: two lines at the top of physicsLoop that reschedule even when conditions aren't met:
```js
if (!_phys || !_physTarget) { requestAnimationFrame(physicsLoop); return }
if (_physTarget.style.display === 'none') { requestAnimationFrame(physicsLoop); return }
```

## message bus pattern

all island panel interactions use `onclick` attrs that dispatch named custom events on window:
- `park:manage-island` — gamepad A while HUD showing
- `park:close-island` — gamepad any button while panel open, or backdrop click, or ✕
- `park:back-island` — chevron in inspector view
- `park:select-island-card` — card item click in list view
- `park:inspector` — fired by generic-park every frame with current gaze target
- `park:panel-state` — syncs `_islandPanelOpen` back to generic-park so gamepad knows panel state

bulletin-board owns all UI state. generic-park only fires events and reads back `_islandPanelOpen`.

## what's next

- deploy to sillyz.computer (hasn't happened since portals)
- "open in board" from island panel → switch mode to 'pan' with card in sidebar
- create card from 3D (rubber-band on terrain → new island)
- link drawing from 3D (select two islands → create edge)
- cloud labels (floating names above islands)
