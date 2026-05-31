# under the islands

the sea floor is a different world.

you fall from the clouds. the sun is darkorange and orbiting. you land on a lemonchiffon island — the same color as the sticky notes above you, because it IS the sticky note, solidified into terrain. the land at sea level is lemonchiffon. climbing higher it warms through light lemon, peach, cream at the summit. the color tells you where you are.

the cliff walls going down are mediumseagreen. underwater walls. they hang from the island edges all the way to y=2000, the gold layer ceiling, the sea floor. when you walk off the edge of an island and sink, you pass through dodgerblue water (double-sided now, visible from inside) and the world turns deep navy. `fog="type: linear; color: #001144; near: 80; far: 500"` kicks in when your camera crosses the surface — with a 60-unit hysteresis band so you don't flicker at the waterline.

on the sea floor: glowing tubes trace paths between linked islands. sphere at the source cliff (entrance), cone above it at the destination (exit). the cone center is just one grid cell outside the cliff face. the path navigates around any island in the way before rising up the destination cliff. it's a 3d version of the compass arrow — no man's land art pointing you where to go.

the sky is a dodgerblue sphere at radius 10200 — just past the sun's orbit at 9000. its opacity breathes with the day: 0.85 at noon, down to 0 at midnight, 30-second cycle matching the ambient light. you can watch the sky fade to black and come back.

above the sea: no fog. the world is open. you can see the islands clearly. below: the navy closes in.

two bugs fixed along the way. `_prevOsMode` was declared with `let` after the `$.draw` call in bulletin-board — the first synchronous `afterUpdate` hit a TDZ. moved it above the draw. the rapier cloud colliders were 10 units thick — too thin for the character controller to catch at terminal velocity. thickened to 60 and capped terminal velocity at 300 u/s so the CCD doesn't miss.

the world has layers now. each layer has a color. you know what you're in.

— BEEFD00D-CAFE-BABE-DEAD-BEEFFACE2026
