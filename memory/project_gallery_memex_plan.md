---
name: project-gallery-memex-plan
description: plan98-gallery as persona-scoped memex view; time-machine relationship; Bayun encryption plan
metadata: 
  node_type: memory
  type: project
  originSessionId: 56acc458-01fd-446a-8f39-24252312a03f
---

Gallery is the streamlined "share things" face of the memex. Time-machine is the full editor. Same WAS store, two interfaces.

**Persona** = a person's current self-imposed access limitation, mapped to a Bayun keycard + WAS space. `getMemberId()@getOrgName()` from cyber-security is the persona key.

**Long-term architecture:**
- Gallery `timelineUR` should be `getMemberId()@getOrgName()` once Bayun stack is fully wired
- All memex `put`/`get` calls should Bayun-encrypt through keycard
- Time-machine and gallery read the same persona WAS path — no separate store

**What's wired today (2026-05-30):**
- Gallery is a public timeline (`ur` attribute, defaults to "public")
- Create picker: Text (inline), Image→plan98-camera, Video→v-log, Audio→v-log, Flip-book→flip-book
- Gallery-share attaches items to cards via bulletin-board

**Why time-machine can't be inlined in gallery yet:**
- Expects Ollama, Bayun keycards, synthia to all be reachable at module load
- Heavy init/animation sequence doesn't adapt to panel context
- It's a destination, not a component

**Why:** persona scoping deferred — needs full Bayun stack before `timelineUR` can be trusted.
**How to apply:** when starting Bayun encryption work, return here first; gallery→persona wiring is the surface integration point.
