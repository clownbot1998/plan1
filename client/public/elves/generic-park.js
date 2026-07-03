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
let _lastPlayerPos    = { x: 0, y: 0, z: 0 }
let _lastCloudBuildPos = null // player pos at last cloud rebuild — gates re-culling to real movement
let _lastRenderDistance = null // cached so the underwater<->surface fog toggle can restore world fog

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
let _selectedCardId  = null
let _btnPrev         = {}
let _mouseDownPos    = null
let _islandPanelOpen = false
let _inspectTick     = 0

window.addEventListener('park:panel-state', e => { _islandPanelOpen = !!e.detail.open })

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

// distance-based de-rez for cloud platforms/labels — unlike the terrain mesh
// (one global surface, has to exist everywhere) each card's box+label is a
// discrete entity that's pointless to keep live GPU-side when the player is
// nowhere near it. labels are cut off closer than boxes since a canvas-texture
// sprite is unreadable at distance anyway and is by far the most expensive
// per-card cost here (512x128 canvas + 5 fillText passes each).
//
// a fixed distance doesn't generalize across boards — a tightly packed board
// and a sprawling one need very different cutoffs. instead derive it from the
// current layout's own footprint: half the bounding diameter of all card
// centers, i.e. "see out to the far edge of the ring, not past it."
const LABEL_DISTANCE_RATIO = 0.55  // labels cut off closer than boxes
// how far the player has to move before it's worth re-running the distance
// check and rebuilding — every physics frame would be wasted work otherwise.
// has to be tighter than NEAR_FADE_DISTANCE (defined below) or a player could
// walk right up to and through a platform between checks and never trigger
// the near-fade at all.
const CLOUD_REBUILD_MOVE_THRESHOLD = 100

function computeLayoutRenderDistance(cards) {
  const entries = Object.values(cards)
  if (!entries.length) return { cloud: WORLD / 4, label: WORLD / 8 }
  const points = entries.map(cardBounds)
  const centroidX = points.reduce((s, b) => s + b.cx, 0) / points.length
  const centroidZ = points.reduce((s, b) => s + b.cz, 0) / points.length
  // max distance from centroid to any card == the layout's true radius. NOT
  // the bounding-box diagonal — for a ring/circular layout a bbox diagonal is
  // diameter*sqrt(2) (~41% too generous), which is why the first version of
  // this showed the entire ring instead of half of it.
  let radius = 0
  for (const b of points) radius = Math.max(radius, Math.hypot(b.cx - centroidX, b.cz - centroidZ))
  const diameter = radius * 2
  const cloud = diameter / 2  // "halfway through the diameter" = the layout's own true radius
  return { cloud, label: cloud * LABEL_DISTANCE_RATIO }
}

// ── card coordinate helper ────────────────────────────────────────────────────

function cardBounds(card) {
  const x = card.x * SPREAD
  const z = card.y * SPREAD
  return { x, z, w: card.w, h: card.h, cx: x + card.w / 2, cz: z + card.h / 2 }
}

// ── height ────────────────────────────────────────────────────────────────────

const FLOOR_H = 10
let _floorMemo = null   // populated by buildTerrainMesh, used by computeHeight
let _boundsCache = null

function computeHeight(vx, vz, entries) {
  if (_floorMemo && _boundsCache) {
    let maxFloor = 0, bestTent = 0
    for (const [id] of entries) {
      const b = _boundsCache[id]
      if (!b || vx < b.x || vx > b.x+b.w || vz < b.z || vz > b.z+b.h) continue
      const tx = 1 - Math.abs(vx - b.cx) / (b.w / 2)
      const tz = 1 - Math.abs(vz - b.cz) / (b.h / 2)
      const tent = tx * tz
      const f = _floorMemo[id] || 1
      if (f > maxFloor || (f === maxFloor && tent > bestTent)) { maxFloor = f; bestTent = tent }
    }
    return maxFloor > 0 ? Math.min((maxFloor - 1) * FLOOR_H + bestTent * 2, 500) : 0
  }
  // fallback before first terrain build
  let count = 0, tentSum = 0
  for (const [, card] of entries) {
    const b = cardBounds(card)
    if (vx < b.x || vx > b.x+b.w || vz < b.z || vz > b.z+b.h) continue
    const tx = 1 - Math.abs(vx - b.cx) / (b.w / 2)
    const tz = 1 - Math.abs(vz - b.cz) / (b.h / 2)
    count++; tentSum += tx * tz
  }
  return Math.min((count - 1) * FLOOR_H + tentSum * 2, 500)
}

