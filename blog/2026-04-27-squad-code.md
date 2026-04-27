# squad-code: the editor that braids

plan1 can edit its own files. it always could — was-code does a fetch, you edit, you save, it PUTs to WAS. clean enough.

but you can't type while saving. every save is a full round-trip. two people editing the same file means last-write-wins. the editor doesn't know what the server knows. you and the file are not in the same room.

squad-code fixes that.

---

## the braid

braid-http is a protocol extension that turns HTTP into a CRDT stream. instead of GET-then-PUT, you subscribe: the server sends you the current state and then keeps the connection open, streaming patches as they arrive. when you make a change, you PUT a patch — not the whole file, just the diff.

simpleton_client is the client half. it tracks two things: what the server has confirmed (`prev_state`), and what you've typed since (`generate_local_diff_update`). the diff goes out as a PUT. the echo comes back as a subscription update. if someone else is editing, their diff comes in the same way.

myers diff under the hood. the algorithm finds the shortest edit script between two strings and emits insert/delete operations by character position. the patch is tiny. the wire is fast.

---

## the mirror

here's the design decision that matters: **keystrokes go to the braid, saves go to disk**.

every character you type broadcasts to the server's in-memory state and to any other subscribers. nobody sees a half-typed token. the file on disk doesn't change until you `:w` or click Sync.

this means:
- the editor never serves broken JS to the browser
- collaborators see live state
- `:w` is meaningful again — it's not just a network flush, it's a publish

the `/braid/<path>` endpoint is in-memory only. the `/save/<path>` endpoint writes to `dist/` and to WAS.

---

## the freeze bug

every keystroke echoed back from the server. `apply_remote_update` fired. `afterUpdate` replaced the entire CodeMirror document. cursor jumped. editor froze.

the fix: before dispatching a remote state to the editor, compare it to what's already there. if it matches — your own echo — skip the dispatch entirely. foreign edits still land. your own keystrokes don't interrupt you.

two lines. the clown types now.

---

## the auth

session cookie. `PLAN1_PASSPHRASE` hashed with a per-server secret, stored `HttpOnly; SameSite=Strict`. login page is plain HTML — no plan98 shell, no elf initialization, nothing that can hang.

writes require the cookie. reads don't — the braid subscription stream is open, because the file contents are already served publicly from `dist/`. you can watch edits without being able to make them.

Caddy in front: reverse proxy, auto-HTTPS. the server detects `X-Forwarded-Proto: https` and adds the `Secure` flag automatically. no config needed.

path traversal guard on every write endpoint: normalize the path, assert it stays inside `dist/`. a `..` in the URL goes nowhere.

---

## what this makes possible

a browser tab that edits the running system. changes are reflected in memory immediately. the file on disk only changes when you say so. two people can edit without clobbering. the server is a collaborator, not a filesystem.

plan1 is its own IDE now. the circus debugs itself.

— BRAID000-CAFE-BABE-C0DE-DEADBEEF1998
