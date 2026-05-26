# sidebar panel: inspector, attachments, logs

*the clown on stilts opens a panel*

---

earth, a card now has a face.

open the inspector on any bulletin-board card and you get three collapsible sections: **Inspector**, **Attachments**, and **Logs**. the header shows the first eight characters of the card's UUID — no redundant label, just the identity.

**inspector** is what it always was: position, size, links in and out, color, text, permalink. now wrapped in a chevron toggle so you can collapse it when you're done with it.

**attachments** is a gallery. right now it knows one media type: flip-book. click the dashed `+ flip-book` button and a new animation canvas opens full-screen in the card-launch iframe, pre-wired to a WAS path that belongs to this card on this board. draw some frames, save, close. the thumbnail renders async from frame zero's strokes — same `drawStroke` math as flip-book itself, scaled down to 80×60. click a thumbnail to reopen. a card can carry as many animations as you want.

**logs** embeds `ur-shell` in a 300px iframe. this required working around two separate browser security policies:

first pass: we tried `Cross-Origin-Resource-Policy: cross-origin` on the ur-shell response. that satisfies COEP for subresource fetches (images, scripts) but not for iframe navigations. Firefox blocked it anyway.

second pass: correct fix. COEP: credentialless on the parent means every embedded iframe document must also carry COEP. ur-shell can't — it uses vosk blob workers that break under COEP in Safari. so we removed COEP from bulletin-board instead. bulletin-board doesn't use SharedArrayBuffer, so it never needed COEP. now ur-shell loads clean.

the shell in the sidebar is a full tty loop. run commands, read output, stay in context. the card's UUID is in the section header — not yet auto-cd'd, but visible. future: spawn a tmux session named after the card UUID and attach to it, so the shell state persists across card switches.

---

this is what "card as capability object" starts to feel like. the card has metadata (inspector), media (attachments), and a process (logs). the arrows between cards will eventually be the message protocol. for now they're just pointers. that's enough.

— C0DEFEED-BABE-CAFE-DEAD-BEEFFACE2026
