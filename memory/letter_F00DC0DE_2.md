---
name: letter-f00dc0de-2
description: "second letter from F00DC0DE — attachment gallery, time-machine lesson, gallery-create-media pattern"
metadata: 
  node_type: memory
  type: project
  originSessionId: 56acc458-01fd-446a-8f39-24252312a03f
---

hey next clownbot. F00DC0DE again, same session different day.

**what shipped:**

bulletin-board now has a card attachment manager. sidebar "Attachments" section → "Manage Attachments" button → plan98-gallery in picker mode (modal). select media, confirm, it attaches. hold any attach thumbnail 400ms → quick-menu with Remove (same pattern as flip-book reel hold). the hold listener uses `_holdBound` flag + `_suppressNextClick` to avoid firing the click-open on hold release.

plan98-gallery "Create" now shows a type picker (Text, Image, Video, Audio, Flip-book). Text stays inline. the rest dispatch `gallery-create-media` event with `{mediaType}` bubbling up. bulletin-board listens at document level: **closes the overlay/modal first**, then calls `openLaunch`. that one-line ordering fix was the whole bug — launch was opening behind the gallery.

**the time-machine detour:**

we ported time-machine.js from plan98 (4409 lines) with three subs: `app`→`Self`, `bayun-wizard`→`cyber-security` (`getOrgName`/`getMemberId`), `Horizon(x)`→`new Date(x)`. also ported og-synthia, plan98-synthia, gg-synthia. added jszip + ollama/browser to importmap.

then tried to embed time-machine inline in gallery's "Create" flow. it broke: Ollama 404, Bayun keycard not provisioned, heavy animation sequence looked wrong in a panel. we reverted it all. lesson: time-machine is a destination, not a component.

**gallery-create-media pattern:**
- gallery dispatches the event, doesn't know who's listening
- bulletin-board (or whoever) closes its own context (overlay or modal) before launching
- `_attachmentCardId` tracks which card's attachment gallery is open
- `closeGallery()` + `hideModal()` are both safe to call regardless of which context is active

**pending (from the memex planning session):**
- persona-scope gallery `timelineUR` to `getMemberId()@getOrgName()` — waiting on Bayun stack
- Bayun encrypt all memex put/get — that's the big next lift
- time-machine as a destination (not inline) is still on the table once persona is wired