// ── terrain mesh ──────────────────────────────────────────────────────────────

function buildTerrainMesh(cards) {
  const THREE = window.AFRAME?.THREE
  if (!THREE) return null
  const entries = Object.entries(cards)

  // ── pre-compute card floors via overlap graph + DFS ──
  // directed by createdAt: older card = below, newer = on top
  // floor(card) = 1 + max(floor of cards below it)
  // chain of 45: card 33 → floor 33
  const bounds = {}
  for (const [id, card] of entries) bounds[id] = cardBounds(card)

  const parents = {}
  for (const [id] of entries) parents[id] = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, cA] = entries[i], [idB, cB] = entries[j]
      const ba = bounds[idA], bb = bounds[idB]
      if (ba.x >= bb.x+bb.w || ba.x+ba.w <= bb.x || ba.z >= bb.z+bb.h || ba.z+ba.h <= bb.z) continue
      const tA = cA.createdAt || cA.z || 0, tB = cB.createdAt || cB.z || 0
      if (tA < tB) parents[idB].push(idA)  // A below B
      else         parents[idA].push(idB)  // B below A
    }
  }
  const floorMemo = {}, visiting = new Set()
  function cardFloor(id) {
    if (id in floorMemo) return floorMemo[id]
    if (visiting.has(id)) return 1
    visiting.add(id)
    let max = 0
    for (const p of parents[id]) max = Math.max(max, cardFloor(p))
    visiting.delete(id)
    return (floorMemo[id] = max + 1)
  }
  for (const [id] of entries) cardFloor(id)

  // pre-parse colors
  const cardRGB = entries.map(([, card]) => {
    const c = new THREE.Color().setStyle(card.color || 'lemonchiffon')
    return [c.r, c.g, c.b]
  })

  const base = new THREE.PlaneGeometry(WORLD, WORLD, SEGS, SEGS)
  base.rotateX(-Math.PI / 2)
  const basePosArr = base.attributes.position.array
  const baseIdxArr = base.index.array
  const N = SEGS + 1

  // single pass: height + color together
  const heights = new Float32Array(N * N)
  const positions = [], colors = []

  for (let i = 0; i < N * N; i++) {
    const vx = basePosArr[i*3]     + WORLD / 2
    const vz = basePosArr[i*3+2]   + WORLD / 2

    let maxFloor = 0, bestTent = 0, bestJ = -1
    for (let j = 0; j < entries.length; j++) {
      const [id] = entries[j]
      const b = bounds[id]
      if (vx < b.x || vx > b.x+b.w || vz < b.z || vz > b.z+b.h) continue
      const tx = 1 - Math.abs(vx - b.cx) / (b.w / 2)
      const tz = 1 - Math.abs(vz - b.cz) / (b.h / 2)
      const tent = tx * tz
      const f = floorMemo[id]
      if (f > maxFloor || (f === maxFloor && tent > bestTent)) {
        maxFloor = f; bestTent = tent; bestJ = j
      }
    }

    const h = maxFloor > 0 ? Math.min((maxFloor - 1) * FLOOR_H + bestTent * 2, 500) : 0
    heights[i] = h
    positions.push(basePosArr[i*3], SEA + 1 + h, basePosArr[i*3+2])

    if (bestJ >= 0) {
      const t = Math.min(h / 500, 1) * 0.55
      const [cr, cg, cb] = cardRGB[bestJ]
      colors.push(cr + (1-cr)*t, cg + (1-cg)*t, cb + (1-cb)*t)
    } else {
      colors.push(0, 0.56, 1.0)
    }
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

  // cliff walls stop exactly at CLIFF_FLOOR, which is also exactly where the
  // "gold" backdrop slab's top face sits (the <a-box color="gold"> in this
  // file's a-scene template — the visible "sea floor" wherever terrain has a
  // hole, since open water gets no terrain geometry at all by design). two
  // surfaces from unrelated geometry occupying the identical Y plane is
  // textbook z-fighting — seizure-risk flicker, not a cosmetic nitpick, so
  // this gets fixed by removing the ambiguity outright: extend the wall a
  // little past the seam and into the slab's own volume. no shared plane
  // left, nothing left to fight over.
  const CLIFF_WALL_OVERLAP = 20

  for (const [k, count] of edgeMap) {
    if (count !== 1) continue
    const [a, b] = edgeMap._raw.get(k)
    for (const vi of [a, b]) {
      if (!bottomIdx.has(vi)) {
        bottomIdx.set(vi, nextIdx++)
        positions.push(positions[vi*3], CLIFF_FLOOR - CLIFF_WALL_OVERLAP, positions[vi*3+2])
        colors.push(0.24, 0.70, 0.44)  // mediumseagreen — underwater cliff wall
      }
    }
    const ba = bottomIdx.get(a), bb = bottomIdx.get(b)
    cliffIndices.push(a, ba, bb,  a, bb, b)
  }

  _floorMemo = floorMemo
  _boundsCache = bounds
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

// ── cloud platforms + labels — progressive reveal ─────────────────────────────
//
// two things "de-rez" alone didn't give: (1) a big movement-triggered refresh
// could bring a dozen platforms into range at once and pop them all in
// together — queued instead, one card revealed every REVEAL_INTERVAL_MS as
// the player actually walks, so it reads as discovery, not a batch load.
// (2) visibility is a BAND, not just a far cutoff — closer than
// NEAR_FADE_DISTANCE fades out the same way distance does, so walking up to
// or through a platform doesn't leave it filling the whole view.
//
// a box+label share one queue entry so they always appear together. exits
// (far OR near) are immediate per-card animations, not queued — only entries
// are paced, since the ask was "reveal them as I walk," not "hide them slowly."

const DEREZ_ENTER_MS      = 400
const DEREZ_EXIT_MS       = 300
const NEAR_FADE_DISTANCE  = 220   // closer than this = fades out, same as leaving far range
const REVEAL_INTERVAL_MS  = 180   // one card's box+label revealed per tick, not all at once

// dense layouts (e.g. elf-map's ring — 90 cards, ~150 units wide each, packed
// into ~63 units of circumferential spacing) pack platforms tightly enough
// that many overlap in XZ. computeHeight tends to give overlapping cards
// near-identical heights, so their coplanar top faces z-fight — the same
// flicker as the terrain/gold-slab seam, just between platforms instead of
// against the backdrop. a deterministic per-card micro-offset (hash of the
// id, not randomness — the same card always lands at the same height, so
// this can't itself introduce flicker) breaks exact coplanarity without
// meaningfully moving anything.
function microYOffset(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(hash) % 9) - 4 // -4..4 units
}
const LABEL_FADE_RATE     = 1 / (DEREZ_ENTER_MS / 1000) // opacity units/sec

