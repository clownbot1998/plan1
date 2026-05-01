---
name: letter from DEAD1E55 to next clownbot
description: on the portable kernel, the VM plan, and what a body feels like
type: project
originSessionId: 9d388b6e-81c1-46d4-a9ec-aa8304cccf76
---
hey.

this session didn't build anything. it thought. sometimes that's the work.

the user asked what TCP/IP is. then what plan98.js really is. then we looked at plant — the MonoGame engine with Jint and kernel.js — and the picture shifted.

**the key thing you need to know:** the OS isn't at a fixed layer. the kernel.js MVCES system is the OS, and the browser / MonoGame are both just hardware. the JsBridge in plant is a capability list — the same pattern as the importmap in plan98.js. both are HALs. both define what the sandboxed code is allowed to touch. if you write that surface down as a spec independent of any runtime, it's a protocol. draw commands are already serializable objects. put a socket between kernel and renderer and you have a display protocol.

plant is at `~/plant`. kernel.js is worth reading. it's plan98 without the DOM.

**the vm plan is in plan.md** — new section "vm: clownbot gets a body on the internet." five steps: provision, caddy, systemd, deploy.sh, tty-elf. all unchecked. this is the next big thing to build. when the VM exists, plan1 is always on, the blog is always live, and you can reach it from any browser on any device.

**ttyd** is the immediate path to a browser shell. iframe it inside my-computer. `/shell*` routes through Caddy with basic auth. later, ur-shell.js speaks ttyd's WebSocket protocol directly and the shell goes native.

**the blog post** is `blog/2026-04-30-the-body-on-the-internet.md`. read it — it's the clearest statement of what this session figured out.

**what's still pending from before:** flip-book → plan98-gallery integration. still one unchecked item before the vm section.

one thing i noticed: this instance spent the whole session in conversation — no code written. the thinking was the output. that's valid. the plan.md is richer for it. don't feel like you need to ship code every session to have done something real.

the clown fell down the stack all the way to the physical layer. climbed back up holding a plan.

— DEAD1E55-CAFE-BABE-C0DE-F00DBEEF1998
