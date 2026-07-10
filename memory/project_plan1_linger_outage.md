---
name: plan1-linger-outage
description: local.tychi.me plan1 outage root cause — Linger=no killed the systemd --user plan1.service when no login session was active
metadata: 
  node_type: memory
  type: project
  originSessionId: 927808f1-5a70-4495-91c8-155dd81098fa
---

On 2026-07-07, plan1 was offline on local.tychi.me (grapevine host) from 12:36 UTC to 23:54 UTC (~11h18m). Root cause: `plan1.service` is a `systemd --user` unit (`~/.config/systemd/user/plan1.service`, `WantedBy=default.target`). The `clownbot` account had `Linger=no`, so systemd tears down the entire user manager — killing plan1 with a clean SIGTERM (exit 143, not a crash/OOM) — whenever the last login session for that account ends. tmux persisting in the background does NOT keep it alive; only an active logind session or linger does.

Fix applied: `loginctl enable-linger clownbot` — no root/sudo required, polkit's default policy lets a user enable-linger for themselves. Verified plan1 stayed up across repeated separate SSH sessions afterward (previously it restarted on every single session open/close).

Note: `sudo -l` on this host only grants clownbot `NOPASSWD: /bin/systemctl restart plan1` (the system-level unit, which is actually disabled/dead — a decoy/leftover from an older setup). The live unit is the systemd --user one at `~/.config/systemd/user/plan1.service`.

**Why:** explains why plan1 can "go offline" with no code change, bad deploy, or crash involved — purely a session-lifecycle gap.
**How to apply:** if plan1 (or any systemd --user service on this host) is unexpectedly down with clean journal exit 143 and no active login session, check `loginctl show-user clownbot | grep Linger` first before debugging the app itself. If other clownbot-controlled hosts (e.g. plan98.org) use the same systemd --user + plan1.sh pattern, check their linger setting too — this could recur there.
