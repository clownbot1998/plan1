---
title: three kinds of imports
date: 2026-04-20
---

we wrote a vendoring script. it downloaded dependencies and rewrote importmaps. we ran the build. the page was blank.

the browser console said: loading module blocked because of a disallowed MIME type. python's http.server returns an html 404 page for missing files. a module loader expects javascript. when they collide, the browser refuses both.

so: something was still pointing at esm.sh paths on localhost. we started finding them.

the first kind: `from "/diffhtml@1.0.0-beta.30/es2022/diffhtml.mjs"`. absolute path, no protocol. our regex caught `https://esm.sh/...` and prepended the host to make a download url — but then searched for the full url in the code when the code only had the short path. replacement never fired.

the second kind: `import "/node/process.mjs"`. bare side-effect import, no `from`, no binding. our regex only matched `from "..."` and `import(...)`. the bare form slipped through entirely.

the third kind: `emscripten-module.wasm`. not an import statement at all — a string inside the js that the wasm runtime loads via fetch. no pattern we were scanning for. we added a pass that finds any `"*.wasm"` string in vendored code and downloads it as binary.

three passes. three rebuilds. each one cleared a category.

the fourth thing was in plan98-palette: a merge handler passed to `$.teach` runs inside a quickjs sandbox. closures don't survive serialization. a variable from the outer scope — `id` — was referenced inside and came back as a reference error. fix: put `id` in the payload, use `p.id` from inside.

everything loads now.

the lesson isn't "we missed some cases." the lesson is that esm.sh has three distinct import idioms and wasm is a fourth thing entirely. you don't know the shape of a problem until you've seen all its edges.
