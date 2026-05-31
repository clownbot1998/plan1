import { Self } from '@plan98/types'
import 'aframe'

const tag = 'generic-park'
const $ = Self(tag, { cards: {} })

window.addEventListener('park:cards', e => {
  $.teach({ cards: e.detail.cards || {} })
})
window.dispatchEvent(new CustomEvent('park:ready'))

// ── height ────────────────────────────────────────────────────────────────────

const SEGS = 200          // 200×200 = 40k verts, smooth + fast
const WORLD = 5000
const SEA   = 2500
const CLOUD = 3000

// tent function: max at card center, 0 at card edges, 0 outside
function computeHeight(vx, vz, entries) {
  let h = 0
  for (const [, card] of entries) {
    if (vx < card.x || vx > card.x + card.w) continue
    if (vz < card.y || vz > card.y + card.h) continue
    const tx = 1 - Math.abs(vx - (card.x + card.w / 2)) / (card.w / 2)
    const tz = 1 - Math.abs(vz - (card.y + card.h / 2)) / (card.h / 2)
    h += 30 * tx * tz
  }
  return Math.min(h, 500)
}

function elevColor(e) {
  if (e > 400) return [0.75, 0.75, 0.75]
  if (e > 250) return [0.55, 0.27, 0.07]
  if (e > 100) return [0.13, 0.55, 0.13]
  if (e > 0)   return [0.24, 0.70, 0.44]
  return [0.00, 0.56, 1.00]
}

// ── terrain mesh ──────────────────────────────────────────────────────────────

function buildTerrainMesh(cards) {
  const THREE = window.AFRAME?.THREE
  if (!THREE) return null
  const entries = Object.entries(cards)

  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEGS, SEGS)
  geo.rotateX(-Math.PI / 2)

  const pos     = geo.attributes.position
  const colors  = new Float32Array(pos.count * 3)
  const heights = new Float32Array(pos.count)

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + WORLD / 2
    const vz = pos.getZ(i) + WORLD / 2
    const h  = computeHeight(vx, vz, entries)
    heights[i] = h
    pos.setY(i, SEA + 1 + h)  // +1 lifts floor above water top → no Z-fighting
    const [r, g, b] = elevColor(h)
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
  }

  // only render triangles where at least one vertex is elevated
  // — punches holes at sea level so water box shows through
  const src = geo.index.array
  const kept = []
  for (let i = 0; i < src.length; i += 3) {
    if (heights[src[i]] > 0 || heights[src[i+1]] > 0 || heights[src[i+2]] > 0) {
      kept.push(src[i], src[i+1], src[i+2])
    }
  }
  geo.setIndex(kept)

  pos.needsUpdate = true
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
  }))
  mesh.position.set(WORLD / 2, 0, WORLD / 2)
  return mesh
}

// ── cloud platforms ───────────────────────────────────────────────────────────

function renderCloudPlatforms(cards) {
  const entries = Object.entries(cards)
  return entries.map(([, card]) => {
    const cx = card.x + card.w / 2
    const cz = card.y + card.h / 2
    const h  = computeHeight(cx, cz, entries)
    const cloudY = CLOUD + h
    const color = card.color || 'lemonchiffon'
    return `<a-box position="${cx} ${cloudY} ${cz}"
                   width="${card.w}" height="10" depth="${card.h}"
                   color="${color}"></a-box>`
  }).join('')
}

// ── spawn at centermost card, sea level ───────────────────────────────────────

function spawnAtCenterIsland(target, cards) {
  const WC = WORLD / 2
  let sx = WC, sz = WC
  let minDist = Infinity
  for (const [, card] of Object.entries(cards)) {
    const cx = card.x + card.w / 2, cz = card.y + card.h / 2
    const d = Math.hypot(cx - WC, cz - WC)
    if (d < minDist) { minDist = d; sx = cx; sz = cz }
  }
  const cam = target.querySelector('[camera]')
  if (cam) cam.setAttribute('position', `${sx} ${SEA + 100} ${sz}`)
}

// ── perimeter ─────────────────────────────────────────────────────────────────

function renderPerimeter() {
  const c = 'mediumpurple', h = CLOUD, y = h / 2
  return `
    <a-box position="2500 ${y} -100"  width="5400" height="${h}" depth="200"  color="${c}"></a-box>
    <a-box position="2500 ${y} 5100"  width="5400" height="${h}" depth="200"  color="${c}"></a-box>
    <a-box position="-100 ${y} 2500"  width="200"  height="${h}" depth="5400" color="${c}"></a-box>
    <a-box position="5100 ${y} 2500"  width="200"  height="${h}" depth="5400" color="${c}"></a-box>
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
    const json = JSON.stringify(cards)
    if (json === target._lastCards) return
    target._lastCards = json

    const terrainEl = target.querySelector('.terrain-mesh')
    if (terrainEl) {
      const old = terrainEl.getObject3D?.('terrain')
      if (old) { old.geometry.dispose(); old.material.dispose() }
      const mesh = buildTerrainMesh(cards)
      if (mesh) terrainEl.setObject3D('terrain', mesh)
    }

    const cloudEl = target.querySelector('.cloud-platforms')
    if (cloudEl) cloudEl.innerHTML = renderCloudPlatforms(cards)

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