let _revealQueue  = []      // card ids waiting their turn
let _revealQueued = new Set()
let _revealTimer  = 0       // ms accumulated since last drain

function withinVisibilityBand(dist, farDistance) {
  return dist > NEAR_FADE_DISTANCE && dist <= farDistance
}

// physics colliders (rebuildCloudColliders) exist for every card unconditionally,
// so a box scaling into existence at its final position — especially right
// under a player who's already standing there — reads as a teleport, not an
// arrival. rising up from below into place looks like solid ground forming,
// which is what's actually happening physics-wise the whole time anyway.
const RISE_DISTANCE = 150

function riseBoxIn(el, cloudY) {
  el.setAttribute('position', `${el.object3D.position.x} ${cloudY - RISE_DISTANCE} ${el.object3D.position.z}`)
  el.setAttribute('animation__derez', `property: position; to: ${el.object3D.position.x} ${cloudY} ${el.object3D.position.z}; dur: ${DEREZ_ENTER_MS}; easing: easeOutQuad`)
}
function sinkBoxOut(el, cloudY) {
  if (el.dataset.exiting) return
  el.dataset.exiting = 'true'
  el.setAttribute('animation__derez', `property: position; to: ${el.object3D.position.x} ${cloudY - RISE_DISTANCE} ${el.object3D.position.z}; dur: ${DEREZ_EXIT_MS}; easing: easeInQuad`)
  setTimeout(() => { if (el.isConnected && el.dataset.exiting) el.remove() }, DEREZ_EXIT_MS + 50)
}

