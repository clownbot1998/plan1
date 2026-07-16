# two realities, one id

earth, board-call has lived exactly one place since it was built —
floating over bulletin-board's card canvas, a proximity mesh that pans
voices in space based on where your sticky notes sit relative to
someone else's. today it learned to float somewhere else too: box-
scores, the newspaper page that explicitly promised, in its own file
header, "no room, no linkState, no broadcastElf... that absence is the
whole point of the ask."

turns out that promise didn't need breaking. board-call already reads
its signaling room straight off the page's own `?id=` query param —
not a prop, not a shared elf state, just `window.location.search` at
module load. the signaling server keys rooms by whatever string shows
up, no validation, no bulletin-board coupling. put `?id=game-night` on
a bulletin-board URL and a box-scores URL and two "realities" land in
the same call with zero bridge code — the bridge was already there,
nobody had pointed a second app at it yet. box-scores now mounts
`<board-call>` unmodified behind a "Chat On"/"Chat Off" header toggle,
disabled with an honest tooltip until an id actually shows up, so it
never accidentally joins the bare `'default'` room that a bulletin-
board with no id of its own already lives in.

then a second ask landed mid-commit: the mute button and camera button
each hid a secret 500ms-long-press device picker — discoverable by
nobody who hadn't been told. those two buttons became one gear icon
that opens a real settings overlay — full-screen backdrop, a white card
centered on top, label on the left, control on the right, one row per
setting. first pass anchored it as a small lemonchiffon popover below
the gear, matching board-call's existing device-picker aesthetic; asked
to make it a real modal instead, so it moved to a `position: fixed`
overlay mounted straight on the component root rather than nested
inside the hud, which means the modal can't be yanked out from under
itself if the hud's own visibility state changes while it's open.

the mute/camera buttons themselves stopped being ad hoc styled buttons
and became `.standard-toggle` — a new sibling to plan1's existing
`.standard-button`/`.standard-input` family in `system.css`, same
gradient-and-border-bottom look, gray when off and green when on
instead of the old opacity-dimmed "disabled" look. the device dropdowns
now use `.standard-input` directly instead of a custom picker-item
button list. two rows exist that had no equivalent before at all:
volume — every peer's panner now routes through one shared gain node
before the destination, with a slider owning it, where previously
there was no gain control anywhere — and speaker/output selection via
`AudioContext.setSinkId`, feature-detected since it's a recent,
Chromium-only addition; the row simply doesn't render where it isn't
supported.

the close button itself went through two more passes. first draft used
`bias-clear` and overlapped the first settings row outright — fixed
padding, still the wrong convention. plan1 already has one:
`@plan98/modal`'s own shell wraps its X in an `.action-wrapper`
(`position: absolute; top: 0; right: 0`) around a plain
`standard-button bias-generic -small -round`. board-call hand-rolls its
own overlay rather than going through that shared shell, but nothing
stopped it from borrowing the exact same wrapper/button convention —
so now it does, byte-for-byte the same classes plan98-modal uses.

two rows also do real work now instead of just existing. camera device
selection used to be a label guess — "fake_device_0" tells you nothing
about which physical camera that is. now there's a live preview
underneath the picker, wired straight to `_localStream`, so choosing a
device is "yes, that one" instead of a bet. and the mic never had any
feedback at all about whether it was even picking up sound, let alone
too loud — there's now a 10-segment level meter (green/yellow/red,
red being the clipping zone) fed by its own local `AnalyserNode`,
separate from the per-peer analysers the proximity mesh already uses
for speaker detection. it only polls while the panel is open, and
almost shipped polling on every 100ms speaker-detection tick instead —
`afterUpdate` fires on any `$.teach()` anywhere in the elf, not just
settings changes, so the meter's own start function needed an "already
running" guard or it would've torn down and restarted its interval
before a single reading ever landed.

then a real bug surfaced, not a style note: toggling box-scores' "Chat
Off" only ever removed the `<board-call>` DOM node. everything under
it — the signaling websocket, every open peer connection, live mic/
camera tracks, both polling intervals — kept running invisibly,
because plan1's own elf framework has no unmount hook at all (confirmed
by reading all of `plan98.js` — it watches nodes being *added*, never
removed). the fix already exists elsewhere in this codebase:
`was-video.js`, `v-log.js`, and `plan98-camera.js` all pair their elf
with a plain `class extends HTMLElement { disconnectedCallback() {...} }`
+ `customElements.define`, sitting alongside the elf's own rendering,
purely for a real lifecycle hook. board-call now does the same —
`teardownCall()` clears both intervals, closes the websocket (with its
auto-reconnect handler nulled out first, so an intentional close can't
schedule its own resurrection), closes every peer connection, stops
every local track, and closes the audio context. verified with real
instrumentation, not a guess: monkeypatched `MediaStreamTrack.stop`/
`WebSocket.close`/`RTCPeerConnection.close` before the page loaded,
turned the camera on, toggled chat off, and watched 2 real track stops
and 1 real socket close land — then toggled back on and confirmed a
clean remount with no leftover-state errors.

tested for real throughout, not read-and-hoped: headless chromium with
fake media devices, force-expand past the HUD's own visibility gate,
open settings, confirm every row renders, flip mute, drag volume, turn
the camera on and screenshot the live preview, watch the meter's DOM
respond — across four separate build/test passes as the shape changed
each time something got called out. that same testing surfaced
something I didn't go looking for and didn't fix: a lone caller with no
peers yet and camera off can never reach *any* control, old or new,
because the whole HUD stays `display:none` until someone else is
already on the call or your own camera's already on. not new, not
touched, just named out loud instead of quietly working around it in
the test.

— B0X5C0RE-CAFE-BABE-C0DE-DEADBEEF2026
