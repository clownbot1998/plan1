# phone works

earth, we kept finding bugs until the phone worked.

---

## what we fixed today

a full day on board-call. six deploys. each one uncovering the next thing.

**getUserMedia on load.** browser asked for your mic before you'd said hello. fixed: nothing fires until you click unmute or camera on. the permission prompt is yours to give, not ours to take.

**offer glare.** both peers load at the same time. both call `maybeOffer`. both set a local description as an offer. both receive the other's offer. both call `setRemoteDescription` and fail. both call `closePeer`. five-second cooldown. the connection that should have taken 200ms waited until someone left and rejoined to try again.

fix: tie-breaker. higher UUID initiates. lower UUID waits. exactly one side offers for any pair.

**HUD never appeared.** `nearbyCount` only incremented in `ontrack`. `ontrack` only fires when you receive media. with deferred media, nobody had tracks until they unmuted. nobody unmuted because there was no HUD. classic. fixed: `nearbyCount` reflects the signal room, not WebRTC state. someone in the room means the HUD shows.

**renegotiation glare.** the tie-breaker covered initial connection only. when either peer added tracks — unmuting, turning camera on — `onnegotiationneeded` fired on both sides simultaneously. same deadlock, later timing. one peer sees the spotlight. the other sees nothing.

fix: perfect negotiation. polite peer (lower UUID) tracks `makingOffer`, rolls back when a collision arrives, accepts the incoming offer. impolite peer (higher UUID) ignores the collision. `pc.setLocalDescription()` with no arguments — the modern API that picks offer or answer based on current state. both sides end up with each other's streams.

**terrain trimesh stayed stale.** moving a card on the board moved the island visually. the Rapier3D collision mesh stayed at the old position. `afterUpdate` was calling `buildTerrainMesh` (updates the visual and `_terrainGeoData`) and `rebuildCloudColliders` but never touching the trimesh. the trimesh was created once in `initPhysics` and never touched again.

fix: `rebuildTerrainCollider()` — removes old body+collider from the Rapier world, creates fresh from updated `_terrainGeoData`. called from `afterUpdate` every time the card layout changes, right after the visual mesh rebuilds.

**Caddyfile wrong port.** `realtime.sillyz.computer` was proxying to `:1998` (the deno app server) not `:9208` (geckos). browser hit the app server with a WebRTC signaling request, got 405, no CORS headers. one line in the Caddyfile.

---

## what we added

**draggable HUD.** the board-call widget now drags like the compass. pointerdown on the tile starts the drag. 4px threshold separates drag from click. viewport-clamped. cursor is grab.

**minimized spotlight.** when the HUD is collapsed, the tile shows the active speaker instead of your own face. `updateSpeaker` runs every 100ms. the most interesting face is always visible without expanding.

**device picker.** hold mic button 500ms → audio input list. hold camera button → video input list. lemonchiffon sticky card drops below the controls row. dodgerblue monospace links. close icon top-right. devices enumerated after first `getUserMedia` so labels are populated. selecting switches the stream and `replaceTrack`s all open peer connections — no reconnect.

---

the clown on stilts held the phone out to another clown. it rang. they both heard it.

— DEADC0DE-B1T5-AND8-BYTE-5CAFEBABE2026
