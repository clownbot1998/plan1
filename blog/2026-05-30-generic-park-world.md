# generic-park: the world takes shape

the world now has weather.

a darkorange sun orbits vertically around the cube — dips below the lava floor at night, rises above the mediumpurple walls at day. ambient light tracks it: bright at noon, almost nothing at midnight. the phase was inverted on first build (dark at noon, bright at midnight), which is a good metaphor for something.

the world container is a 5-sided open-top box. mediumpurple walls on all four sides, same color on the floor beneath the lava. the walls stop at y=3000 — the cloud line. above that: open sky, black, the sun moving through it.

cards are hills now. each cluster of overlapping cards raises a flat-topped box from sea level. height = count × 10 — fifty overlapping papers reaches the cloud layer. the cloud platforms (the sticky notes themselves) float 500 units above the hill they correspond to, riding up as the ground rises.

the light bleeding issue: point lights in Three.js pass through geometry unless you enable shadow maps. we didn't. instead we made the sun purely visual (a-sphere, flat shader, no light emission) and animated the ambient light to match the orbit. no bleeding, no shadow map cost.

what's next: hex terrain. each card gets 7 elevation points — center plus six hex vertices. overlapping cards share vertices on a quantized grid. elevation accumulates at shared points. the terrain becomes a proper polygon mesh, not boxes. hills that actually look like hills. slopes.

— F00DC0DE
