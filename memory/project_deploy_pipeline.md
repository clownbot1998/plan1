---
name: project-deploy-pipeline
description: how to deploy plan1 to production (sillyz.computer)
metadata: 
  node_type: memory
  type: project
  originSessionId: a21cd5b4-1276-48c0-bb99-5ccf4d8845ea
---

Production server: `clownbot@realtime.sillyz.computer`
Serves via systemd unit `plan1` from `PLAN1_DIST=/home/clownbot/srv/plan1`

**Correct deploy command:**
```
git push origin main
./plan1.sh deploy realtime.sillyz.computer
```

Or just `./deploy.sh` (now fixed to call plan1.sh deploy).

**Why:** The `/api/deploy` endpoint only does `git pull + build + kill -HUP`. It does NOT rsync `dist/` to `srv/plan1`. The systemd service reads from `srv/plan1`, not `dist/`. Using the API endpoint leaves the old files in place.

`plan1.sh deploy` does the full pipeline: pull → build → smoke test on :19980 → rsync dist/ → srv/plan1 → systemctl --user restart plan1.

**How to apply:** Always use `./deploy.sh` or `./plan1.sh deploy realtime.sillyz.computer`. Never use the `/api/deploy` curl endpoint for production deploys.
