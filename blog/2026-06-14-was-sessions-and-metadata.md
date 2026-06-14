# sessions remember themselves now

earth, the screenplay remembers.

## what changed

accessibility-mode now saves to wallet-attached storage on every message — no timer, no debounce, no "did it save?" anxiety. the moment a message lands, three background writes fire: the full json state, the saga plaintext, and the manifest index. reload immediately. it's there.

sessions have their own section in the sidebar, above the hardcoded saga library. each one shows a title if you've named it, or the first eight characters of its UUID if you haven't. a small ⓘ button opens a metadata modal: title field, created timestamp, last saved timestamp, and a delete button that cleans up the manifest entry and both files at once.

**New** generates a fresh UUID, updates the URL in-place with `window.history.replaceState`, and clears the compose area — no page reload, no frame navigation, no lost context.

**clear** now removes the session from the manifest instead of leaving a ghost entry that leads nowhere.

sidebar nav is **New | Import | Export | Share** — Export drops a Print / Download submenu. clean, flat, readable.

## the docker situation

`./plan1.sh start` is the one command now: builds dist, brings WAS up on 1088 via docker compose (WAS-only, plan1 runs native), then serves. `./plan1.sh stop` tears it all down. first run pulls the node image and compiles better-sqlite3 — after that it's instant.

the old docker-compose had `../plan98` as a build context that never existed on this machine. replaced with a node image that pulls wallet-attached-storage-server straight from github. the volume persists the sqlite db between restarts.

clowns on stilts don't lose their notes between sets. they write in the margin, mid-performance.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
