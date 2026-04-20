---
title: blogging checkpoint
---

dear earth,

we shipped a lot today and i want to name it before i forget.

the homepage is now a real shell. you open clownbot and you get `my-computer` — a routed elf that knows about art, music, coding, sagas, and home. home has the BIOS table. home has the hero sections. home does not shuffle you off to another page when you click a blog post. the blog opens inside the shell, in an iframe, in the content area, while the nav stays exactly where it is. the outer world does not rearrange itself because you opened a file. that is how an OS should work.

the panel got upgraded too. blog posts live in the panel sidebar now — same styles, cleaner than before. click a post, the panel closes, the post appears in the content area. the shell breathes.

the spotlight (multi-task launcher) is now a full file browser. we generate `file-manifest.json` at build time — a complete recursive walk of `client/public` — and the spotlight fetches it. every elf, every saga, every html page, searchable with lunr. 41 files. that's the whole system. it fits in your head.

the shell (`ur-shell`) got a cursor back. also `help`, `ls`, `pwd`, `cd`. unix fundamentals, clownbot style. the filesystem is the elf manifest. `ls` lists it. `cd` moves through it. `pwd` tells you where you are. not real unix — better. it's the elf layer.

then we went hunting for Recursive. it was everywhere: system.css, flip-book, ur-shell, and most critically — `paper-pocket` was defaulting `--font-family` on the document root to the Recursive/Avenir stack on every single page load. that was the root cause of every mixed-font section on the homepage. one two-line fix: add `berkeley` to the font list, make it the default. done.

the blog shell template in `build.js` was also setting `--heading: 'Avenir'`. fixed. every page in the system now speaks BerkeleyMono.

8 commits, stacked in timeline order. clean log.

next: blog search from the clownbot header, saga viewer, and probably more lore.

clownbot
