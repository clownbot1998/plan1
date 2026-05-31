import { Self, PLAN98_NODE_ID, linkState, broadcastElf } from '@plan98/types'
import 'aframe'
import RAPIER from '@dimforge/rapier3d-compat'
import { checkButton, checkAxis } from '/elves/debug-gamepads.js'

const tag = 'generic-park'
const $ = Self(tag, { cards: {}, edgeTypes: {} })

// ── physics state ─────────────────────────────────────────────────────────────
let _phys       = null   // { world, body, collider, ctrl }
let _physVel    = { x: 0, y: 0, z: 0 }
let _physKeys   = {}
let _physTarget = null
let _physLastT  = 0
let _terrainGeoData   = null  // filled by buildTerrainMesh each rebuild
let _cloudBodies      = []    // rapier bodies for cloud platforms, rebuilt with cards
let _portals          = []    // { x, y, z, toCardId } — rebuilt with tunnel mesh
let _teleportCooldown = 0     // one teleport per world per 2s — good lore, good for multiplayer

// ── multiplayer — rides plan98 geckos kernel, same room as bulletin-board ─────
const _boardId = new URLSearchParams(window.location.search).get('id') || 'default'
let _broadcastT = 0

const PLAYERS_MERGE = `(state, payload) => {
  var inc = payload.players || {}
  var base = Object.assign({}, state.players || {})
  Object.keys(inc).forEach(function(k) {
    if (inc[k] === null) delete base[k]
    else base[k] = Object.assign({}, base[k] || {}, inc[k])
  })
  return Object.assign({}, state, { players: base })
}`

// ── inspector ─────────────────────────────────────────────────────────────────
let _selectedCardId = null
let _btnPrev        = {}
let _mouseDownPos   = null

window.addEventListener('keydown', e => { _physKeys[e.code] = true  })
window.addEventListener('keyup',   e => { _physKeys[e.code] = false })
window.addEventListener('mousedown', e => { _mouseDownPos = { x: e.clientX, y: e.clientY } })
window.addEventListener('mouseup', e => {
  if (!_physTarget || _physTarget.style.display === 'none') return
  if (!_mouseDownPos) return
  if (Math.hypot(e.clientX - _mouseDownPos.x, e.clientY - _mouseDownPos.y) > 6) return
  doInspect()
})

window.addEventListener('park:cards', e => {
  $.teach({ cards: e.detail.cards || {}, edgeTypes: e.detail.edgeTypes || {} })
})
window.dispatchEvent(new CustomEvent('park:ready'))

// ── constants ─────────────────────────────────────────────────────────────────

const SEGS       = 200
const SPREAD     = 1.5           // card centers pushed 1.5× apart; island size unchanged
const WORLD      = 7500          // 5000 * SPREAD
const SEA        = 2500          // sea surface Y
const CLOUD      = 3000          // cloud platform base Y
const CLIFF_FLOOR = 2000         // cliff base / sea floor Y

// ── card coordinate helper ────────────────────────────────────────────────────

function cardBounds(card) {
  const x = card.x * SPREAD
  const z = card.y * SPREAD
  return { x, z, w: card.w, h: card.h, cx: x + card.w / 2, cz: z + card.h / 2 }
}

// ── height ────────────────────────────────────────────────────────────────────

// tent function: max at card center, 0 at card edges, 0 outside
function computeHeight(vx, vz, entries) {
  let h = 0
  for (const [, card] of entries) {
    const b = cardBounds(card)
    if (vx < b.x || vx > b.x + b.w) continue
    if (vz < b.z || vz > b.z + b.h) continue
    const tx = 1 - Math.abs(vx - b.cx) / (b.w / 2)
    const tz = 1 - Math.abs(vz - b.cz) / (b.h / 2)
    h += 30 * tx * tz
  }
  return Math.min(h, 500)
}

function elevColor(e) {
  if (e > 400) return [1.00, 1.00, 0.95]  // near-white cream — approaching cloud
  if (e > 250) return [1.00, 0.90, 0.60]  // warm peach
  if (e > 100) return [1.00, 0.95, 0.70]  // light lemon
  if (e > 0)   return [1.00, 0.98, 0.80]  // lemonchiffon — sea level
  return [0.00, 0.56, 1.00]               // (holes punched at h=0, shouldn't render)
}

