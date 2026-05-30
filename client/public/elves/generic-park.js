import { Self } from '@plan98/types'
import 'aframe'

const tag = 'generic-park'
const $ = Self(tag, { cards: {} })

window.addEventListener('park:cards', e => {
  $.teach({ cards: e.detail.cards || {} })
})

function computeIslandY(id, card, allCards) {
  let overlaps = 0
  for (const [otherId, other] of Object.entries(allCards)) {
    if (otherId === id) continue
    const xOverlap = card.x < other.x + other.w && card.x + card.w > other.x
    const yOverlap = card.y < other.y + other.h && card.y + card.h > other.y
    if (xOverlap && yOverlap) overlaps++
  }
  return 2500 + overlaps * 60
}

function renderIslands(cards) {
  return Object.entries(cards).map(([id, card]) => {
    const cx = card.x + card.w / 2
    const cz = card.y + card.h / 2
    const wy = computeIslandY(id, card, cards)
    const color = card.color || 'lemonchiffon'
    const cw = card.w
    const cd = card.h
    return `
      <a-box position="${cx} ${wy + 20} ${cz}"
             width="${cw}" height="40" depth="${cd}"
             color="${color}"></a-box>
      <a-box position="${cx} ${wy + 51} ${cz}"
             width="${cw + 24}" height="22" depth="${cd + 24}"
             color="mediumseagreen"></a-box>
    `
  }).join('')
}

$.draw(target => {
  if (target._parkMounted) return
  target._parkMounted = true
  return `
    <a-scene embedded vr-mode-ui="enabled: false">
      <a-entity camera wasd-controls="acceleration:2000" look-controls
                position="2500 2600 2500"
                rotation="-10 0 0">
        <a-cursor color="white" opacity="0.4" fuse="false"></a-cursor>
      </a-entity>

      <!-- lava: 0–999 -->
      <a-box position="2500 500 2500"
             width="5000" height="1000" depth="5000"
             color="firebrick"></a-box>

      <!-- sand: 1000–1999 -->
      <a-box position="2500 1500 2500"
             width="5000" height="1000" depth="5000"
             color="gold"></a-box>

      <!-- water: 2000–2499 -->
      <a-box position="2500 2250 2500"
             width="5000" height="500" depth="5000"
             color="dodgerblue"
             opacity="0.72"
             transparent="true"></a-box>

      <a-entity class="card-islands"></a-entity>
    </a-scene>
  `
}, {
  afterUpdate(target) {
    const islands = target.querySelector('.card-islands')
    if (!islands) return
    const { cards } = $.learn()
    islands.innerHTML = renderIslands(cards)
  }
})

$.style(`
  & {
    display: block;
    width: 100%;
    height: 100%;
  }

  & a-scene {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }
`)
