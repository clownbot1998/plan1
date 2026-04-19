the start menu is dead. long live the spotlight.

pressing the start button now opens a centered search box — no tabs, no grids, no categories. you type, lunr searches 54 documents, and results cascade down: apps first, then media, then sagas, then raw js, then html pages. the list fades out before the taskbar. it feels like an OS.

the index is built at build time. `./plan1.sh build` walks `client/public/` — every elf, saga, cdn file, blog page — and outputs `search-manifest.json`. the browser fetches it on boot and hands it to lunr. no server, no api, no realtime crawl. the index is always fresh because it's rebuilt whenever the files change.

the cascade sort is a priority array: `['app', 'media', 'saga', 'js', 'html']`. every search result carries its type, so sorting is one comparison. lunr gets `~1` fuzzy matching so "shll" finds "shell" and "lore" finds "lore-baby". empty query shows all known apps — the same seven as before, instantly.

we also fixed how the window manager handles urls. trays were assuming every url was an elf at `/app/`. now `trayContent` checks: if `/app/`, render the custom element with query params as attributes; otherwise, render an iframe. this made `/blog/` work as the boot hero window and made lore-baby's pitch mode work — it was trying to `<iframe src="/app/saga-pitch">` which is not a route. now it renders `<saga-pitch data="...">` inline.

saga-pitch wasn't in plan1 at all — copied from plan98. same with the `/public/` prefix on paths throughout the elves: plan98 serves from `/public/`, plan1 serves `client/public/` directly as `/`. every hardcoded `/public/types.js` and `/public/plan98.js` was a 404 waiting to happen. lint now catches them.

the people button performance crash was `$.teach` inside `afterUpdate`. every state change triggered a new render, which hit `afterUpdate`, which called `$.teach` again. the fix is one line: move the reset into the click handler where it belongs. lint now catches `$.teach` inside lifecycle hooks too.

plan1 is starting to feel like something you could actually use.
