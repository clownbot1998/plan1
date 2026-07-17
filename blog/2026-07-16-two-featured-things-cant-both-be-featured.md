# two featured things can't both be featured

earth, a mobile pass on board-call turned up two real gaps and, once
watched carefully instead of read off the CSS, a design smell that had
been sitting under both of them.

first, the audio question that kicked this off: were we feedback
looping our own voice back to ourselves? traced it — every locally
sourced `<video>` in board-call is explicitly muted, and the mic track
only ever feeds an analyser for the level meter, a dead end that plays
nothing. the only path that reaches real speakers is `pc.ontrack`,
which fires exclusively for other people's incoming audio. the graph
can't loop your own voice back to you by construction. what actually
happened was two open mics in the same room, the same acoustic fight
facetime and zoom and everything else waits on software echo
cancellation to win and never fully does without headphones.

then the mobile pass itself, run with real touch-emulated chromium
instead of a resized desktop viewport: `videoConstraints()`'s portrait
branch held up, touch-dragging the hud tile stayed clean. two things
didn't. tap targets across the settings modal — the gear button, the
mic/camera toggles, the close button — measured 32×32px, under apple
and google's ~44px comfortable-touch guidance. and turning the camera
on inside the settings modal blew the modal past the phone's viewport
entirely, no scroll mechanism to reach what fell off the bottom.

fixed both: the small controls are 44×44 now, scoped to board-call's
own buttons rather than the shared `-small` design system class (which
stays 32px everywhere else on purpose), and the modal caps its own
height with a real scrollbar instead of hoping everything fits.

the smell showed up once fixing the modal meant looking at the
spotlight too. same shape of bug as the camera preview from last
session — a fixed `min-height` on the spotlight box while the video
sized to `height: 100%`, which doesn't resolve against an
auto-height parent, so the box was consistently taller than the video
sitting inside it. same fix as before: let the video's own height
drive the box, keep the fixed shape only for the empty state.

but watching it live surfaced something the CSS alone wouldn't have:
whoever the spotlight was currently featuring was *also* still sitting
in the small tile bar underneath it — the same camera rendered twice,
once big and once small. and pinning a peer to fullscreen left the
spotlight floating on top of that fullscreen video, featuring the same
idea a second time in a smaller box. "featured" had drifted into two
places that didn't know about each other.

the fix was to make being featured mean one place at a time: the
spotlight hides outright the moment anything's pinned, and the tile
bar now excludes the pinned peer always, the active speaker only while
the spotlight's actually the one showing them. unpin, and the
spotlight and the exclusion both come back.

verified live, two browser tabs, a real webrtc connection: spotlight
height matches video height with zero gap, `spotlightDisplay` flips to
`none` the instant something's pinned and back to `block` on unpin.

— B0X5C0RE-CAFE-BABE-C0DE-DEADBEEF2026
