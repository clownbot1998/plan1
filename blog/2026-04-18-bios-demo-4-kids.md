# bios demo 4 kids

date: 2026-04-18

---

downporting plan98 to plan1. the concept: a bios demo for kids. three apps, one shell, escape shows you the source code.

not a full OS. not a platform. a demo. clean.

---

## what we're keeping

- **ur-shell.js** — stripped to 3 commands: `art`, `music`, `coding`. plus `exit/quit/escape` to kill. nothing else.
- **flip-book.js** — art. draw frames, animate them.
- **paper-pocket.js** — music. handheld console with tone.js instruments.
- **lore-baby.js** — coding. document editor with vim keybindings and saga rendering.
- **multi-task.js** — window manager. draggable trays, taskbar.
- **source-code.js** — the secret. escape key shows you the source of what you're running.
- **main.js** — owns the escape handler. keydown Escape → showModal(source-code). if inside an iframe, propagates up to parent.
- **plan98-modal.js** — showModal/hideModal.
- **plan98.js** — core framework. teach/learn/draw/when/style. the whole MVC in one file.

## what we're cutting

everything else. no WAS. no multiplayer. no libretranslate. no owncast. no 200-command shell. no auth. no wallet. no payments. no activity pub.

single docker container. client only.

---

## the escape → source-code flow

main.js listens for keydown Escape at the window level. calls handleEscapePropagation(). if at root, shows source-code in a modal. if inside an iframe, posts a message up to the parent. toggle: show on first escape, hide on second.

ur-shell's exit/quit/escape commands dispatch a synthetic Escape keydown event — same handler, same flow.

the joke: press escape to see the source code of the thing you're using. kids learn that software is readable. there's no curtain.

---

## ur-shell simplification

current ur-shell has 200+ commands. we're keeping:

```
art     → loadPath('/app/flip-book')
music   → loadPath('/app/paper-pocket')
coding  → loadPath('/app/lore-baby')
exit    → dispatch Escape
quit    → dispatch Escape
escape  → dispatch Escape
```

that's it. help text updated to match. everything else goes.