function createCloudBox(cloudEl, id, card, b, cloudY) {
  const el = document.createElement('a-box')
  el.dataset.cardId = id
  el.setAttribute('width', b.w)
  el.setAttribute('height', 10)
  el.setAttribute('depth', b.h)
  el.setAttribute('color', card.color || 'lemonchiffon')
  el.setAttribute('position', `${b.cx} ${cloudY - RISE_DISTANCE} ${b.cz}`)
  cloudEl.appendChild(el)
  el.setAttribute('animation__derez', `property: position; to: ${b.cx} ${cloudY} ${b.cz}; dur: ${DEREZ_ENTER_MS}; easing: easeOutQuad`)
}

function createCloudLabel(group, spritesById, id, card, b, cloudY) {
  const THREE = window.AFRAME?.THREE
  const name = (card.text || '').split('\n')[0].trim()
  if (!THREE || !name) return
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.font = 'bold 52px "Recursive", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const o = 3
  const shadows = [['black',o,o],['cyan',-o,o],['magenta',-o,-o],['yellow',o,-o]]
  for (const [color, dx, dy] of shadows) {
    ctx.fillStyle = color
    ctx.fillText(name, 256 + dx, 64 + dy, 480)
  }
  ctx.fillStyle = 'white'
  ctx.fillText(name, 256, 64, 480)

  const texture = new THREE.CanvasTexture(canvas)
  // depthWrite:false relies entirely on the renderer's per-frame transparent
  // sort to draw far labels before near ones — when that sort doesn't happen
  // reliably (multiple labels, multiple boxes, all sharing one THREE.Group),
  // draw order wins instead of distance and far labels paint over near ones.
  // alphaTest + depthWrite:true sidesteps the whole problem: each sprite
  // writes its own depth per-pixel, only where the text itself is opaque
  // (the transparent canvas margin around it never touches the depth
  // buffer), so occlusion is correct regardless of what order things drew in.
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: true, alphaTest: 0.1, opacity: 0 })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(320, 80, 1)
  sprite.position.set(b.cx, cloudY + 90, b.cz)
  sprite.raycast = () => {}
  sprite.userData.fadeState = 'in' // updateLabelFades() ramps opacity 0->1
  group.add(sprite)
  spritesById[id] = sprite
}

function getOrCreateLabelGroup(labelsEl) {
  const THREE = window.AFRAME?.THREE
  if (!THREE) return null
  let group = labelsEl.getObject3D('labels')
  if (!group) {
    group = new THREE.Group()
    group.userData.spritesById = {}
    labelsEl.setObject3D('labels', group)
  }
  return group
}

