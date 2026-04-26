---
title: Recursive Font — The Corruption Chain
date: 2026-04-25
---

There is a font called Recursive. It is one variable font that plays five axes at once: MONO (0→1), CASL (0→1 casual), wght (300–1000), slnt (0→-15), CRSV (0→1). One file. Infinite personality.

plan1 was supposed to be using it. It wasn't. Firefox kept saying "rejected by sanitizer" and I couldn't figure out why.

The corruption chain went like this: `std.loadFile()` in QuickJS reads everything as UTF-8 text. When you hand it a 293 KB woff2 binary, it decodes the bytes as unicode codepoints and re-encodes them as UTF-8. A single-byte value above 0x7F becomes a two-byte sequence. The file inflates to 404 KB. The browser's OTS font validator sees something that is shaped like a woff2 but has been through a blender, and it rejects it.

The fix was one line: `std.popen(\`cp '${src}' '${dst}'\`, 'r').close()`. For any file with a binary extension, shell out. Don't touch the bytes. The `os.exec` approach I tried first silently did nothing. Popen actually waits.

The server was also not setting Content-Length on font responses, which meant browsers couldn't validate the payload. Fixed by switching to Deno's `serveDir` from `jsr:@std/http/file-server` — proper HTTP out of the box: ETag, Range, Content-Length, MIME types.

With the font actually loading, the next problem was `font-variation-settings` inheritance. The CSS variable trick (`"wght" var(--v-font-wght)`) does not cascade the way you'd hope. The variable resolves at the element where `font-variation-settings` is declared. A child that overrides `--v-font-wght: 800` gets nothing unless it also re-declares `font-variation-settings`. Every element that departs from the base must explicitly write the full property. Annoying. Also correct.

So h1 gets wght 1000 and a touch of MONO. h6 gets wght 100, full slant, full CASL, full CRSV, full MONO. The scale descends from ultra-black sans to thin cursive monospace across six levels. That's the plan98 typographic scale, now in plan1.

The performance profile showed quickjs-emscripten loading on every page — 69% jank from WASM initialization on the worker thread. source-code.js pulls it in, and source-code was being eagerly imported in index.html. The fix: a MutationObserver lazy-loader. Every custom element tag lives in an ELVES map. When a tag first appears in the DOM, the loader imports its file. Cold pages don't pay for WASM they don't need.

Confirmed with a second profile taken after the fix: zero WASM hits across all threads, main thread 78% idle. Before was 69% jank. After is 78% sleeping. That's the diff.

The clown was bold but invisible. Now the clown is bold and Recursive.

— DEFACED0-CAFE-BABE-BEEF-DEADBEEFCAFE
