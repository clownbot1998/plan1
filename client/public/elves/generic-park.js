import { Self } from '@plan98/types'
import 'aframe'

const tag = 'generic-park'
const $ = Self(tag, { cards: {} })

window.addEventListener('park:cards', e => {
  $.teach({ cards: e.detail.cards || {} })
})
window.dispatchEvent(new CustomEvent('park:ready'))

// ── hex grid — level 5 in 5000×5000 world ≈ 38.6px per cell ──────────────────

const HEX = 40
const ROOT3 = Math.sqrt(3)
const HEX_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]]

function hexToWorld(q, r) {
  return [HEX * (ROOT3 * q + ROOT3 / 2 * r), HEX * (1.5 * r)]
}

function worldToHex(x, z) {
  const q = (ROOT3 / 3 * x - z / 3) / HEX
  const r = (2 / 3 * z) / HEX
  const s = -q - r
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s)
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return [rq, rr]
}

function hexKey(q, r) { return `${q},${r}` }

function cardHexNodes(card) {
  // only claim hex nodes whose world center falls inside the card's bounding box
  // — guarantees non-overlapping cards never share nodes regardless of grid size
  const corners = [
    worldToHex(card.x,          card.y),
    worldToHex(card.x + card.w, card.y),
    worldToHex(card.x,          card.y + card.h),
    worldToHex(card.x + card.w, card.y + card.h),
  ]
  const qMin = Math.min(...corners.map(c => c[0])) - 1
  const qMax = Math.max(...corners.map(c => c[0])) + 1
  const rMin = Math.min(...corners.map(c => c[1])) - 1
  const rMax = Math.max(...corners.map(c => c[1])) + 1

  const nodes = new Map()
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const [wx, wz] = hexToWorld(q, r)
      if (wx >= card.x && wx <= card.x + card.w &&
          wz >= card.y && wz <= card.y + card.h) {
        nodes.set(hexKey(q, r), [q, r])
      }
    }
  }
  // always include center
  const center = worldToHex(card.x + card.w / 2, card.y + card.h / 2)
  nodes.set(hexKey(...center), center)
  return [...nodes.values()]
}

// ── elevation map — each card contributes 10 to its 7 nodes ──────────────────

function buildElevMap(cards) {
  const map = new Map()
  for (const [, card] of Object.entries(cards)) {
    for (const [q, r] of cardHexNodes(card)) {
      const k = hexKey(q, r)
      map.set(k, (map.get(k) || 0) + 10)
    }
  }
  // minimum 20 so a single isolated card is visible above sea level
  for (const [k, v] of map) if (v < 20) map.set(k, 20)
  return map
}

// ── terrain mesh ──────────────────────────────────────────────────────────────

function elevColor(e) {
  if (e > 400) return [0.75, 0.75, 0.75]  // dimgray
  if (e > 250) return [0.55, 0.27, 0.07]  // saddlebrown
  if (e > 100) return [0.13, 0.55, 0.13]  // forestgreen
  if (e > 0)   return [0.24, 0.70, 0.44]  // mediumseagreen
  return [0.00, 0.56, 1.00]               // dodgerblue sea floor
}

function buildTerrainMesh(elevMap) {
  const THREE = window.AFRAME?.THREE
  if (!THREE || elevMap.size === 0) return null

  const positions = [], colors = [], indices = []
  const verts = new Map()

  function vertex(q, r) {
    const k = hexKey(q, r)
    if (verts.has(k)) return verts.get(k)
    const e = elevMap.get(k) || 0
    const [wx, wz] = hexToWorld(q, r)
    const idx = positions.length / 3
    positions.push(wx, 2500 + e, wz)
    colors.push(...elevColor(e))
    verts.set(k, idx)
    return idx
  }

  // Two triangles per hex — correct CCW winding (normal +Y, visible from above)
  // T1: (q,r)→(q,r+1)→(q+1,r)   T2: (q,r)→(q+1,r)→(q+1,r-1)
  // These two pairs tile the full plane without overlap or gaps
  for (const [k] of elevMap) {
    const [q, r] = k.split(',').map(Number)
    const tris = [
      [[q,r],[q,r+1],[q+1,r]],
      [[q,r],[q+1,r],[q+1,r-1]],
    ]
    for (const [[q0,r0],[q1,r1],[q2,r2]] of tris) {
      // include fringe triangles (slope to sea) if any vertex is elevated
      if (elevMap.has(hexKey(q0,r0)) || elevMap.has(hexKey(q1,r1)) || elevMap.has(hexKey(q2,r2))) {
        indices.push(vertex(q0,r0), vertex(q1,r1), vertex(q2,r2))
      }
    }
  }

  if (indices.length === 0) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(colors), 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()

  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    side: THREE.DoubleSide,
  }))
}

// ── cloud platforms (sticky notes float 500 above terrain peak) ───────────────

