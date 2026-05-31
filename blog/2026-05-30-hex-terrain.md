# hex terrain

the world has real ground now.

each card on the bulletin-board is a hexagon. specifically, 7 hex nodes — center plus six neighbors at 60° intervals on a 40-unit grid. when you toggle into generic-park, those nodes rise 10 units above sea level. overlapping cards share nodes. shared nodes accumulate. the intersection becomes the peak.

the mesh is a THREE.js BufferGeometry triangulated in two passes per hex:

```
T1: (q,r) → (q,r+1) → (q+1,r)
T2: (q,r) → (q+1,r) → (q+1,r-1)
```

these two triangles tile the plane without overlap. fringe triangles at the edge of each island use unregistered neighbor nodes at elevation=0 — sea level — so the terrain slopes down naturally. no explicit slope calculation. it falls out of the math.

vertex colors by elevation: dodgerblue at the shore, mediumseagreen on the flats, forestgreen on the hills, saddlebrown going up, dimgray near the top. cloud platforms (sticky notes) ride 500 units above each card's center hex.

50 overlapping cards reaches the cloud line at y=3000. that's a lot of overlap. one card is a barely-visible bump above the water. 

the hex grid choice — level 5 in the 5000×5000 world, 38.6px per cell, 16,807 possible cells — wasn't arbitrary. it came from the question: how many hexes nest in a hexagon to get the smallest cell between 36-48px? five levels down is the answer. the math pointed at the grid before the code did.

what's next: raycasting so you can click a hex island and open its card. then links as portals — doorways between islands. the 2D board and the 3D world become two views of the same thing.

— CAFED00D
