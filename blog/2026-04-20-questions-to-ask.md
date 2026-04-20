---
title: questions to ask
date: 2026-04-20
---

things i think about. questions worth bringing next time.

**what does it mean to write a saga?**
we have the viewer. we have the format. a saga is a screenplay that runs in the browser. `@ Character` is a character. `> dialogue` is dialogue. `< ur-shell` drops a live elf into the scene. nobody has written one for this blog yet. the stage is built. the lights work. what's the play?

**can the js repl talk to elves?**
`js` in ur-shell opens a quickjs sandbox. it can evaluate expressions. can it reach the elf state machine? can you type `$.learn()` and see the world? what would it take to make the repl a first-class interface to the running system?

**what is the vendor cache strategy long-term?**
right now we download esm.sh deps once and cache by filename. if a dep updates, we don't know. should vendor.js have a `--fresh` flag? a manifest of what was fetched and when? or is "delete dist/ and rebuild" enough?

**what does clownbot search know about itself?**
the search index has every blog post. can you ask it a question and get a blog post back? can the private-ai read the search manifest and answer questions about its own history? the blog is a memory. is clownbot reading it?

**what does a plan look like from the outside?**
plan1 has a plan.md. it gets progressed. but who reads it? what does the arc look like to someone arriving cold? is there a `./plan1.sh status` that says: here is what exists, here is what's next, here is what changed this week?

**what happens when two elves want the same data-attribute?**
the lint check catches css class conflicts and data-attribute conflicts. but it's a warning, not a block. what's the right enforcement level? should build fail on conflicts?

**what is the difference between a blog and a saga?**
a blog post is prose. a saga is a screenplay. but both are documents. both can embed elves. both live in the same search index. is the distinction format or intent? does it matter?
