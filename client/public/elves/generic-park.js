import { Self } from '@plan98/types'
import 'aframe'

const tag = 'generic-park'
const $ = Self(tag, { cards: {} })

window.addEventListener('park:cards', e => {
  $.teach({ cards: e.detail.cards || {} })
})

window.dispatchEvent(new CustomEvent('park:ready'))

// ── clusters ──────────────────────────────────────────────────────────────────

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y
}

function findClusters(cards) {
  const entries = Object.entries(cards)
  const visited = new Set()
  const clusters = []
  for (const [id, card] of entries) {
    if (visited.has(id)) continue
    const cluster = []
    const queue = [[id, card]]
    while (queue.length) {
      const [cid, cc] = queue.shift()
      if (visited.has(cid)) continue
      visited.add(cid)
      cluster.push([cid, cc])
      for (const [oid, oc] of entries) {
        if (!visited.has(oid) && overlaps(cc, oc)) queue.push([oid, oc])
      }
    }
    clusters.push(cluster)
  }
  return clusters
}

// ── terrain ───────────────────────────────────────────────────────────────────

function hillColor(h) {
  if (h > 400) return 'dimgray'
  if (h > 250) return 'saddlebrown'
  if (h > 100) return 'forestgreen'
  return 'mediumseagreen'
}

function renderIslands(cards) {
  return findClusters(cards).map(cluster => {
    const count = cluster.length
    const hillH = count * 10          // 10 units per card, 500 max = cloud base
    const cloudY = 3000 + hillH       // cloud rides 500 above hill top

    // bounding box of cluster footprint
    const xs = cluster.flatMap(([, c]) => [c.x, c.x + c.w])
    const zs = cluster.flatMap(([, c]) => [c.y, c.y + c.h])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    const bw = maxX - minX, bd = maxZ - minZ
    const cx = minX + bw / 2, cz = minZ + bd / 2

    const ground = `
      <a-box position="${cx} ${2500 + hillH / 2} ${cz}"
             width="${Math.max(bw, 20)}" height="${Math.max(hillH, 4)}" depth="${Math.max(bd, 20)}"
             color="${hillColor(hillH)}"></a-box>
    `

    const clouds = cluster.map(([, card]) => {
      const nx = card.x + card.w / 2
      const nz = card.y + card.h / 2
      const color = card.color || 'lemonchiffon'
      return `<a-box position="${nx} ${cloudY} ${nz}"
                     width="${card.w}" height="10" depth="${card.h}"
                     color="${color}"></a-box>`
    }).join('')

    return ground + clouds
  }).join('')
}

// ── world container — 5-sided open-top box ────────────────────────────────────

function renderPerimeter() {
  const c = 'mediumpurple'
  // walls go from y=0 up to skyline/cloud level (y=3000), height=3000, center y=1500
  // bottom floor sits below lava
  return `
    <a-box position="2500 1500 -100"  width="5400" height="3000" depth="200"  color="${c}"></a-box>
    <a-box position="2500 1500 5100"  width="5400" height="3000" depth="200"  color="${c}"></a-box>
    <a-box position="-100 1500 2500"  width="200"  height="3000" depth="5400" color="${c}"></a-box>
    <a-box position="5100 1500 2500"  width="200"  height="3000" depth="5400" color="${c}"></a-box>
    <a-box position="2500 -100 2500"  width="5400" height="200"  depth="5400" color="${c}"></a-box>
  `
}

// ── spawn ─────────────────────────────────────────────────────────────────────

function spawnAtCenterIsland(target, cards) {
  const entries = Object.entries(cards)
  const WC = 2500
  let spawnX = WC, spawnZ = WC, spawnY = 2600

  if (entries.length > 0) {
    // find card whose center is closest to world center (2500, 2500)
    let closest = null, minDist = Infinity
    for (const [, card] of entries) {
      const cx = card.x + card.w / 2
      const cz = card.y + card.h / 2
      const dist = Math.hypot(cx - WC, cz - WC)
      if (dist < minDist) { minDist = dist; closest = card }
    }
    if (closest) {
      const cluster = findClusters(cards).find(c => c.some(([, c2]) => c2 === closest))
      const hillH = (cluster?.length || 1) * 10
      const cloudY = 3000 + hillH
      spawnX = closest.x + closest.w / 2
      spawnZ = closest.y + closest.h / 2
      spawnY = 2600             // sea level — look up at the cloud platforms
    }
  }

  const cam = target.querySelector('[camera]')
  if (cam) cam.setAttribute('position', `${spawnX} ${spawnY} ${spawnZ}`)
}

// ── scene ─────────────────────────────────────────────────────────────────────

$.draw(target => {
  if (target._parkMounted) return
  target._parkMounted = true
  return `
    <a-scene embedded vr-mode-ui="enabled: false" background="color: black">
      <a-entity camera wasd-controls="acceleration:2000" look-controls
                position="2500 2600 2500"
                rotation="-10 0 0">
        <a-cursor color="white" opacity="0.4" fuse="false"></a-cursor>
      </a-entity>

<!-- ambient brightens at day, dims at night — in sync with sun orbit -->
      <a-light type="ambient" color="darkorange" intensity="2.2"
               animation="property: intensity; from: 2.2; to: 0.1;
                          dur: 30000; loop: true; dir: alternate;
                          easing: easeInOutSine"></a-light>

      <!-- base night fill so world is never fully black -->
      <a-light type="ambient" color="#111133" intensity="0.6"></a-light>

      <!-- sun: vertical orbit — sphere is purely visual, no light bleed -->
      <a-entity position="2500 2500 2500"
                animation="property: rotation; from: 0 0 0; to: 0 0 -360;
                           dur: 60000; loop: true; easing: linear">
        <a-sphere position="0 9000 0" radius="220"
                  material="color: darkorange; shader: flat"></a-sphere>
      </a-entity>

      <!-- mediumpurple emanates from the mountains (ground hemisphere) -->
      <a-light type="hemisphere" color="darkorange"
               ground-color="mediumpurple" intensity="0.4"></a-light>

      <!-- world layers -->
      <a-box position="2500 500 2500"   width="5000" height="1000" depth="5000" color="firebrick"></a-box>
      <a-box position="2500 1500 2500"  width="5000" height="1000" depth="5000" color="gold"></a-box>
      <a-box position="2500 2250 2500"  width="5000" height="500"  depth="5000"
             color="dodgerblue" opacity="0.72" transparent="true"></a-box>

      <!-- perimeter collision walls -->
      <a-entity class="perimeter">${renderPerimeter()}</a-entity>

      <!-- card terrain + cloud platforms (reactive) -->
      <a-entity class="card-islands"></a-entity>
    </a-scene>
  `
}, {
  afterUpdate(target) {
    const islands = target.querySelector('.card-islands')
    if (!islands) return
    const { cards } = $.learn()
    islands.innerHTML = renderIslands(cards)
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
