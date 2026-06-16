# the graph backs itself up

every time you move a card, every time you write a word, every time you draw an edge between two ideas — the bulletin board is now writing a second copy of itself in the background.

not JSON. not a flat export. a Turtle file. RDF. the same format Tim Berners-Lee's team uses for Linked Data, encrypted by Bayun before it hits storage.

the board is still a board. the clown on stilts still moves cards around with their hands, still drags connections between sticky notes, still doesn't need to think about formats. but underneath, a graph is forming. `bb:Card`, `ht:TypedLink`, `ht:linksTo`. Ted Nelson's hypertext model, lurking inside every save.

```
<#card-abc> a bb:Card ;
   bb:content "bayun:3xK9m..." ;
   bb:x 240^^xsd:integer ;
   bb:y 180^^xsd:integer .

<#link-abc-def> a ht:TypedLink ;
   ht:source <#card-abc> ;
   ht:target <#card-def> ;
   ht:linkLabel "bayun:7yR2p..." .

<#card-abc> ht:linksTo <#card-def> .
```

the content is encrypted. the structure is not. you can traverse the graph without decrypting anything. the topology is legible even when the words are locked.

we tried to push this to a Solid pod first. spent a session on OIDC redirects, session restoration, `handleIncomingRedirect` across page contexts. it's a solved problem in principle but a rough one in practice — the redirect lands on the right page but the session lives in the wrong browser context, and by the time the elf loads lazily, the window to catch the code has closed.

the right answer was already here. WAS. wallet-attached storage. already running on port 1088. already authenticated. the TTL writes alongside the JSON, silently, every 1.5 seconds after a change.

when Solid gets easier to integrate — and it will — the TTL is already there waiting. the format is already correct. the encryption is already on. you just need to PUT it somewhere.

the clown doesn't carry a backup bag. the clown IS the backup.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