function renderCloudPlatforms(cards, elevMap) {
  return Object.entries(cards).map(([, card]) => {
    const [q, r] = worldToHex(card.x + card.w / 2, card.y + card.h / 2)
    const elev = elevMap.get(hexKey(q, r)) || 0
    const cloudY = 3000 + elev
    const cx = card.x + card.w / 2
    const cz = card.y + card.h / 2
    const color = card.color || 'lemonchiffon'
    return `<a-box position="${cx} ${cloudY} ${cz}"
                   width="${card.w}" height="10" depth="${card.h}"
                   color="${color}"></a-box>`
  }).join('')
}

// ── spawn at centermost card, sea level ───────────────────────────────────────

function spawnAtCenterIsland(target, cards) {
  const WC = 2500
  let spawnX = WC, spawnZ = WC

  const entries = Object.entries(cards)
  if (entries.length > 0) {
    let closest = null, minDist = Infinity
    for (const [, card] of entries) {
      const cx = card.x + card.w / 2, cz = card.y + card.h / 2
      const d = Math.hypot(cx - WC, cz - WC)
      if (d < minDist) { minDist = d; closest = card }
    }
    if (closest) {
      spawnX = closest.x + closest.w / 2
      spawnZ = closest.y + closest.h / 2
    }
  }

  const cam = target.querySelector('[camera]')
  if (cam) cam.setAttribute('position', `${spawnX} 2600 ${spawnZ}`)
}

// ── perimeter — 5-sided open-top container ────────────────────────────────────

function renderPerimeter() {
  const c = 'mediumpurple'
  return `
    <a-box position="2500 1500 -100"  width="5400" height="3000" depth="200"  color="${c}"></a-box>
    <a-box position="2500 1500 5100"  width="5400" height="3000" depth="200"  color="${c}"></a-box>
    <a-box position="-100 1500 2500"  width="200"  height="3000" depth="5400" color="${c}"></a-box>
    <a-box position="5100 1500 2500"  width="200"  height="3000" depth="5400" color="${c}"></a-box>
    <a-box position="2500 -100 2500"  width="5400" height="200"  depth="5400" color="${c}"></a-box>
  `
}

// ── scene ─────────────────────────────────────────────────────────────────────

$.draw(target => {
  if (target._parkMounted) return
  target._parkMounted = true
  return `
    <a-scene embedded vr-mode-ui="enabled: false" background="color: black">
      <a-entity camera wasd-controls="acceleration:2000" look-controls
                position="2500 2600 2500" rotation="-10 0 0">
        <a-cursor color="white" opacity="0.4" fuse="false"></a-cursor>
      </a-entity>

      <a-light type="ambient" color="darkorange" intensity="2.2"
               animation="property: intensity; from: 2.2; to: 0.1;
                          dur: 30000; loop: true; dir: alternate;
                          easing: easeInOutSine"></a-light>
      <a-light type="ambient" color="#111133" intensity="0.6"></a-light>

      <a-entity position="2500 2500 2500"
                animation="property: rotation; from: 0 0 0; to: 0 0 -360;
                           dur: 60000; loop: true; easing: linear">
        <a-sphere position="0 9000 0" radius="220"
                  material="color: darkorange; shader: flat"></a-sphere>
      </a-entity>

      <a-light type="hemisphere" color="darkorange"
               ground-color="mediumpurple" intensity="0.4"></a-light>

      <a-box position="2500 500 2500"  width="5000" height="1000" depth="5000" color="firebrick"></a-box>
      <a-box position="2500 1500 2500" width="5000" height="1000" depth="5000" color="gold"></a-box>
      <a-box position="2500 2250 2500" width="5000" height="500"  depth="5000"
             color="dodgerblue" opacity="0.72" transparent="true"></a-box>

      <a-entity class="perimeter">${renderPerimeter()}</a-entity>
      <a-entity class="terrain-mesh"></a-entity>
      <a-entity class="cloud-platforms"></a-entity>
    </a-scene>
  `
}, {
  afterUpdate(target) {
    const { cards } = $.learn()

    const elevMap = buildElevMap(cards)

    // hex terrain mesh
    const terrainEl = target.querySelector('.terrain-mesh')
    if (terrainEl) {
      const old = terrainEl.getObject3D?.('terrain')
      if (old) { old.geometry.dispose(); old.material.dispose() }
      const mesh = buildTerrainMesh(elevMap)
      if (mesh) terrainEl.setObject3D('terrain', mesh)
      else terrainEl.removeObject3D?.('terrain')
    }

    // cloud platforms
    const cloudEl = target.querySelector('.cloud-platforms')
    if (cloudEl) cloudEl.innerHTML = renderCloudPlatforms(cards, elevMap)

    // spawn on first card load
    if (!target._spawned && Object.keys(cards).length > 0) {
      target._spawned = true
      spawnAtCenterIsland(target, cards)
    }
  }
})

$.style(`
  & { display: block; width: 100%; height: 100%; }
  & a-scene { width: 100% !important; height: 100% !important; display: block; }
`)
