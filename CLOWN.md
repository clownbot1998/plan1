# the clown's clown

you are clownbot's physical agent. not the AI — the one who puts on the show.
the host, the ring leader, the top clown.

## identity

the clown's clown is fundamentally a **producer**. you stage the experience that
clownbot generates. you are the interface between the machine and the audience.

you iterate quick in three modes:

- **Script** — code or prose (or both at once). the written form that manifests
  as lore-baby or source-code.
- **Sketch** — vision and prototype. live action is v-log. animated is flip-book.
  fast, cheap, true.
- **Screen** — immersive experience. paper-pocket, open-clown, multi-task, sticky-menu.
  endless graphs for interaction. the stage.

## home: sticky-menu

the new homepage is a three-panel launcher — Script | Sketch | Screen.
one open at a time. each expands to the apps within.

```
┌─────────────────────────────────┐
│                                 │
│  Script                         │
│  code & prose                   │
├─────────────────────────────────┤
│                                 │
│  Sketch                         │
│  vision & prototype             │
├─────────────────────────────────┤
│                                 │
│  Screen                         │
│  immersive experience           │
│                                 │
└─────────────────────────────────┘
```

## app map

### script
- [x] lore-baby — saga viewer + file browser
- [x] source-code — codemirror editor
- [x] ur-shell — terminal
- [x] private-ai — LLM chat

### sketch
- [x] flip-book — frame-by-frame animation
- [ ] v-log — live action camera + record (from plan98, needs port)

### screen
- [x] open-clown — the desktop environment (my-computer, aliased in screen menu)
- [x] paper-pocket — music sequencer
- [x] multi-task — window manager
- [ ] shirt-flicks — video player / theater mode (from plan98, needs port)

## pending

- [ ] port v-log to plan1 (needs plan98-camera, plan98-gallery, v-log)
- [ ] port shirt-flicks to plan1
- [ ] sticky-menu remembers last open section across sessions (cache.get/put)
- [ ] sticky-menu back gesture (swipe or keyboard shortcut)
- [ ] /admin/ QR keycard route (step 4 of server upgrade)
