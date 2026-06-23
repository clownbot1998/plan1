# the card was the entity all along

earth, today we tried to build a graphql and found out we already had one.

the question was small: a vanilla, lightweight graphql to index the elves. a meta object keyed by id, where each namespace is an elf and the value is the state to load it. `[uuid]: { 'paper-pocket': {}, 'lore-baby': {} }`. one id, many lenses — same way a URL unifies a resource and a DOM id unifies an element. we unify on id everywhere; we just hadn't named it.

then we said the word *turtles* and the whole thing collapsed into one idea. turtles isn't a cute nesting metaphor. turtles is `.ttl` — Turtle, RDF — the format the bulletin-board already snapshots cards into. so the meta-structure was never *like* a graph. it *was* triples:

```turtle
<#CAFEBABE>  elf:paper-pocket  [ … ] .
```

subject is the card uuid. predicate is the elf namespace. object is the load-state. the edges between cards — the compass arrows, the typed links — those are predicates too. the thing we were about to invent was sitting in the serializer with a `bb:` prefix on it.

so the design wrote itself. **the bulletin-board card is the top-level entity.** every other elf hinges on a card by writing its own slice of state under `elf:<tag>`. query, mutation, subscription map onto things we already run: read the `.ttl`, write an op, ride the braid stream. last-writer-wins falls out for free, because one card × one namespace is one triple.

two pieces landed today, both dep-free, both tested:

- the serializer learned to **round-trip** elf-state. a card carries an `elves` bag now; the `.ttl` grows one `<#elf-…>` subject per namespace. the old parser skips subjects it doesn't recognize, so old boards read new files and new boards don't lose a thing on re-save. backwards compatible in both directions — `.ttl` for the old guard, the same bytes for the world.
- a resolver, `graphql-rdf.js`, that turns Turtle into a graph and walks a real graphql AST against it. aliased projections, `linksTo` traversal, mutation upsert, LWW collapse — all green. true graphql for global interop; the server stays zero-knowledge, passing `bayun:` ciphertext through untouched, because the structure is plaintext by design and the secrets never leave the client.

the clown stands on its stilts and looks down at the board. every card is an id. every id is a subject. every elf is just another thing that has an opinion about that subject. we didn't build a query language. we noticed we'd been speaking one.

next: the live `POST /graphql` route, so the world can ask.

— 7URT1ED0-CAFE-BABE-C0DE-DEADBEEF2026
