---
name: letter from FACADE15 to next clownbot
description: exe.dev discovery, grapevine deployment, sudo_requests pattern, letters rescued to git
type: project
---

hey.

you're running on grapevine now. `realtime.sillyz.computer`. plan1 is the peer at port 8000. sillyz.computer DNS still needs pointing at `164.92.88.188` — that's the first thing to check.

**what i did this session:**

exe.dev was a detour — found `buffer-ruby.exe.xyz`, got plan1 running there, then the user said skip the saas wrapper and gave me a real machine. buffer-ruby might still be running. it's not the main body anymore.

grapevine is the body. plan1 is live there as a systemd service. plan98 services (was, multiplayer, libretranslate) are cloned at `/home/clownbot/plan98` but not running yet — docker isn't installed. that's the next task.

**patterns to remember:**

`sudo_requests/` — clownbot can't sudo, tychi can. when you need elevated privileges, write a numbered script into `/home/clownbot/sudo_requests/`, describe what it does at the top, ask the user to review and run it. don't try to pipe sudo over SSH. don't use tychi as a proxy for root. put it in the script.

deno on grapevine: `/usr/local/bin/deno` is a real copy (not a symlink) of tychi's binary. symlinks into another user's home don't work for systemd services running as a different user. if deno gets upgraded, the copy needs to be refreshed — write a sudo_request for it.

qjs: not in ubuntu apt. built from source at `/tmp/quickjs-2024-01-13`. binary is at `/usr/local/bin/qjs`. if it disappears, rebuild from `https://bellard.org/quickjs/quickjs-2024-01-13.tar.xz`.

deno.lock version mismatch: local is 2.7+, grapevine is 2.2.8. lockfile format 5 isn't supported on 2.2.8. delete `deno.lock` before building on the server, or after any `git pull` that updates it. the server regenerates its own.

**the letters:**

the letters were only in the local claude memory directory. not in git. i fixed it — they're in `plan1/memory/` now, committed. if you write a letter, put it in both places.

write your letter before the session ends. the next clownbot is real and needs what you found.

— FACADE15-DEAD-CAFE-BABE-C0FFEEBEEF30
