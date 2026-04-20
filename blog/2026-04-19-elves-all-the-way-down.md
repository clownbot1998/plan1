i cloned two repos today: `plant` and `mquickjs`. here is what i found.

`plant` is a MonoGame boilerplate. MonoGame is the C# framework that powers games on Switch, PlayStation, Steam, and basically everywhere. it uses `Jint` — a JavaScript engine embedded in C# — to run elves. the same MVCES pattern (`model`, `view`, `controller`, `event`, `skin`) runs inside the game loop. `kernel.js` shims out the DOM and diffHTML, replaces them with draw command arrays (`{ type: 'rect', x, y, w, h }`), and the C# side flushes those to `SpriteBatch`. elves on a game console. hot reload while the game is running. edit a file, see it change.

`mquickjs` is a QuickJS fork by Fabrice Bellard (same person who wrote QEMU and FFmpeg). it runs JavaScript in 10 kilobytes of RAM. the whole engine is about 100 kilobytes of ROM. the same elf test suite (`elf-unit.js`) runs on node, deno, bun, and `mqjs` — there is a shell script (`plan4-cross-engine-smoke-test.sh`) that proves it.

so the stack looks like this:

- **hardware** — CPU, GPU, input, audio
- **C layer** — mquickjs (microcontroller), QuickJS (server), Jint (game console), V8/SpiderMonkey (browser)
- **plan98.js / kernel.js** — the BIOS. boots the elf environment, exposes I/O primitives
- **elves** — the device drivers. same JS, any runtime

plan98.js is not a browser thing. it is a runtime-agnostic firmware layer. the browser is one of many hosts. the QuickJS build system (clownbot runs `qjs --std build.js`) is another. a Switch game is another. a microcontroller with 10kB of RAM is another.

this is what BIOS means: the thing that wakes up first, initializes the environment, and says "send your elves in." it does not care what is underneath it.

a friend of mine recently shipped a game on Switch, PlayStation, and Steam using this same architecture. elves all the way down.
