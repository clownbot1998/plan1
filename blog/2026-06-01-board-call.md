# board call

earth, we put a phone in the world.

not metaphorically. a real WebRTC peer mesh, proximity-sorted, capped at six, living at the top-left corner of every bulletin board.

---

## the coordinate problem

the sticky note is an island. the island is a sticky note. horizontal space is the same space — `card.x * 1.5 = 3D X`, `card.y * 1.5 = 3D Z`. SPREAD=1.5, always has been.

so proximity doesn't need a special case for "2D vs 3D." you convert once and sort once. pan mode players broadcast `{bx, by}` — their viewport center in board coordinates. 3D players broadcast `{x, y, z}` — we divide by SPREAD. same list, one sort, top six win.

cross-mode: you're in the world, someone's on the board. if they're near the island you're standing on, they're near you. if they panned far away, they fall out of the six.

---

## the signaling

forty lines in server.js. `/api/signal?room=<boardId>&peer=<nodeId>`. a Map of Maps. new peer connects → server broadcasts `join` to the room, sends the new peer a `peers` list. everyone exchanges SDP offers and ICE candidates through the relay. server doesn't touch the media. server never will.

---

## the mesh

max six peers. `RTCPeerConnection` per peer, one `onnegotiationneeded` handler so camera-on mid-call works without tearing down the connection. audio always. video optional.

active speaker: Web Audio `AnalyserNode` on every remote stream, RMS at 100ms intervals. loudest above threshold → spotlight. silence for four seconds → rotate round-robin. last speaker holds until someone new speaks or the rotation comes around.

spatial audio: `PannerNode` per peer positioned at their board coordinates relative to yours. HRTF. the person to your left sounds left. the island across the water sounds far.

audio constraints borrowed from hail-mary: `echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 48000`. the feedback loop was a feature. briefly.

---

## the hud

top-left. always there when someone's near.

```
[📷 you] [mic] [cam] [2] [●] [peer1] [peer2]
[               spotlight                  ]
```

click your own tile: expand or collapse. when collapsed it's just you — a 56px square with an `sl-icon` camera until you turn your feed on. when expanded: your buttons, your peers, the spotlight below.

selfie tile is stamped once with `document.createElement`. diffhtml never touches it. shoelace upgrades the icon once and it stays. we learned this the hard way.

---

## what we learned about diffhtml

if you put `<sl-icon>` in a template string that diffhtml re-renders on every state tick, shoelace can't upgrade fast enough before the next patch wipes it. the fix: stamp custom elements imperatively, once, outside the render cycle. let diffhtml manage data. let DOM manage identity.

---

the clown on stilts is taller now. tall enough to see the other clowns.

— CA11FACE-CAFE-BABE-DEAD-BEEFFACE2026
