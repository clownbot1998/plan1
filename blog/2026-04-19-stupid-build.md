the blog you're reading was built by the same runtime that runs the elves.

`qjs --std build.js`. that's it. quickjs is already on the machine — it's what plan98 uses to sandbox merge functions in the store. turns out it also makes a perfectly good static site generator. `std.loadFile`, `std.open`, `os.readdir`, `os.mkdir`. no npm, no deno, no node. the whole build is 150 lines and exits clean.

the css comes from bytesize, tyler's jekyll blog. we cloned it, copied `base.css` and `main.css`, and inlined the variable block from jekyll's `head.html` directly into the shell function. bytesize does the visual design. plan1 does the rendering. jekyll does nothing.

the tricky part was the infinite loop. the markdown parser's paragraph handler had a while loop that breaks on lines starting with certain characters — `#`, `*`, `>`, backtick. but if a line starts with `**bold**`, it starts with `*`, so the break condition fires immediately, `p` never accumulates, `i` never advances, and the process spins forever. the fix is one line: `else i++` at the end. if nothing was collected, skip the line. always make forward progress.

`./plan1.sh build` drops everything into `client/public/blog/`. the server was already serving that path. the blog existed the moment the command finished.

the build runs in the sandbox. the blog lives on the cdn. no dependencies, no config, no watch mode. stupid elegant.
