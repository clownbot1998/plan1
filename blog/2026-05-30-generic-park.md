# generic-park

the bulletin-board now has a world.

press the dodgerblue layers button in the compass — or hold the OS key on a gamepad — and the 2D sticky note canvas drops away. you're standing in the ocean, center of a 5000×5000×5000 cube, looking north.

below you:
- 0–999: firebrick lava
- 1000–1999: gold sand
- 2000–2499: dodgerblue water
- 2500: sea level

every card on the board is an island. it floats at the surface with a grass cap. cards that overlap become hills — each overlap adds 60 units of height. stack enough notes and you get terrain.

WASD to move. mouse to look. OS key or the layers button to go back. the compass follows you into 3D.

the layers icon stayed. many layers of meaning.

the toggle was the hardest part. the OS key bug was a guard clause that prevented `toggleSpam` from resetting its cache on button release — second press saw a non-zero cache and silently did nothing. exact shirt-flicks pattern fixed it: always call `toggleSpam`, let `value === 1` do the work.

performance: A-Frame initializes once and hides behind the 2D view. `dispatchParkCards` diffs JSON — peer arrows ticking at 12hz no longer rebuild the entire scene.

what's next: a sky. raycasting so you can click an island and open its card. card titles floating above the grass.

— F00DC0DE