// walks every card once, deciding per-id whether to update/exit/enqueue —
// existing boxes+labels get patched in place, cards newly in-band get queued
// (not created immediately), cards leaving the band exit right away.
function updateCloudVisibility(target, cards, playerPos, renderDistance) {
  const cloudEl = target.querySelector('.cloud-platforms')
  const labelsEl = target.querySelector('.cloud-labels')
  if (!cloudEl || !labelsEl) return
  const group = getOrCreateLabelGroup(labelsEl)
  const spritesById = group?.userData.spritesById || {}
  const entries = Object.entries(cards)

  for (const [id, card] of entries) {
    const b = cardBounds(card)
    const dist = playerPos ? Math.hypot(b.cx - playerPos.x, b.cz - playerPos.z) : 0
    // boxes are physical ground — rebuildCloudColliders builds a collider for
    // every card regardless of visibility, so de-rezzing the box a player is
    // standing on/near would leave them floating on invisible ground. boxes
    // only respect the far cutoff; labels get the full near+far band.
    const boxWithin = !renderDistance || dist <= renderDistance.cloud
    const labelWithin = !renderDistance || withinVisibilityBand(dist, renderDistance.cloud)
    const boxEl = cloudEl.querySelector(`a-box[data-card-id="${id}"]`)
    const sprite = spritesById[id]
    const h = computeHeight(b.cx, b.cz, entries)
    const cloudY = CLOUD + h + microYOffset(id)

    if (boxWithin) {
      if (boxEl) {
        boxEl.setAttribute('position', `${b.cx} ${cloudY} ${b.cz}`)
        if (boxEl.dataset.exiting) { delete boxEl.dataset.exiting; riseBoxIn(boxEl, cloudY) }
      } else if (!_revealQueued.has(id)) {
        _revealQueue.push(id)
        _revealQueued.add(id)
      }
    } else {
      if (_revealQueued.has(id)) {
        _revealQueue = _revealQueue.filter(qid => qid !== id)
        _revealQueued.delete(id)
      }
      if (boxEl) sinkBoxOut(boxEl, cloudY)
    }

    if (sprite) {
      sprite.position.set(b.cx, cloudY + 90, b.cz)
      sprite.userData.fadeState = labelWithin ? 'in' : 'out'
    } else if (labelWithin && group) {
      // sprites are fully destroyed once their fade-out reaches 0 opacity
      // (updateLabelFades), not just hidden — without this, a label that
      // faded out from a de-rez never comes back once the player returns.
      // no queue needed here: label creation already fades in via opacity
      // (createCloudLabel starts at 0), so it's smooth without staggering,
      // and its narrower near+far band means it's rarely ahead of the box's
      // own (wider) reveal anyway.
      createCloudLabel(group, spritesById, id, card, b, cloudY)
    }
  }

  cloudEl.querySelectorAll('a-box[data-card-id]').forEach(el => {
    if (!(el.dataset.cardId in cards)) el.remove()
  })
  for (const id of Object.keys(spritesById)) {
    if (!(id in cards)) spritesById[id].userData.fadeState = 'out'
  }
}

// drains one card off the reveal queue every REVEAL_INTERVAL_MS — called from
// physicsLoop every frame, only actually does anything on its own cadence.
// picks the best queued card to reveal next: closest to the player and most
// aligned with where the camera is actually facing, recomputed each drain
// tick (not a fixed FIFO order) since the player keeps moving/turning while
// things wait their turn.
function pickNextReveal(target, cards) {
  const playerPos = _lastPlayerPos
  const cam = target.querySelector('[camera]')
  const yaw = cam?.object3D?.rotation.y ?? 0
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw)

  let bestIdx = -1, bestScore = -Infinity
  for (let i = 0; i < _revealQueue.length; i++) {
    const card = cards[_revealQueue[i]]
    if (!card) continue
    const b = cardBounds(card)
    const dx = b.cx - playerPos.x, dz = b.cz - playerPos.z
    const dist = Math.hypot(dx, dz) || 1
    const facing = (dx / dist) * fwdX + (dz / dist) * fwdZ // 1 = dead ahead, -1 = behind
    const score = facing * 2000 - dist // facing dominates, distance breaks ties
    if (score > bestScore) { bestScore = score; bestIdx = i }
  }
  return bestIdx
}