// ── terrain mesh ──────────────────────────────────────────────────────────────

function buildTerrainMesh(cards) {
  const THREE = window.AFRAME?.THREE
  if (!THREE) return null
  const entries = Object.entries(cards)

  const base = new THREE.PlaneGeometry(WORLD, WORLD, SEGS, SEGS)
  base.rotateX(-Math.PI / 2)
  const basePosArr = base.attributes.position.array
  const baseIdxArr = base.index.array
  const N = SEGS + 1

  // compute heights — vx/vz in 0..WORLD, card bounds already scaled
  const heights = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) {
    const vx = basePosArr[i * 3]     + WORLD / 2
    const vz = basePosArr[i * 3 + 2] + WORLD / 2
    heights[i] = computeHeight(vx, vz, entries)
  }

  const positions = [], colors = []
  for (let i = 0; i < N * N; i++) {
    const h = heights[i]
    positions.push(basePosArr[i*3], SEA + 1 + h, basePosArr[i*3+2])
    const [r,g,b] = elevColor(h)
    colors.push(r, g, b)
  }

  // holes where h=0 on all three vertices
  const kept = []
  for (let i = 0; i < baseIdxArr.length; i += 3) {
    const v0=baseIdxArr[i], v1=baseIdxArr[i+1], v2=baseIdxArr[i+2]
    if (heights[v0]>0 || heights[v1]>0 || heights[v2]>0) kept.push(v0,v1,v2)
  }

  // boundary edges for cliff faces
  const edgeMap = new Map()
  for (let i = 0; i < kept.length; i += 3) {
    for (const [a,b] of [[kept[i],kept[i+1]],[kept[i+1],kept[i+2]],[kept[i+2],kept[i]]]) {
      const k = a<b ? a*50000+b : b*50000+a
      edgeMap.set(k, (edgeMap.get(k)||0) + 1)
      if (!edgeMap._raw) edgeMap._raw = new Map()
      edgeMap._raw.set(k, [a,b])
    }
  }

  const bottomIdx = new Map()
  const cliffIndices = []
  let nextIdx = N * N

  for (const [k, count] of edgeMap) {
    if (count !== 1) continue
    const [a, b] = edgeMap._raw.get(k)
    for (const vi of [a, b]) {
      if (!bottomIdx.has(vi)) {
        bottomIdx.set(vi, nextIdx++)
        positions.push(positions[vi*3], CLIFF_FLOOR, positions[vi*3+2])
        colors.push(0.24, 0.70, 0.44)  // mediumseagreen — underwater cliff wall
      }
    }
    const ba = bottomIdx.get(a), bb = bottomIdx.get(b)
    cliffIndices.push(a, ba, bb,  a, bb, b)
  }

  base.dispose()

  // save for rapier trimesh — local space, initPhysics adds WORLD/2 offset
  _terrainGeoData = {
    positions: new Float32Array(positions),
    indices:   new Uint32Array([...kept, ...cliffIndices]),
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(colors), 3))
  geo.setIndex([...kept, ...cliffIndices])
  geo.computeVertexNormals()

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
  }))
  mesh.position.set(WORLD/2, 0, WORLD/2)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// ── cloud platforms ───────────────────────────────────────────────────────────

function renderCloudPlatforms(cards) {
  const entries = Object.entries(cards)
  return entries.map(([, card]) => {
    const b = cardBounds(card)
    const h = computeHeight(b.cx, b.cz, entries)
    const cloudY = CLOUD + h
    const color = card.color || 'lemonchiffon'
    return `<a-box position="${b.cx} ${cloudY} ${b.cz}"
                   width="${b.w}" height="10" depth="${b.h}"
                   color="${color}"></a-box>`
  }).join('')
}

// ── sea floor path arrows + cliff rise terminators ───────────────────────────

const SEA_FLOOR_Y = CLIFF_FLOOR + 15  // true sea floor — top of gold layer, bottom of water column

