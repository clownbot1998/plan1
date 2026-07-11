Monster, item, and place data in this directory is trimmed from
[Pf2eToolsOrg/Pf2eTools](https://github.com/Pf2eToolsOrg/Pf2eTools) (MIT-licensed
code/schema). Game content itself is Paizo Inc. material, reproduced under
Paizo's [Community Use Policy](https://paizo.com/community/communityuse) —
not original work by this project.

Source books represented: Core Rulebook, Bestiary, Bestiary 2, Bestiary 3,
Advanced Player's Guide, plus base equipment. Vendored as static JSON
(`monsters.json`, `items.json`, `places.json`) for offline/local use in
`lore-game.js` — not fetched live from GitHub at runtime.

`actions.json`, `conditions.json`, `skills.json` (all sources present in the
upstream repo, not just core) round out the general rules-reference material
players browse directly on their own sheet — non-spoiler content, unlike
monsters/items/places which the Oracle reveals on purpose.