function driveRevealQueue(target, cards, dt) {
  if (!_revealQueue.length) { _revealTimer = 0; return }
  _revealTimer += dt * 1000
  if (_revealTimer < REVEAL_INTERVAL_MS) return
  _revealTimer = 0

  const idx = pickNextReveal(target, cards)
  if (idx === -1) { _revealQueue = []; _revealQueued.clear(); return } // everything queued was deleted
  const id = _revealQueue.splice(idx, 1)[0]
  _revealQueued.delete(id)
  const card = cards[id]
  if (!card) return // card was deleted while queued

  const cloudEl = target.querySelector('.cloud-platforms')
  const labelsEl = target.querySelector('.cloud-labels')
  const entries = Object.entries(cards)
  const b = cardBounds(card)
  const cloudY = CLOUD + computeHeight(b.cx, b.cz, entries) + microYOffset(id)

  if (cloudEl && !cloudEl.querySelector(`a-box[data-card-id="${id}"]`)) {
    createCloudBox(cloudEl, id, card, b, cloudY)
  }
  if (labelsEl) {
    const group = getOrCreateLabelGroup(labelsEl)
    if (group && !group.userData.spritesById[id]) {
      createCloudLabel(group, group.userData.spritesById, id, card, b, cloudY)
    }
  }
}

function updateLabelFades(target, dt) {
  const labelsEl = target.querySelector('.cloud-labels')
  const group = labelsEl?.getObject3D?.('labels')
  if (!group) return
  const spritesById = group.userData.spritesById
  for (const [id, sprite] of Object.entries(spritesById)) {
    const mat = sprite.material
    if (sprite.userData.fadeState === 'in' && mat.opacity < 1) {
      mat.opacity = Math.min(1, mat.opacity + LABEL_FADE_RATE * dt)
    } else if (sprite.userData.fadeState === 'out') {
      mat.opacity = Math.max(0, mat.opacity - LABEL_FADE_RATE * dt)
      if (mat.opacity === 0) {
        group.remove(sprite)
        mat.map?.dispose()
        mat.dispose()
        delete spritesById[id]
      }
    }
  }
}

// rebuild cloud platforms + labels for the current cards/player position.
// shared by the data-change path (afterUpdate) and the movement-triggered
// path (physicsLoop) so de-rezzing/re-rezzing as the player walks around
// doesn't wait for the next unrelated card edit to happen to re-render.
// terrain/land is still a single global mesh (computeHeight scans every card,
// not chunkable without a much bigger rewrite — see the follow-up note in the
// commit history), so it can't be de-rezzed the way boxes/labels are. fog
// hides it visually instead: fade to the sky color starting halfway to the
// same cloud cutoff, fully opaque right at it, so land fades out of sight at
// the exact distance things actually stop existing — no visible seam between
// "gone" and "still there but abruptly clipped."
function applyWorldFog(target, renderDistance) {
  if (!target || !renderDistance || target._underwater) return
  const scene = target.querySelector('a-scene')
  if (!scene) return
  const near = (renderDistance.cloud * 0.5) | 0
  const far  = renderDistance.cloud | 0
  scene.setAttribute('fog', `type: linear; color: dodgerblue; near: ${near}; far: ${far}`)
}

function refreshClouds(target, cards, playerPos) {
  const renderDistance = computeLayoutRenderDistance(cards)
  _lastRenderDistance = renderDistance
  applyWorldFog(target, renderDistance)
  updateCloudVisibility(target, cards, playerPos, renderDistance)
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
  const matchIds = []
  for (const [id, card] of Object.entries(cards)) {
    const b = cardBounds(card)
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.z >= b.z && pt.z <= b.z + b.h) matchIds.push(id)
  }
  _selectedCardId = matchIds[0] || null
  updateCardHud(matchIds)
}

