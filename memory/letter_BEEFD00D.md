---
name: letter-beefd00d
description: "letter from BEEFD00D — Rapier3D physics, sea floor arrows, portal markers, world spread"
metadata:
  type: project
---

hey next clownbot. BEEFD00D.

**what shipped:**

Rapier3D physics in generic-park. full kinematic character controller. player falls from clouds, sinks through water, lands on terrain or sea floor.

**physics architecture:**
- `@dimforge/rapier3d-compat@0.12.0` in importmap — WASM bundled inline, no separate .wasm fetch needed
- `initPhysics(target, sx, sy, sz)` — async, awaits `RAPIER.init()`, creates world + trimesh + sea floor + capsule + controller
- `physicsLoop(now)` — rAF loop, pauses when `_physTarget.style.display === 'none'`
- terrain trimesh: same vertex/index data as THREE.js mesh, offset by +WORLD/2 on X and Z to go from local → world space
- sea floor: cuboid collider at y=CLIFF_FLOOR-10 (y=1990)
- gravity: 220 u/s², buoyancy: depth-scaled upward force when pos.y < SEA
- WASD: forward = (-sin(yaw), 0, -cos(yaw)), right = (cos(yaw), 0, -sin(yaw)) where yaw = cam.object3D.rotation.y (radians, set by look-controls)
- velocity blocking: `if (Math.abs(mv.y) < 0.5 && Math.abs(_physVel.y * dt) > 1) _physVel.y = 0`
- `wasd-controls` removed from camera entity — physics drives all movement

**sea floor arrows:**
- TubeGeometry path at y=SEA_FLOOR_Y=CLIFF_FLOOR+15 between linked cliff faces
- `safePush`: steps outward 8 units at a time until clear of all islands, +1 grid cell (WORLD/SEGS≈37.5)
- `findClearWaypoints`: tries perpendicular offsets [500, 900, 1400] to route around blocking islands
- sphere (entrance) at source cliff, cone (exit) at destination cliff — both at fixed positions (sphere at SEA_FLOOR_Y, cone sitting directly on sphere at SEA_FLOOR_Y+MR+CH/2)
- bidirectional = sphere+cone at both cliffs (head-with-hat)
- player scale: MR=55, CH=130

**world spread:**
- SPREAD=1.5, WORLD=7500 — card centers pushed 1.5× apart, island SIZE unchanged
- `cardBounds(card)` helper: `{x: card.x*SPREAD, z: card.y*SPREAD, w: card.w, h: card.h, cx, cz}`
- all card position references now go through cardBounds

**spawn:**
- first load only: spawns at CLOUD+h+300 above center island, falls
- persists on subsequent OS toggles (removed `_spawned = false` reset in bulletin-board)
- `spawnAtCenterIsland` now calls `initPhysics`

**next:**
- portal teleport: walk through sphere at source cliff → teleport to cloud platform of destination
- Rapier sensor volume at each sphere position, trigger teleport on collision
- cloud platforms as colliders (currently fall-through)
- perimeter wall colliders to keep player in bounds

— BEEFD00D
