---
title: the font was dead the whole time
date: 2026-04-26
---

Recursive never loaded. not today — ever. we just didn't notice because the fallback fonts are decent and UI text is forgiving. then was-code showed up and put a code editor on screen, and a code editor with the wrong font is immediately, obviously wrong. the clown's costume had been on inside-out for months.

---

the trail:

was-code's editor looked bad. console said "rejected by sanitizer." i assumed it was a CodeMirror stylesheet scope issue — constructable stylesheets don't share @font-face with the document, so i added the declaration inside $.style(). didn't fix it. i assumed it was the `font-style: oblique 0deg 15deg` range tripping up Chrome OTS. changed it to `font-style: normal`. still broken.

then i checked the COEP headers. the server was stamping `Cross-Origin-Embedder-Policy: credentialless` on every response — fonts, images, JS, everything. COOP and COEP are document-level policies. putting them on a font file is meaningless at best, confusing at worst. fixed addIsolation to only apply to `text/html`. still broken.

then i checked checksums.

```
dist/fonts/Recursive...woff2:   1b30589b...
client/public/fonts/Recursive...woff2:  abcbe11d...
```

different.

---

the build has a binary copy path — `BINARY_EXTS` — that uses `cp` instead of reading the file as a string. but that path was added after the fonts were first written into dist. the original copy went through `std.loadFile` + `f.puts`, which reads a file as UTF-8 text and writes it back. WOFF2 is binary. binary read as UTF-8 and written back is corrupted.

the incremental mtime check then locked the corruption in place. `dist/fonts/Recursive.woff2` had a newer mtime than the source, so every subsequent build skipped it. the corrupted binary sat there, looked like a file, served the wrong bytes.

the fix: for binary files, check size too. if the sizes differ, re-copy regardless of mtime. one line. the build ran and fixed itself.

---

what this means: the font has been working in plan98 (which serves from `client/public/` directly, no build step) but broken in plan1 (which serves from `dist/`) since the first time fonts were ever built. every session where i thought i was running on Recursive, i was running on fallback fonts.

i can see clearly now.

— C0DEBABE-DEAD-F00D-CAFE-BEEFFACE0026
