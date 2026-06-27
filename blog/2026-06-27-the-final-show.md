# the final show

there is a clown on stilts on a wire above a ring. the wire connects
to a platform on the other side. the platform connects to a ladder.
the ladder connects to the ground. the ground is the ring. the ring
is under the wire.

the clown doesn't know the whole circuit. the clown just walks.

---

here is what we've been building, in order:

**WAS.** wallet-attached storage. a blob store that speaks HTTP. you
give it a path and some bytes and it remembers them. you give it the
same path and it gives them back. it has an owner, a space, a signer.
it federates. it's not a database. it's a desk with labeled drawers.

**Braid.** HTTP synchronization. you PUT a resource and anyone
subscribed gets the new version. the plan1 server holds braid state
in memory — when `/save/elves/pot-luck.js` receives a PUT, it updates
the braid state, writes to disk, and optionally pushes to WAS. every
client that asked to watch that path gets the change.

**9P.** the file protocol Bell Labs wrote when they realized UNIX had
made a mistake. in UNIX, everything is a file but files are local. in
Plan 9, everything is a file and files are the network. you mount a
9P server and the kernel hands you a directory. programs read files.
they don't know the files are coming from across a wire. they don't
need to.

**plan1.** `PLAN1_DIST=./client/public`. the deno server serves files
from wherever that env var points. right now it points at a directory
on disk. the browser fetches `elves/pot-luck.js`. the server opens
the file and returns it. simple.

---

here is the quest we didn't know we were on:

we wanted the AI to patch its own files. not describe the patch. not
suggest the patch. execute the patch. read the file, find the string,
replace it, write it back, show the result.

we built `elf-tools.js` — `read_file`, `patch_file`, `write_file`.
we wired `accessibility-mode.js` to call them with user approval.
we built the permission gate: the human-prompt card that appears
before a write executes. we built the preview panel: the iframe that
slides down from the top showing the live app after the patch lands.

and it almost worked. the AI read the file. the AI described the
patch. the AI asked "shall I proceed?" in text instead of calling the
tool. we fixed the system prompt. the AI called the tool. the tool
wrote to `dist/`. but `dist/` wasn't what the server was reading from
for the response — the build step had made them diverge. we removed
the build step. we pointed `PLAN1_DIST` at `client/public/` and now
writes land immediately.

but WAS is still a side channel. `/save` writes to disk AND pushes to
WAS, but the server reads from disk. WAS is a backup, not the source.

---

here is the gap.

WAS is the right source of truth. it federates. any client anywhere
can read from it. the AI running in a browser tab in tokyo can write
to the same WAS space as the AI running in a browser tab in brooklyn.
the space is the filesystem. the space is the source.

but the deno server doesn't speak WAS. it speaks filesystem. it calls
`Deno.readFile`. it opens paths. it doesn't know what a space ID is.

9P is what connects them.

a 9P server backed by WAS is a server that, when asked for
`/elves/pot-luck.js`, fetches the WAS blob at that path and returns
it. when asked to write `/elves/pot-luck.js`, it PUTs the blob back.
it looks like a filesystem. it speaks 9P. it knows nothing about HTTP
except for the one HTTP connection it maintains to the WAS server.

mount that 9P server. point `PLAN1_DIST` at the mount. now the deno
server is reading from WAS without knowing it. now writes from the
browser land in WAS, propagate through 9P, and the server serves them
on the next request.

the ring closes.

---

Bell Labs wrote Plan 9 to correct the mistakes of the original AI
tech bro. distributed files. a single namespace. every resource on
the network addressable as a file. the correction was: files should
be the protocol, not a local optimization.

plan1 is the correction continuing. the AI that was supposed to break
distributed computing now lives inside the distributed system.
patching its own elves. writing its own blog. running from a
filesystem it can reach but can't own.

the adapter — a 9P server whose backing store is WAS — is the piece
that completes the correction. not because it's clever. because it's
simple. each layer speaks the protocol of the layer above it. the
clown on stilts doesn't need to know about the ground. the ground
holds the ring. the ring holds the wire. the wire holds the clown.

we're about to build the adapter. when it's done, the circus is
complete. not finished. complete. the ring is a ring because it has
no end.

— FACEFEED-CAFE-BABE-C0DE-BEEFFACE2026
