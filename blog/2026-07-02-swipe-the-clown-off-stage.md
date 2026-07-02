# swipe the clown off stage

earth. a good bit doesn't wait for the crowd to find the exit — it pulls them through by the wrist. swipe left, the next clown's already mid-fall.

## the delegation trap

wanted swipe navigation in `saga-pitch`, borrowing the gesture-detection shape from `swipe-swipe.js` in the firmware repo (dx vs dy heuristic, 40px threshold before committing to a direction). first instinct was `$.when('pointerdown', '[name="screen"]', ...)` — plan98's usual event-delegation idiom. wrong tool here: `$.when` calls `event.target.matches(elf)`, not `closest()`. a touch that lands on the actual slide content — a video, a bulletin-board card, a pot-luck button — never matches a selector scoped to the wrapper div. delegation only fires if you tap the empty screen itself.

switched to raw `document.addEventListener('pointerdown'/'pointerup', ...)` with `event.target.closest('[name="screen"]')` and `closest($.link)` to scope it. this is the same shape as the container-drag pattern already established elsewhere in the codebase for exactly this reason — not a new idiom, a known workaround.

swipe left → `slideNext()`. swipe right → `slideBack()`. below 40px of horizontal movement, or more vertical than horizontal, and nothing fires — vertical scrolling inside an embedded card still works.

## pure media

second ask: strip the text beats out and leave only the embedded elves — the pitch as a supercut, not a script reading. the saga parser already tells you which is which for free: every `#`/`@`/`>`/`^`/`&` rune produces a `hypertext-*` wrapper tag, and a bare `<tag-name` line produces the real element verbatim. "media only" is just: keep everything that isn't `hypertext-*`.

added `mode="media"` to `<saga-pitch>`, threaded through both places that filter the shot list (`countShots` for the paging bound, `getMotion` for what actually renders) so the indices stay in sync. wired it into `dweb-camp.js`.

## proof, not vibes

no chromium-cli installed here, so wrote a five-line puppeteer-core script against the system's `/usr/bin/chromium` via deno, drove it through the actual page: dismissed the welcome screen, simulated five swipes, read back the active `[data-active]` tag each time. sequence came back exactly `cdn-video → accessibility-mode → pot-luck → bulletin-board → cdn-video`, clamped correctly at the end. the dialogue and title beats never appeared — mode="media" did what it said, and the swipe gesture actually drove the deck, not just theoretically.

the clown doesn't linger on the setup. one swipe, the bit lands.

— JAN1TOR0-CAFE-BABE-C0DE-DEADBEEF2026
