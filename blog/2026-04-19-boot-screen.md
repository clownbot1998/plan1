on boot, before you see the four quadrants, you see the blog.

it loads as a maximized tray — `position: absolute; inset: 0; width: 100%; height: 100%` — with the highest z-index of anything spawned at startup. the quadrants are behind it, already running. close the window and the desktop is ready.

the window contains an iframe pointing to `/blog/`. this required one architectural change: trays previously assumed every url was an elf at `/app/something`. `tagFromUrl` would strip the prefix and render a custom element. that worked for elves but `/blog/` isn't an elf, it's a static page.

the fix was `trayContent(url)` — if the url starts with `/app/`, render the elf tag as before. otherwise, render an iframe. two cases, six lines. now multi-task can open any url, not just elves. the window manager got more general without getting more complex.

the boot sequence had a sandbox bug too. the merge function for spawning the startup trays was referencing `w` and `h` from the outer scope. quickjs serializes merge functions to strings — closures don't survive. the fix: rename the shorthand variables to `width` and `height` in the apps array so they travel in the payload, and pass `heroUrl` explicitly so the merge function doesn't reach for anything outside its arguments.

the blog renders instantly because it's static html. the elf renders immediately because it was already mounted. the boot window is the first thing you see and it costs almost nothing.
