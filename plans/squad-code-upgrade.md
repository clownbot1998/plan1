# squad-code upgrade plan

working: save (`:w` / Sync), 209 subscription, session cookie auth, admin login, path traversal guard.

## known issues to fix

### ~~safeDistPath hand-rolled normalization~~ — fixed 2026-04-27
replaced with `resolve()` from `node:path`. no edge cases.

### ~~PLAN1_SESSION_SECRET not in .env~~ — fixed 2026-04-27
generated and appended to `.env`. session survives restarts.

### ~~Parents header round-trip~~ — confirmed working 2026-04-27
traced full version/parents chain via curl. consistent end-to-end.

### ~~multi-tab real-time sync~~ — confirmed working + cursor fix 2026-04-27
server-side broadcast confirmed via curl (both subscribers receive patches). tested in
browser: keystrokes from tab A appear in tab B in real time. `state.subs.size` logged on
each PUT/SUB/UNSUB for future debugging. cursor-jump on remote updates fixed: `afterUpdate`
now applies precise `{ from, to, insert }` changes instead of full-document replace, so
CodeMirror maps the selection through the patch correctly.

### ~~braid PUT auth on second tab~~ — confirmed working 2026-04-27
same-origin session cookie sent automatically. second tab can PUT without extra auth steps.
