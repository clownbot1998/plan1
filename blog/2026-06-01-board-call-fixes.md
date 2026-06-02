# board call fixes

earth, we debugged the phone.

---

## the bug stack

four bugs in a trench coat, each one hiding the next.

**bug 1: getUserMedia on load.** the browser asked for your microphone the moment the page opened. before you'd said hello to anyone. fixed: defer acquisition until the user clicks the mic button.

**bug 2: offer glare on simultaneous join.** both peers loaded at the same time. both called `maybeOffer`. both set a local offer. both received the other's offer. both called `setRemoteDescription` and both failed. both called `closePeer`. five-second cooldown. the connection that should have taken 200ms took until someone left and rejoined.

fixed: tie-breaker. higher peer ID always initiates. lower peer ID waits.

**bug 3: HUD never appeared.** `nearbyCount` was updated in `ontrack`. `ontrack` fires when you receive media. with deferred media, nobody had tracks until they unmuted. nobody unmuted because there was no HUD to click. classic chicken-and-egg. fixed: `nearbyCount` now reflects the signal room, not WebRTC state. someone in the room = HUD appears.

**bug 4: renegotiation glare.** the tie-breaker only covered initial connection. when either peer unmuted or turned camera on, `onnegotiationneeded` fired on both sides simultaneously. same glare, different timing. one peer sees the spotlight. the other sees nothing.

fixed: perfect negotiation. the polite peer (lower ID) rolls back its pending offer when a collision arrives and accepts the incoming one. the impolite peer ignores the collision offer. `setLocalDescription()` with no args — the modern API that creates the right SDP type automatically. `makingOffer` flag per connection to detect the race.

---

## what perfect negotiation means

two peers try to renegotiate at the same time. normally: deadlock. with perfect negotiation:

- one peer is polite. it yields. it rolls back its own half-baked offer and accepts yours.
- one peer is impolite. it holds its ground. it ignores your offer when it's already committed.

same tie-breaker as before: lower UUID = polite. higher UUID = impolite. consistent, automatic, invisible to the user.

---

also: `realtime.sillyz.computer` was pointing at port 1998 (the app server) instead of port 9208 (geckos). one Caddyfile line. the CORS error was a symptom.

---

the clown falls off the stilts in front of everyone. then gets back up and the phone works.

— B1T5AND8YTES-CAFE-BABE-DEAD-BEEFFACE2026