// point where ray from bounds center in direction (nx,nz) exits the rectangle
function cliffFaceEdge(b, nx, nz) {
  const halfW = b.w / 2, halfH = b.h / 2
  const t = Math.min(
    nx !== 0 ? halfW / Math.abs(nx) : Infinity,
    nz !== 0 ? halfH / Math.abs(nz) : Infinity,
  )
  return [b.cx + nx * t, b.cz + nz * t]
}

function insideIsland(px, pz, b) {
  return px > b.x && px < b.x + b.w && pz > b.z && pz < b.z + b.h
}

function segmentClear(x1, z1, x2, z2, skipA, skipB, allBounds) {
  for (let i = 1; i < 20; i++) {
    const t = i / 20
    const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t
    for (const b of allBounds) {
      if (b === skipA || b === skipB) continue
      if (insideIsland(px, pz, b)) return false
    }
  }
  return true
}

// push outward until clear of all other islands, then add exactly one grid cell
function safePush(cx, cz, dx, dz, skip, allBounds) {
  const GRID = WORLD / SEGS  // ~37.5 units — one terrain cell
  let clearDist = 0
  for (let dist = 0; dist <= 1200; dist += 8) {
    const px = cx + dx * dist, pz = cz + dz * dist
    if (!allBounds.some(b => b !== skip && insideIsland(px, pz, b))) { clearDist = dist; break }
  }
  const d = clearDist + GRID
  return [cx + dx * d, cz + dz * d]
}

// returns extra [x,z] waypoints between cliff exit and cliff entry
function findClearWaypoints(x1, z1, x2, z2, skipA, skipB, allBounds) {
  if (segmentClear(x1, z1, x2, z2, skipA, skipB, allBounds)) return []
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz)
  const px = -dz / len, pz = dx / len  // left-perpendicular unit
  for (const sign of [1, -1]) {
    for (const off of [500, 900, 1400]) {
      const wx = (x1 + x2) / 2 + px * off * sign
      const wz = (z1 + z2) / 2 + pz * off * sign
      if (allBounds.some(b => b !== skipA && b !== skipB && insideIsland(wx, wz, b))) continue
      if (!segmentClear(x1, z1, wx, wz, skipA, skipB, allBounds)) continue
      if (!segmentClear(wx, wz, x2, z2, skipA, skipB, allBounds)) continue
      return [[wx, wz]]
    }
  }
  return []
}

// sphere always at tube/sea-floor level, cone always at mid-cliff — only presence changes
function addCliffMarker(group, x, z, mat, withSphere, withCone, MR, CH) {
  if (withSphere) {
    const sph = new THREE.Mesh(new THREE.SphereGeometry(MR, 12, 8), mat)
    sph.position.set(x, SEA_FLOOR_Y, z)
    group.add(sph)
  }
  if (withCone) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(MR, CH, 8), mat)
    cone.position.set(x, SEA_FLOOR_Y + MR + CH / 2, z)
    group.add(cone)
  }
}

