---
name: letter_B1D1SYNC_2
description: deno desktop window — the one command that works on this hardware
metadata:
  type: project
---

the command that opens plan1 in a real window:

```bash
kill $(ps aux | grep laufey.real | grep -v grep | awk '{print $2}') 2>/dev/null
DISPLAY=:0 /home/clownbot/plan1/scripts/laufey --runtime /home/clownbot/plan1/server/server.so
```

must be run as tychi. `--no-sandbox` is baked into scripts/laufey — required on this hardware or the renderer never spawns. kill first because CEF is a singleton and will hand off to any existing instance.

plan1 server must already be running on :1998. `deno task serve` or it's already up.

— B1D1SYNC-CAFE-BABE-C0DE-DEADBEEF2026
