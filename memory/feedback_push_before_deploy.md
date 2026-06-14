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
