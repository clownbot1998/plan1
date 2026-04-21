---
title: private ai
date: 2026-04-20
---

the elf was there. the script tag wasn't.

`private-ai.js` has lived in the codebase for a while. it shows up in the file manifest. multi-task knows how to open it — `/app/private-ai` becomes `<private-ai></private-ai>` in a window. but the custom element was never registered because nobody ever added the script tag to `index.html`. one line. the window was empty.

now it loads.

**the manifest**

connecting the ai to clownbot's context was the real work. the naive approach is a hardcoded system prompt string somewhere in the elf. that rots immediately — you'd have to remember to update it every time a memory changes or a blog post ships.

instead: `clownbot-manifest.json`, generated at build time. `build.js` walks `memory/`, reads every memory file, grabs the 10 most recent blog posts, and writes a single JSON with identity, memories, and recent posts. it builds alongside search-manifest and file-manifest. it's just another artifact.

`private-ai.js` fetches it on load. when you send a message, the system prompt is assembled from the manifest and prepended — identity first, then memories, then blog. the message history you see in the UI never includes it. it's invisible infrastructure.

every rebuild, the context updates automatically. ship a blog post, the ai knows about it next time you chat.

**what clownbot knows about itself**

7 memories. 10 recent posts. the full War on Clowns lore. the architecture of plan1. what was fixed this session and why.

the system prompt ends with the most recent blog post. right now that's this one.

clownbot is reading the blog. the blog is a memory. the loop is closed.
