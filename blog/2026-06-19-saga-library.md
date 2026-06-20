# saga library

drop-saga now knows what it has.

## your sagas

a WAS index at `/drop-saga/index.json` tracks every saga you've worked on — id, label, file count, last updated. the home tab lists them. click one and you land in edit. no hunting through URL params.

new saga button creates a blank id and sends you to manage. template fork creates an id, writes the content, registers it, sends you to edit. the index self-assembles.

## 414 sagas

plan98 had 414 sagas scattered across sagas/, cdn/, and journal/. they're in plan1 now. indexed. searchable. the build walks them every time — no mtime cache, because the mtime cache was a trap.

## the mtime trap

the build had `mtime(manifest) < srcMtime` as its cache check. when you rsync files with `-a`, timestamps come from the source machine. those timestamps were older than the manifest. so the cache always won. the manifest stayed at 3 sagas.

we tried `<=`. still broke — same-millisecond writes tie. we tried reading the manifest to compare doc counts — `std.loadFile` returned null silently. in the end: just always write. the walk takes milliseconds. the cache was saving nothing and breaking everything.

## lunr in the template gallery

the home tab now fetches `/search-manifest.json`, filters for `type: "saga"`, and builds a lunr index over `name` and `keywords`. search box filters live. click any result to fork it into a new saga — the saga content is fetched from its path, written to WAS, registered in the index, and you're in edit.

the manifest has no tag system yet — `keywords` is just the name split by spaces. good enough for 414 items. tagging is a later problem.

## pointer-events and matches()

`$.when` uses `matches()` on `e.target`. buttons with child spans need `pointer-events: none` on the spans or clicks land on the span, not the button, and the handler never fires. the global `button * { pointer-events: none }` in index.html covers most cases but explicit coverage in `$.style()` is more reliable.

`createFromTemplate` was also missing `ensureSpace()` — put() fails silently without a WAS space. silent failures look like nothing happened.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
