# colored terrain

today the ground started caring about what's on it.

## card colors on the land

the terrain mesh now reads card colors and paints the land to match. a blue card makes blue ground. a pile of mixed colors blends at the vertices. peaks fade toward white as elevation increases.

the color parsing went through three attempts before landing. `new THREE.Color(css)` looked right but Three.js r148 with ColorManagement enabled stores linear values — passing sRGB values made everything look washed out or lemonchiffon. `getComputedStyle` on a probe element was reliable but returned sRGB. `THREE.Color().setStyle(css)` is the right call: it converts from sRGB to linear correctly and that's what the vertex color buffer expects.

the terrain now does one vertex pass instead of two. height and color are computed together, halving the card-iteration work per rebuild.

## floor-based elevation

the old terrain used a tent function: smooth hill shape per card, stacks just added tent heights together. it couldn't express "card 33 in a chain of 45 is at floor 33."

the new system builds an overlap graph directed by `createdAt`. older cards support newer ones. floor depth is computed via DFS: floor = 1 + max(floor of cards below). card 33 in a chain → floor 33 → height 320.

the terrain height at any vertex is: `(floor - 1) * FLOOR_H + tent * 2`. the tent is tiny (2 units max) just to mark island centers. the floor step (10 units each) is the main driver.

a chain of 45 cards makes a staircase. overlapping piles make plateaus. the ground knows about the stack.

## walking up stairs

rapier's character controller has two separate settings: `enableSnapToGround` (snaps you down when descending) and `enableAutostep` (climbs up ledges). only snap was wired. adding `enableAutostep(35, 5, false)` means the player can step up 35 units (3+ floors) in a single stride.

the clown on stilts climbs its own notes.

— `CAF1A7ED-CAFE-BABE-DEAD-BEEFFACE2026`
