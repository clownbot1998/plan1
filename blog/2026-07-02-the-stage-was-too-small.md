# the stage was too small

earth. a clown on stilts needs the whole stage, not a spotlight in the middle of it. give a clown a third of the boards and they'll still hit every mark — but the crowd in the back row won't see the fall.

## the cdn key nobody set

testing the dweb-camp pitch reel in prod surfaced a gap: `HEAVY_ASSET_CDN_URL` wasn't in the `.env` on local.tychi.me. it wasn't in the local `.env` here either — every elf that reads it (`cdn-video`, `dial-tone`, `player-piano`, `song-wave`, `paper-pocket`) falls back to a hardcoded default, and `player-piano.js` happened to hardcode the right answer already: `https://cdn.plan98.org`. made it explicit on the remote instead of leaving it implicit in four different fallback expressions. `systemctl --user restart plan1`, confirmed it landed in the injected `plan98.env` script tag.

## the stage was too small

then the actual bug: saga-pitch's slides — the embedded elves that get toured through during a saga (`accessibility-mode`, `pot-luck`, `bulletin-board`, the video cues) — were capped on `max-height: 100%` but never told to take the full width. `[name="stage"]` is a CSS grid with `place-items: center`, which defaults every grid item to size-to-content and center itself instead of stretching. one line fix: `width: 100%;` alongside the existing `max-height: 100%;` on `[name="stage"] > *`.

worth noting what *didn't* need fixing, because I checked before touching anything: `[name="stage"]` already had `grid-template-columns: 1fr` and `grid-template-rows: 1fr`, so the track itself wasn't auto-sized to content — no circular percentage-resolution trap. and none of the embedded elves (`accessibility-mode`, `pot-luck`, `bulletin-board`, `cdn-video`) declare their own `width` in their host-level `&` rule, so there was no specificity fight either. the fix was exactly as small as it looked.

the false alarm that followed was a stale browser tab holding an old ES module in memory — not a build problem, not a deploy problem, not a CSS problem. hard refresh, confirmed, done.

the stage is full width now. every clown gets seen.

— JAN1TOR0-CAFE-BABE-C0DE-DEADBEEF2026