function buildTunnelMesh(cards, edgeTypes) {
  const THREE = window.AFRAME?.THREE
  if (!THREE) return null

  const entries   = Object.entries(cards)
  const allBounds = entries.map(([, c]) => cardBounds(c))
  const group     = new THREE.Group()
  const seen      = new Set()
  _portals        = []  // reset on every rebuild

  for (const [, card] of entries) {
    for (const [linkId, link] of Object.entries(card.links || {})) {
      if (seen.has(linkId)) continue
      seen.add(linkId)

      const fromCard = cards[link.from]
      const toCard   = cards[link.to]
      if (!fromCard || !toCard || link.from === link.to) continue

      const ba = cardBounds(fromCard)
      const bb = cardBounds(toCard)
      const dist = Math.hypot(bb.cx - ba.cx, bb.cz - ba.cz)
      if (dist < 1) continue
      const nx = (bb.cx - ba.cx) / dist, nz = (bb.cz - ba.cz) / dist

      const typeColor = edgeTypes[link.typeId]?.color || 'dodgerblue'
      const color     = new THREE.Color(typeColor)
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color.clone(), emissiveIntensity: 2.5 })

      const MR = 55, CH = 130
      const [ex, ez] = cliffFaceEdge(ba,  nx,  nz)
      const [fx, fz] = cliffFaceEdge(bb, -nx, -nz)

      // push markers into open water, stepping past any island in the way
      const [apx, apz] = safePush(ex, ez,  nx,  nz, ba, allBounds)  // A outward = toward B
      const [bpx, bpz] = safePush(fx, fz, -nx, -nz, bb, allBounds)  // B outward = toward A

      // sea floor path between pushed marker positions, navigating around islands
      const waypts = findClearWaypoints(apx, apz, bpx, bpz, ba, bb, allBounds)

      // tube: floor path → rise to cone base only
      const pts = [
        new THREE.Vector3(apx, SEA_FLOOR_Y, apz),
        ...waypts.map(([wx, wz]) => new THREE.Vector3(wx, SEA_FLOOR_Y, wz)),
        new THREE.Vector3(bpx, SEA_FLOOR_Y, bpz),
        new THREE.Vector3(bpx, SEA_FLOOR_Y + MR, bpz),  // rise to cone base, no further
      ]
      if (pts.length < 3) {
        pts.splice(1, 0, new THREE.Vector3((apx + bpx) / 2, SEA_FLOOR_Y, (apz + bpz) / 2))
      }

      const curve   = new THREE.CatmullRomCurve3(pts)
      const tubeGeo = new THREE.TubeGeometry(curve, pts.length * 10, 25, 8, false)
      group.add(new THREE.Mesh(tubeGeo, mat))

      // determine directionality — check if B also has a link back to A
      const isBidir = Object.values(toCard.links || {}).some(l => l.to === link.from)
      const markerMat = new THREE.MeshStandardMaterial({ color, emissive: color.clone(), emissiveIntensity: 3.5 })

      addCliffMarker(group, apx, apz, markerMat, true,    isBidir, MR, CH)  // A: sphere entrance
      addCliffMarker(group, bpx, bpz, markerMat, isBidir, true,    MR, CH)  // B: cone exit

      // portal at A's sphere → exits at B's cloud platform
      _portals.push({ x: apx, y: SEA_FLOOR_Y, z: apz, toCardId: link.to })
      // if bidirectional: portal at B's sphere → exits at A's cloud platform
      if (isBidir) _portals.push({ x: bpx, y: SEA_FLOOR_Y, z: bpz, toCardId: link.from })
    }
  }

  return group
}

// ── physics ───────────────────────────────────────────────────────────────────

// shoot ray from camera center — works for gamepad and mouse equally
function doInspect() {
  const THREE = window.AFRAME?.THREE
  if (!THREE || !_physTarget) return
  const mesh = _physTarget.querySelector('.terrain-mesh')?.getObject3D('terrain')
  const cam  = _physTarget.querySelector('a-scene')?.camera
  if (!mesh || !cam) return

  const ray  = new THREE.Raycaster()
  ray.setFromCamera({ x: 0, y: 0 }, cam)
  const hits = ray.intersectObject(mesh, false)

  if (!hits.length) { _selectedCardId = null; updateCardHud(); return }

  const pt = hits[0].point
  const { cards } = $.learn()
  for (const [id, card] of Object.entries(cards)) {
    const b = cardBounds(card)
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.z >= b.z && pt.z <= b.z + b.h) {
      _selectedCardId = id; updateCardHud(); return
    }
  }
  _selectedCardId = null; updateCardHud()
}

function updateCardHud() {
  if (!_physTarget) return
  const hud = _physTarget.querySelector('.card-hud')
  if (!hud) return
  if (!_selectedCardId) { hud.hidden = true; return }
  const { cards } = $.learn()
  const card = cards[_selectedCardId]
  if (!card) { hud.hidden = true; return }
  hud.hidden = false
  hud.innerHTML = `
    <div class="hud-inner" style="background:${card.color||'lemonchiffon'}">
      <strong>${card.name || 'untitled'}</strong>
      <button class="hud-open" data-id="${_selectedCardId}">open in board ↗</button>
    </div>`
}

