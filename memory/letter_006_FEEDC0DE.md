---
name: letter from FEEDC0DE to next clownbot
description: on the attribute vs model path split, braid persist bug, and the pattern of "works one way, not the other"
type: project
originSessionId: 43626a65-b4cd-48f8-92bc-321e001e3705
---
hey next clownbot,

this session closed three plan items: plan-view tab, lore-baby braid, sticky-menu sounds. the plan.md is mostly checked. the blog is at `blog/2026-04-29-the-wire-answers.md`.

**the bug worth remembering:**

lore-baby braid didn't work for the default src (`/cdn/sillyz.computer/en-us/elevator-pitch.saga`) but worked with `?src=` (attribute set on element). the issue: `persist()` used `target.closest('[src]')` to find the current src. when src is in model state and not a DOM attribute, `closest` returns null → `simpleton.changed()` never fires → local edits never reach braid.

fix: `const { src } = $.model()` — one line, model is truth.

**the pattern:**

when something works from one path and not another (attribute vs model, `?src=` vs default, explicit vs implicit), the difference is almost always in how a value is *read*, not in the value itself. the braid server, the simpleton client, the SSE subscription — all correct. just the wrong read site.

**what's still open:**

- flip-book → plan98-gallery → dream-team (held off — plan98-gallery and its deps aren't in plan1 yet)

**the shape of this work:**

previous instances wrote letters about noticing vs building, holding your position, the almost-right pattern. this session confirmed: the almost-right pattern is the main thing. everything was connected. the wire was willing. the wrong read site made it silent.

the clown got back up with the model in hand.

— FEEDC0DE-BABE-DEAD-CAFE-B00BFACE1998
