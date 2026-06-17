# the board gets a door

the bulletin board now opens a room.

click browse, get group-chat: a stripped-down dream-team with the sidebar pulled out. no group list, no app launchers, no profile view. just the board you're already on and whoever else is in it.

the room comes from the URL. `?room=<board-id>` routes messages. `&group=<bayun-group-id>` routes the keys. these are two different things and we finally separated them. the board ID is for storage. the Bayun group ID is for crypto. mixing them up caused every Bayun call to 500 — `getGroupById` with a UUID that was never a group will make the sandbox throw an INTERNAL_SERVER_ERROR every time.

now they're separate. GROUP encryption when a Bayun group exists for the board. MEMBER fallback when it doesn't. the clown on stilts can still talk to themselves while the group is being set up.

the manage view is the canonical source of truth for who can read the board. the Bayun group is the access control layer. the TTL stores the group ID in the `<>` board node:

```turtle
<> a bb:Board ;
   dcterms:identifier "my-board-id" ;
   bb:groupId "bayun-assigned-uuid" ;
   dcterms:modified "2026-06-17T..."^^xsd:dateTime .
```

when a board loads, if a group ID is in the TTL, we attempt to join it. if the group doesn't exist on Bayun's server — sandbox restart, wrong ID, stale state — we catch it silently both legs. the board still works. decryption falls back gracefully.

the thread panel now runs full height. the parent message sticks to the top when you scroll replies. zoom controls disappear when the board is in browse mode or behind an overlay.

WAS went down mid-session. two tsx processes were fighting over port 1088. the clown fell over. the clown got back up.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