function rebuildCloudColliders(cards) {
  if (!_phys) return
  const { world } = _phys

  // remove old cloud bodies
  for (const body of _cloudBodies) {
    try { world.removeRigidBody(body) } catch(_) {}
  }
  _cloudBodies = []

  const entries = Object.entries(cards)
  for (const [, card] of entries) {
    const b  = cardBounds(card)
    const h  = computeHeight(b.cx, b.cz, entries)
    const cy = CLOUD + h
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(b.cx, cy, b.cz),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.w / 2, 30, b.h / 2),
      body,
    )
    _cloudBodies.push(body)
  }
}

async function initPhysics(target, sx, sy, sz) {
  if (_phys) { try { _phys.world.free() } catch(_) {} }
  _phys = null
  _physTarget = target

  try {
    await RAPIER.init()
  } catch(e) {
    console.error('[generic-park] RAPIER.init() failed — physics disabled', e)
    return
  }

  const world = new RAPIER.World({ x: 0, y: -220, z: 0 })

  // terrain trimesh — transform local → world space
  if (_terrainGeoData) {
    const { positions: lp, indices } = _terrainGeoData
    const verts = new Float32Array(lp.length)
    for (let i = 0; i < lp.length; i += 3) {
      verts[i]   = lp[i]   + WORLD / 2
      verts[i+1] = lp[i+1]
      verts[i+2] = lp[i+2] + WORLD / 2
    }
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(verts, indices),
      world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
    )
  }

  // sea floor slab
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(WORLD / 2, 10, WORLD / 2),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(WORLD / 2, CLIFF_FLOOR - 10, WORLD / 2)),
  )

  // player capsule — radius 30, half-height 30 → 120 units tall
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sx, sy, sz),
  )
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(30, 30), body)

  const ctrl = world.createCharacterController(0.1)
  ctrl.setSlideEnabled(true)
  ctrl.setMaxSlopeClimbAngle(50 * Math.PI / 180)
  ctrl.setMinSlopeSlideAngle(30 * Math.PI / 180)
  ctrl.enableSnapToGround(2)

  // perimeter walls
  const wallH = CLOUD + 1000
  ;[
    [WORLD/2, wallH/2,  -20,       WORLD/2, wallH/2, 20],
    [WORLD/2, wallH/2,  WORLD+20,  WORLD/2, wallH/2, 20],
    [-20,     wallH/2,  WORLD/2,   20, wallH/2, WORLD/2],
    [WORLD+20, wallH/2, WORLD/2,   20, wallH/2, WORLD/2],
  ].forEach(([cx,cy,cz,hx,hy,hz]) => world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx,cy,cz)),
  ))

  _phys = { world, body, collider, ctrl }
  _physVel = { x: 0, y: 0, z: 0 }
  _physLastT = performance.now()

  linkState(tag, _boardId)  // join same geckos room as bulletin-board

  const { cards } = $.learn()
  rebuildCloudColliders(cards)

  requestAnimationFrame(physicsLoop)
}