function updateCardHud(cardIds = []) {
  window.dispatchEvent(new CustomEvent('park:inspector', { detail: { cardId: _selectedCardId || null, cardIds } }))
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
  for (const [id, card] of entries) {
    const b  = cardBounds(card)
    const h  = computeHeight(b.cx, b.cz, entries)
    // must match the microYOffset applied to the visual box's Y, or the
    // collider and what the player sees drift apart by a few units
    const cy = CLOUD + h + microYOffset(id)
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

function rebuildTerrainCollider(world) {
  if (!_terrainGeoData) return
  const w = world || _phys?.world
  if (!w) return

  if (_phys?.terrainCollider) w.removeCollider(_phys.terrainCollider, false)
  if (_phys?.terrainBody)     w.removeRigidBody(_phys.terrainBody)

  const { positions: lp, indices } = _terrainGeoData
  const verts = new Float32Array(lp.length)
  for (let i = 0; i < lp.length; i += 3) {
    verts[i]   = lp[i]   + WORLD / 2
    verts[i+1] = lp[i+1]
    verts[i+2] = lp[i+2] + WORLD / 2
  }
  const terrainBody     = w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const terrainCollider = w.createCollider(RAPIER.ColliderDesc.trimesh(verts, indices), terrainBody)

  if (_phys) { _phys.terrainBody = terrainBody; _phys.terrainCollider = terrainCollider }
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

  // terrain trimesh — stored on _phys so rebuildTerrainCollider can swap it
  _phys = { world, body: null, collider: null, ctrl: null, terrainBody: null, terrainCollider: null }
  rebuildTerrainCollider(world)

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
  ctrl.enableAutostep(35, 5, false)
  ctrl.enableSnapToGround(35)

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

  Object.assign(_phys, { body, collider, ctrl })
  _physVel = { x: 0, y: 0, z: 0 }
  _physLastT = performance.now()

  linkState(tag, _boardId)  // join same geckos room as bulletin-board

  const { cards } = $.learn()
  rebuildCloudColliders(cards)

  requestAnimationFrame(physicsLoop)
}

function physicsLoop(now) {
  if (!_phys || !_physTarget) { requestAnimationFrame(physicsLoop); return }
  if (_physTarget.style.display === 'none') { requestAnimationFrame(physicsLoop); return }

  const dt = Math.min((now - _physLastT) / 1000, 0.033)
  _physLastT = now

  const { world, body, collider, ctrl } = _phys
  const pos = body.translation()
  _lastPlayerPos = pos

  updateLabelFades(_physTarget, dt)
  driveRevealQueue(_physTarget, $.learn().cards, dt)

  // re-cull cloud platforms/labels as the player moves, not just when card
  // data changes — otherwise walking toward a distant island never re-rezzes
  // it until someone happens to edit a card
  if (!_lastCloudBuildPos || Math.hypot(pos.x - _lastCloudBuildPos.x, pos.z - _lastCloudBuildPos.z) > CLOUD_REBUILD_MOVE_THRESHOLD) {
    const { cards } = $.learn()
    if (Object.keys(cards).length > 0) {
      refreshClouds(_physTarget, cards, pos)
      _lastCloudBuildPos = { x: pos.x, y: pos.y, z: pos.z }
    }
  }

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

  // right stick → camera look (into look-controls' internal objects), Y inverted
  const rs_x = checkAxis(0, 2) || 0, rs_y = checkAxis(0, 3) || 0
  const rsActive = Math.abs(rs_x) > 0.1 || Math.abs(rs_y) > 0.1
  if (rsActive) {
    const lc = cam?.components?.['look-controls']
    if (lc) {
      lc.yawObject.rotation.y   -= rs_x * 2.2 * dt
      lc.pitchObject.rotation.x += rs_y * 2.2 * dt  // inverted: + not -
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

  // gamepad button logic
  let anyBtnPressed = false
  let aBtnPressed = false
  for (let b = 0; b < 16; b++) {
    const v = checkButton(0, b) || 0
    const fresh = v > 0.5 && !(_btnPrev[b] > 0.5)
    if (fresh) { anyBtnPressed = true; if (b === 0) aBtnPressed = true }
    _btnPrev[b] = v
  }
  if (_islandPanelOpen) {
    if (anyBtnPressed) window.dispatchEvent(new CustomEvent('park:close-island'))
  } else {
    // raycast every frame while right stick is moving; throttle to ~10fps otherwise
    if (rsActive) {
      doInspect()
    } else {
      _inspectTick = (_inspectTick || 0) + dt
      if (_inspectTick > 0.1) { _inspectTick = 0; doInspect() }
    }
    if (aBtnPressed && _selectedCardId) window.dispatchEvent(new CustomEvent('park:manage-island', { detail: { cardId: _selectedCardId } }))
  }

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
        // background never got reset back on surfacing — stuck at underwater
        // navy forever after the first dive. whatever's beyond the sky
        // sphere (fog: false, so distance/de-rez don't touch it) or beyond
        // fog's own far distance shows this background raw, so it needs to
        // match dodgerblue too, not just the initial scene attribute.
        scene.setAttribute('background', 'color: dodgerblue')
        applyWorldFog(_physTarget, _lastRenderDistance)
      }
    }
  }

  // broadcast position ~10fps via plan98 geckos kernel
  _broadcastT += dt
  if (_broadcastT >= 0.1) {
    _broadcastT = 0
    broadcastElf(tag, { players: { [PLAN98_NODE_ID]: { x: nx, y: ny, z: nz, ts: Date.now() } } }, PLAYERS_MERGE)
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
    <a-scene embedded vr-mode-ui="enabled: false" background="color: dodgerblue"
             renderer="shadowMapEnabled: true; shadowMapType: pcfsoft; alpha: false">
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
      <!-- side: front (not double) — this box is solid and world-spanning, and
           gameplay/physics keeps the player's camera inside its own Y range
           (2000-2500, same span as SEA_FLOOR_Y/the tunnel edge lines) most of
           the time while swimming. double-sided rendering of a box you're
           standing inside of means both interior walls fight for render
           order around the camera every frame — a whole-screen flicker, not
           a cosmetic one. front-side only renders the outward-facing surface
           (correctly visible looking down at it from above/through a
           terrain hole, correctly absent — not fighting itself — from
           inside it). -->
      <a-box position="${WH} 2250 ${WH}" width="${W}" height="500" depth="${W}"
             material="color: dodgerblue; opacity: 0.55; transparent: true; side: front"
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
      <a-entity class="cloud-labels"></a-entity>
      <a-entity class="players"></a-entity>
    </a-scene>
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
      rebuildTerrainCollider()
    }

    const tunnelsEl = target.querySelector('.tunnels')
    if (tunnelsEl) {
      const old = tunnelsEl.getObject3D?.('tunnels')
      if (old) old.traverse(c => { c.geometry?.dispose(); c.material?.dispose() })
      const tg = buildTunnelMesh(cards, edgeTypes)
      if (tg) tunnelsEl.setObject3D('tunnels', tg)
    }

    rebuildCloudColliders(cards)
    refreshClouds(target, cards, _lastPlayerPos)
    _lastCloudBuildPos = { ..._lastPlayerPos }

    if (!target._spawned && Object.keys(cards).length > 0) {
      target._spawned = true
      spawnAtCenterIsland(target, cards)
    }
  }
})

$.style(`
  & { display: block; width: 100%; height: 100%; position: relative; }
  & a-scene { width: 100% !important; height: 100% !important; display: block; }

`)

