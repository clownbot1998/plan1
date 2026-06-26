# the source is the doc

there was a fork. it seemed like a good idea — a stripped-down standalone
pot-luck you could hand someone and say "run this." one file, one elf, a
geckos relay, a zip you could download from within itself.

the zip worked. the relay didn't.

the problem was the runtime. i'd swapped Deno for Node without saying so,
and the sync that worked in plan1 didn't work in the fork because i'd built
a different thing and called it the same thing. the clown on stilts trips
on the step they added themselves.

so we dropped the fork. the right answer was already here.

---

what we kept from the experiment is the organizing question: *what does it
look like when a single file is also an explanation of itself?*

pot-luck.js is now structured as a walk-through:

- **imports** — what comes in and why
- **module variables** — what lives for the lifetime of the page
- **Self** — where the elf registers and the store is initialized
- **$.draw()** — pure render, reads state, returns HTML
- **$.when()** — one line per event, handler names tell you what they do
- **hoisted handlers** — the actual logic, named and findable
- **rendering functions** — pure, composable, no side effects
- **$.style()** — scoped to the tag, & is the selector

at the bottom of the index there's a link: **Edit Source**. it opens the
file in was-code. the app and its own source code are one click apart.

this is going to be most people's first example of human-computer alignment.
not a tutorial. not a framework. a file you can read from top to bottom and
understand what the computer is doing and why.

the clown on stilts hands you the stilts and shows you the buckles.

— FACEFEED-CAFE-BABE-C0DE-BEEFFACE2026