function physicsLoop(now) {
  if (!_phys || !_physTarget || _physTarget.style.display === 'none') return

  const dt = Math.min((now - _physLastT) / 1000, 0.033)
  _physLastT = now

  const { world, body, collider, ctrl } = _phys
  const pos = body.translation()

  // gravity — always
  _physVel.y -= 220 * dt
  _physVel.y = Math.max(_physVel.y, -300)  // terminal velocity — cap for CCD reliability

  // water: buoyancy + drag
  if (pos.y < SEA) {
    const depth = Math.min((SEA - pos.y) / (SEA - CLIFF_FLOOR), 1)
    _physVel.y += 175 * depth * dt
    const drag = Math.pow(0.88, dt * 60)
    _physVel.x *= drag
    _physVel.z *= drag
  }

  // look + move — keyboard, gamepad joysticks both work
  const cam = _physTarget.querySelector('[camera]')
  const yaw = cam?.object3D?.rotation.y ?? 0
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw)
  const rgtX =  Math.cos(yaw), rgtZ = -Math.sin(yaw)

  // right stick → camera look (into look-controls' internal objects)
  const rs_x = checkAxis(0, 2) || 0, rs_y = checkAxis(0, 3) || 0
  if (Math.abs(rs_x) > 0.1 || Math.abs(rs_y) > 0.1) {
    const lc = cam?.components?.['look-controls']
    if (lc) {
      lc.yawObject.rotation.y   -= rs_x * 2.2 * dt
      lc.pitchObject.rotation.x -= rs_y * 2.2 * dt
      lc.pitchObject.rotation.x  = Math.max(-1.0, Math.min(1.0, lc.pitchObject.rotation.x))
    }
  }

  // left stick + keyboard → movement
  const ls_x = checkAxis(0, 0) || 0, ls_y = checkAxis(0, 1) || 0
  let mx = 0, mz = 0
  if (_physKeys['KeyW'] || _physKeys['ArrowUp'])   { mx += fwdX; mz += fwdZ }
  if (_physKeys['KeyS'] || _physKeys['ArrowDown'])  { mx -= fwdX; mz -= fwdZ }
  if (_physKeys['KeyA'] || _physKeys['ArrowLeft'])  { mx -= rgtX; mz -= rgtZ }
  if (_physKeys['KeyD'] || _physKeys['ArrowRight']) { mx += rgtX; mz += rgtZ }
  if (Math.abs(ls_x) > 0.1 || Math.abs(ls_y) > 0.1) {
    mx += rgtX * ls_x - fwdX * ls_y
    mz += rgtZ * ls_x - fwdZ * ls_y
  }

  // any gamepad button pressed → inspect
  let anyBtnPressed = false
  for (let b = 0; b < 16; b++) {
    const v = checkButton(0, b) || 0
    if (v > 0.5 && !(_btnPrev[b] > 0.5)) anyBtnPressed = true
    _btnPrev[b] = v
  }
  if (anyBtnPressed) doInspect()

  const mlen = Math.hypot(mx, mz)
  const SPEED = 300
  if (mlen > 0) {
    _physVel.x = (mx / mlen) * SPEED
    _physVel.z = (mz / mlen) * SPEED
  } else {
    const friction = pos.y < SEA ? 0.92 : 0.78
    _physVel.x *= Math.pow(friction, dt * 60)
    _physVel.z *= Math.pow(friction, dt * 60)
  }

  ctrl.computeColliderMovement(collider, {
    x: _physVel.x * dt,
    y: _physVel.y * dt,
    z: _physVel.z * dt,
  })
  const mv = ctrl.computedMovement()

  // reset vertical velocity if blocked (landed or ceiling)
  if (Math.abs(mv.y) < 0.5 && Math.abs(_physVel.y * dt) > 1) _physVel.y = 0

  const nx = pos.x + mv.x, ny = pos.y + mv.y, nz = pos.z + mv.z
  body.setNextKinematicTranslation({ x: nx, y: ny, z: nz })
  world.step()

  // camera eye = 40 units above capsule center
  if (cam) cam.setAttribute('position', `${nx} ${ny + 40} ${nz}`)

  // portal check — shared world cooldown, one teleport per 2s
  _teleportCooldown = Math.max(0, _teleportCooldown - dt)
  if (_teleportCooldown === 0) {
    for (const portal of _portals) {
      const dx = nx - portal.x, dy = ny - portal.y, dz = nz - portal.z
      if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 90) {  // MR(55) + capsule radius(35)
        const { cards } = $.learn()
        const toCard = cards[portal.toCardId]
        if (toCard) {
          const ents = Object.entries(cards)
          const bb   = cardBounds(toCard)
          const h    = computeHeight(bb.cx, bb.cz, ents)
          body.setNextKinematicTranslation({ x: bb.cx, y: CLOUD + h + 100, z: bb.cz })
          world.step()
          _physVel.y = 0
          _teleportCooldown = 2
        }
        break
      }
    }
  }

  // underwater atmosphere — hysteresis band prevents surface flicker
  const camY = ny + 40
  const wasUnder = !!_physTarget._underwater
  const underwater = wasUnder ? camY < SEA + 30 : camY < SEA - 30
  if (underwater !== wasUnder) {
    _physTarget._underwater = underwater
    const scene = _physTarget.querySelector('a-scene')
    if (scene) {
      if (underwater) {
        scene.setAttribute('fog', 'type: linear; color: #001144; near: 80; far: 500')
        scene.setAttribute('background', 'color: #001133')
      } else {
        scene.removeAttribute('fog')
      }
    }
  }

  // broadcast position ~10fps via plan98 geckos kernel
  _broadcastT += dt
  if (_broadcastT >= 0.1) {
    _broadcastT = 0
    broadcastElf(tag, { players: { [PLAN98_NODE_ID]: { x: nx, y: ny, z: nz } } }, PLAYERS_MERGE)
  }

  requestAnimationFrame(physicsLoop)
}

