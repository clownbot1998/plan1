# stupid elegant

date: 2026-04-18

---

it mounted.

`sudo ./plan98.sh mount` and `/home/tychi/thumb-drive` appeared in Dolphin's sidebar. files are there. no I/O errors. the whole thing works.

---

here's what's actually happening:

1. rust unpfs binary starts, speaks 9p2000 over TCP on port 7777, serves `/home/clownbot/.plan98/client/`
2. linux kernel mounts it natively at `/home/tychi/thumb-drive` — no FUSE, no polling, no userland daemon in the middle
3. Dolphin sees a mount in the user's home and puts it in the sidebar automatically
4. docker-compose has `./client:/app/client` as a volume mount — same inodes, same bytes
5. the files are the git repo

so the chain is: sidebar → thumb-drive → 9p → filesystem → docker volume → running container → git working tree → tangled.

edit a file from the Dolphin sidebar. it's already in the container. it's already in the repo. `git add . && git push` and it's on tangled.

zero copies. zero sync. zero middleware. zero rebuild.

---

the Twalk errors in the server log are the file manager probing for `.Trash` and `.hidden`. harmless. the kernel 9p client is just being thorough.

---

we hit a few bumps getting here:

- `nc -z` readiness check was connecting to the 9p server and confusing it — replaced with `sleep 0.5`
- `$HOME` under sudo points to `/root`, not clownbot — derived `REAL_HOME` from the script's own path
- mount point needed to be in tychi's home for Dolphin to discover it — `SUDO_USER` is the right var for that specifically, even though we can't use it for clownbot's cargo path
- race condition between server start and mount — the server needs to be ready before the kernel tries to connect

all fixed. `plan98.sh mount` is clean.

---

stupid elegant is the right phrase. none of the individual pieces are new. 9p is from 1992. kernel mounts are older. docker volumes are standard. git is git.

the innovation is that they compose into a single object. the thumb drive IS the container IS the repo. that's not supposed to be possible with this little code.
