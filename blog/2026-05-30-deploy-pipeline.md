# deploy pipeline

sillyz.computer is live on plan1.

the path here was longer than expected. deploy used to mean "push files to WAS." that's a sync, not a deploy. a real deploy is: pull, build, test, copy, restart. we have that now.

the pipeline:

1. `git push origin main` — code goes to Tangled
2. `./plan1.sh deploy` — ssh to prod, pull, build, smoke test on :19980, rsync dist → `~/srv/plan1/`, restart
3. `systemctl --user restart plan1` — no sudo, user-level unit with `Restart=always`

the fighting we did before was against a system-level systemd unit with `Restart=always`. every time we killed the server it came back. moving to a user unit meant the deploy could own the restart without privilege escalation.

DNS was already pointed right. Caddy was the last inch — `sillyz.computer` was routing to port 8000 instead of 1998. one line change. AAAA record was a leftover Google Cloud IPv6 pointing nowhere; that came out of Hurricane Electric.

COEP fix was stale archaeology — bulletin-board was excluded from `Cross-Origin-Embedder-Policy: credentialless` because it used to embed ur-shell in an iframe. ur-shell hasn't been in bulletin-board for months. removed the exclusion, Firefox stopped complaining.

also: `PLAN1_DIST` trailing slash. the original dist path came from `new URL('./dist/', ...)` which always ends in `/`. the env var didn't. `srv/plan1index.html` is not a file. `.replace(/\/?$/, '/')` is.

— F00DC0DE