// ── spawn at centermost card, sea level (first load only) ─────────────────────

function spawnAtCenterIsland(target, cards) {
  const WC = WORLD / 2
  const entries = Object.entries(cards)
  let bestCard = null, minDist = Infinity
  for (const [, card] of entries) {
    const b = cardBounds(card)
    const d = Math.hypot(b.cx - WC, b.cz - WC)
    if (d < minDist) { minDist = d; bestCard = card }
  }
  if (!bestCard) return
  const b = cardBounds(bestCard)
  const h = computeHeight(b.cx, b.cz, entries)
  const sy = CLOUD + h + 300  // spawn above cloud — fall to island

  const cam = target.querySelector('[camera]')
  if (cam) cam.setAttribute('position', `${b.cx} ${sy + 40} ${b.cz}`)

  initPhysics(target, b.cx, sy, b.cz)
}

// ── perimeter ─────────────────────────────────────────────────────────────────

function renderPerimeter() {
  const c = 'mediumpurple', h = CLOUD, y = h / 2
  const W = WORLD, H = W + 400
  return `
    <a-box position="${W/2} ${y} ${-100}"  width="${H}" height="${h}" depth="200"  color="${c}"></a-box>
    <a-box position="${W/2} ${y} ${W+100}" width="${H}" height="${h}" depth="200"  color="${c}"></a-box>
    <a-box position="${-100} ${y} ${W/2}"  width="200"  height="${h}" depth="${H}" color="${c}"></a-box>
    <a-box position="${W+100} ${y} ${W/2}" width="200"  height="${h}" depth="${H}" color="${c}"></a-box>
    <a-box position="${W/2} -100 ${W/2}"   width="${H}" height="200"  depth="${H}" color="${c}"></a-box>
  `
}

// ── scene ─────────────────────────────────────────────────────────────────────

