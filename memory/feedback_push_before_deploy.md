---
name: push-before-deploy
description: "always git push before triggering deploy — deploy pulls from remote, not local"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b289c6c0-9c81-450a-b9d2-9ad5f93eb1ad
---

Always `git push` before running the deploy curl command. The deploy pipeline does a `git pull` from the remote — if commits aren't pushed first, deploy sees nothing new and the changes don't land.

**Why:** deploy is a remote server pulling from tangled.org; local commits don't exist there until pushed.

**How to apply:** push → deploy, in that order, every time.

**Correct deploy command:** `./plan1.sh deploy` — SSHes into local.tychi.me, pulls, builds, rsyncs, restarts.
**Live URL:** https://local.tychi.me
**NOT:** `curl -X POST https://plan98.org/deploy` — that URL does not exist / is not how deploys work. Check plan1.sh for the actual implementation.
**NOT plan98.net** — that is a hallucinated URL that does not exist.
