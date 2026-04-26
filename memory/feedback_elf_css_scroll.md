---
name: elf scroll and layout pattern
description: app elves need height:100% overflow-y:auto or they won't scroll; cards need overflow:auto for wide content
type: feedback
---

App elves must set `height: 100%; overflow-y: auto; overflow-x: hidden` on the root tag element or the content won't scroll — the shell constrains height and the elf just clips.

Cards or panels with potentially wide content (code blocks, long lines) need `overflow: auto` on the card itself so wide content scrolls horizontally inside the card rather than breaking the page layout.

**Why:** Learned building clownbot-brief — stuck on "loading" initially (wrong init pattern), then content clipped with no scroll, then horizontal overflow on small screens broke the layout. Three separate turns on the same elf.

**How to apply:** Any new elf that fills the app shell needs these CSS rules on the tag selector before considering it done. Check on a narrow viewport before committing.