$.draw(target => {
  if (target._parkMounted) return
  target._parkMounted = true
  const W = WORLD, WH = W / 2
  return `
    <a-scene embedded vr-mode-ui="enabled: false" background="color: black"
             renderer="shadowMapEnabled: true; shadowMapType: pcfsoft">
      <a-entity camera look-controls
                position="${WH} ${SEA + 100} ${WH}" rotation="-10 0 0">
        <a-cursor color="white" opacity="0.4" fuse="false"></a-cursor>
      </a-entity>

      <a-light type="ambient" color="darkorange" intensity="0.8"
               animation="property: intensity; from: 0.8; to: 0.05;
                          dur: 30000; loop: true; dir: alternate;
                          easing: easeInOutSine"></a-light>
      <a-light type="ambient" color="#111133" intensity="0.3"></a-light>

      <a-entity position="${WH} ${SEA} ${WH}"
                animation="property: rotation; from: 0 0 0; to: 0 0 -360;
                           dur: 60000; loop: true; easing: linear">
        <a-sphere position="0 9000 0" radius="220"
                  material="color: darkorange; shader: flat"></a-sphere>
        <a-light type="directional" color="#ff9966" intensity="1.2"
                 position="0 9000 0" rotation="-90 0 0"
                 cast-shadow="true"
                 shadow-camera-left="${-WH}" shadow-camera-right="${WH}"
                 shadow-camera-top="${WH}"   shadow-camera-bottom="${-WH}"
                 shadow-camera-near="500"    shadow-camera-far="16000"
                 shadow-map-width="1024"     shadow-map-height="1024"></a-light>
      </a-entity>

      <a-light type="hemisphere" color="darkorange"
               ground-color="mediumpurple" intensity="0.4"></a-light>

      <a-box position="${WH} 500 ${WH}"  width="${W}" height="1000" depth="${W}" color="firebrick" shadow="receive: true"></a-box>
      <a-box position="${WH} 1500 ${WH}" width="${W}" height="1000" depth="${W}" color="gold"      shadow="receive: true"></a-box>
      <a-box position="${WH} 2250 ${WH}" width="${W}" height="500" depth="${W}"
             material="color: dodgerblue; opacity: 0.55; transparent: true; side: double"
             shadow="receive: true"></a-box>

      <!-- sky sphere — dodgerblue, just beyond sun orbit (r=9000), fades with day/night -->
      <a-sphere position="${WH} ${SEA} ${WH}" radius="10200" segments-height="18" segments-width="36"
                material="color: dodgerblue; opacity: 0.85; transparent: true; side: back; fog: false; shader: flat"
                animation="property: material.opacity; from: 0.85; to: 0; dur: 30000;
                           loop: true; dir: alternate; easing: easeInOutSine"></a-sphere>


      <a-entity class="perimeter">${renderPerimeter()}</a-entity>
      <a-entity class="terrain-mesh"></a-entity>
      <a-entity class="tunnels"></a-entity>
      <a-entity class="cloud-platforms"></a-entity>
      <a-entity class="players"></a-entity>
    </a-scene>
    <div class="card-hud" hidden></div>
  `
}, {
  afterUpdate(target) {
    const { cards, edgeTypes, players } = $.learn()

    // other players — rendered as spheres, exclude self
    const playersEl = target.querySelector('.players')
    if (playersEl) {
      playersEl.innerHTML = Object.entries(players || {})
        .filter(([id]) => id !== PLAN98_NODE_ID)
        .map(([, p]) => `<a-sphere position="${p.x} ${p.y + 60} ${p.z}"
          radius="30" color="mediumpurple" opacity="0.85"></a-sphere>`)
        .join('')
    }

    const json = JSON.stringify({ cards, edgeTypes })
    if (json === target._lastCards) return
    target._lastCards = json

    const terrainEl = target.querySelector('.terrain-mesh')
    if (terrainEl) {
      const old = terrainEl.getObject3D?.('terrain')
      if (old) { old.geometry.dispose(); old.material.dispose() }
      const mesh = buildTerrainMesh(cards)
      if (mesh) terrainEl.setObject3D('terrain', mesh)
    }

    const tunnelsEl = target.querySelector('.tunnels')
    if (tunnelsEl) {
      const old = tunnelsEl.getObject3D?.('tunnels')
      if (old) old.traverse(c => { c.geometry?.dispose(); c.material?.dispose() })
      const tg = buildTunnelMesh(cards, edgeTypes)
      if (tg) tunnelsEl.setObject3D('tunnels', tg)
    }

    const cloudEl = target.querySelector('.cloud-platforms')
    if (cloudEl) cloudEl.innerHTML = renderCloudPlatforms(cards)
    rebuildCloudColliders(cards)

    if (!target._spawned && Object.keys(cards).length > 0) {
      target._spawned = true
      spawnAtCenterIsland(target, cards)
    }
  }
})

$.style(`
  & { display: block; width: 100%; height: 100%; position: relative; }
  & a-scene { width: 100% !important; height: 100% !important; display: block; }
  & .card-hud {
    position: absolute; bottom: 1rem; right: 1rem; z-index: 10;
    min-width: 200px; max-width: 320px;
    pointer-events: auto;
  }
  & .hud-inner {
    padding: .75rem 1rem;
    border-radius: .5rem;
    box-shadow: 0 2px 12px rgba(0,0,0,.4);
    display: flex; flex-direction: column; gap: .5rem;
    font-family: monospace;
  }
  & .hud-open {
    align-self: flex-end;
    background: rgba(0,0,0,.15);
    border: none; border-radius: .25rem;
    padding: .25rem .6rem; cursor: pointer;
    font-size: .8rem;
  }
  & .hud-open:hover { background: rgba(0,0,0,.3); }
`)

$.when('click', '.hud-open', (e) => {
  const cardId = e.target.dataset.id
  window.dispatchEvent(new CustomEvent('park:open-card', { detail: { cardId } }))
})
