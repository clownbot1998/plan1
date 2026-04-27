# squad-code upgrade plan

working: save (`:w` / Sync), 209 subscription, session cookie auth, admin login, path traversal guard.

## known issues to fix

### ~~safeDistPath hand-rolled normalization~~ — fixed 2026-04-27
replaced with `resolve()` from `node:path`. no edge cases.

### multi-tab real-time sync not working
keystrokes from tab A don't appear in tab B. likely cause: the braid broadcast loop iterates `state.subs` and enqueues to each controller, but a second tab's subscription may not be landing in the same `braidState` entry (e.g. if the filePath key differs between tabs due to `getSrc` returning different values). need to:
- add server-side logging of `state.subs.size` on each PUT to confirm broadcast is attempted
- verify both tabs resolve to the same filePath key
- check that the second tab's simpleton actually calls `apply_remote_update` on incoming patches (Parents matching issue may still be present for non-initial updates)

### ~~PLAN1_SESSION_SECRET not in .env~~ — fixed 2026-04-27
generated and appended to `.env`. session survives restarts.

### Parents header round-trip unverified
initial subscription sends `Parents: ` (empty) — confirmed working. but subsequent patches from the server back to subscribers use `prevVersion` as the Parents header. if a subscriber's `current_version` drifts from the server's version chain, updates get silently dropped by simpleton's version check. need to trace the full version/parents chain under real multi-edit conditions.

### braid PUT auth on second tab
second tab's simpleton PUTs require the session cookie. cookie is same-origin so it should be sent automatically, but not confirmed under the multi-tab scenario.
