// Bulletin Board — collaborative sticky note canvas
//
// DESIGN INTENT:
// A minimal shared desktop stripped of traditional chrome. Just sticky notes,
// links between them, and space to think. No toolbars, no file trees.
//
// CARDS: positioned notes with text, color, and an optional saga reference.
// Each card is a discrete capability object — when CapTP/Syrup arrives, card
// IDs become capability references and operations become method invocations.
//
// LINKS: bidirectional. We are team Ted and Xanadu, as Vonnegut foretold
// through West Barnstable. The source card owns the full link record
// { from, to, fromDir, toDir }. The target card holds a backlinks index
// { [linkId]: fromCardId }. The graph is traversable in both directions
// without a full scan.
//
// DATA MODEL:
// cards: {
//   [id]: {
//     x, y, w, h,  — canvas position and size
//     text,          — note content
//     color,         — card background color
//     saga,          — optional saga URL/path
//     createdAt,     — timestamp for chronological daydream traversal
//     links: {       — outbound links (source owns full record)
//       [linkId]: { from, to, fromDir, toDir }
//     },
//     backlinks: {   — inbound link index (target holds ref only)
//       [linkId]: fromCardId
//     }
//   }
// }
//
// MODES (compass menu, flower-panel style like flip-book):
//   pan      — drag the canvas (default)
//   create   — drag to draw a rubber-band rectangle → spawns a card
//   link     — click source card then target to draw a bidirectional arrow
//   edit     — click a card body to edit inline
//   daydream — screensaver: traverses card relationships chronologically
//
// Cards are always draggable via their title bar (like door-man trays).
// No mode switch needed to move a card.
//
// COLLABORATION: braid+WAS. Local-first, persists across sessions.
// Networked operations mirror CapTP directed-message pattern.
//
// FUTURE LAYERS: Syrup serialization, CapTP method dispatch, OCapN refs.

import { Self } from '@plan98/types'
import * as braid from 'braid-http'
import { showModal, hideModal } from '@plan98/modal'

self.braid_fetch = braid.fetch

const tag = 'bulletin-board'
const HYPER_ID = 'hyper'
const DIRS = ['N','S','E','W','NE','NW','SE','SW']

let _lastRenderSig = null
let _arrowInterval = null
let _smoothArrowX = 0
let _smoothArrowY = 0

// Parse any CSS color string the browser can render, return relative luminance
function luminance(colorStr) {
  const d = document.createElement('div')
  d.style.color = colorStr
  d.style.display = 'none'
  document.body.appendChild(d)
  const rgb = getComputedStyle(d).color
  document.body.removeChild(d)
  const m = rgb.match(/[\d.]+/g)
  if (!m) return 1
  return [+m[0], +m[1], +m[2]].reduce((lum, c) => {
    const s = c / 255
    return lum + (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722].shift()
  }, 0)
}

function contrastColor(colorStr) {
  return luminance(colorStr) > 0.179 ? '#1a1a1a' : '#ffffff'
}

const initialPanX = -2500 + document.documentElement.clientWidth / 2
const initialPanY = -2500 + document.documentElement.clientHeight / 2

const _urlParams = new URLSearchParams(location.search)
const _permalinkCard = _urlParams.get('card') || null
const _permalinkSidebar = _urlParams.get('sidebar') === 'open' && !!_permalinkCard

const $ = Self(tag, {
  cards: {},
  trayZ: 3,
  focusedCard: null,
  grabbing: null,
  resizing: null,
  mode: 'pan',
  menuOpen: false,
  panX: initialPanX,
  panY: initialPanY,
  panXmod: 0,
  panYmod: 0,
  zoom: 1,
  beltOffsetX: 0,
  beltOffsetY: 0,
  beltGrabbed: false,
  linkSource: null,
  // rubber-band create state
  createStartX: null,
  createStartY: null,
  createX: 0,
  createY: 0,
  isDrawing: false,
  // pan state
  panStartClientX: 0,
  panStartClientY: 0,
  panStartPanX: 0,
  panStartPanY: 0,
  panHappening: false,
  // drag pickup position (for snap-back on overlap drop)
  pickupX: 0,
  pickupY: 0,
  // sidebar
  sidebarOpen: _permalinkSidebar,
  sidebarCard: _permalinkCard,
  edgeTypes: { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' } },
})

// ── braid sync ──────────────────────────────────────────────────────────────

function boardUrl(id) {
  return `/braid/bulletin-board/${id || 'default'}`
}

function subscribe(target) {
  const id = target.id || 'default'
  braid.fetch(boardUrl(id), {
    subscribe: true,
    headers: { 'accept': 'application/json' },
  }).then(async res => {
    for await (const { body } of res) {
      if (!body) continue
      try {
        const data = JSON.parse(body)
        if (data.cards) {
          $.teach({
            cards: data.cards,
            edgeTypes: data.edgeTypes || { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' } },
          })
          if (_permalinkCard && data.cards[_permalinkCard]) {
            const card = data.cards[_permalinkCard]
            const host = document.querySelector(tag)
            const w = host ? host.clientWidth : window.innerWidth
            const h = host ? host.clientHeight : window.innerHeight
            $.teach({
              panX: w / 2 - (card.x + card.w / 2),
              panY: h / 2 - (card.y + card.h / 2),
              focusedCard: _permalinkCard,
            })
          }
        }
      } catch(e) {}
    }
  }).catch(() => {})
}

function save(target) {
  const id = (target && target.id) || 'default'
  const { cards, edgeTypes } = $.learn()
  fetch(boardUrl(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cards, edgeTypes }),
  }).catch(() => {})
}

// ── card operations ──────────────────────────────────────────────────────────

function createCard(x, y, w, h) {
  const id = crypto.randomUUID()
  const { cards, trayZ } = $.learn()
  $.teach({
    cards: {
      ...cards,
      [id]: {
        x, y,
        w: Math.max(120, w),
        h: Math.max(80, h),
        z: trayZ + 1,
        text: '',
        color: '#fffde7',
        saga: '',
        createdAt: Date.now(),
        startDate: '',
        endDate: '',
        links: {},
        backlinks: {},
      }
    },
    trayZ: trayZ + 1,
    focusedCard: id,
  })
  return id
}

function updateCard(id, updates) {
  const { cards } = $.learn()
  if (!cards[id]) return
  $.teach({ cards: { ...cards, [id]: { ...cards[id], ...updates } } })
}

function deleteCard(id) {
  const { cards } = $.learn()
  const next = { ...cards }
  const card = next[id]
  if (card) {
    Object.entries(card.links || {}).forEach(([linkId, link]) => {
      const tgt = next[link.to]
      if (tgt) {
        const bl = { ...tgt.backlinks }
        delete bl[linkId]
        next[link.to] = { ...tgt, backlinks: bl }
      }
    })
    Object.entries(card.backlinks || {}).forEach(([linkId, fromId]) => {
      const src = next[fromId]
      if (src) {
        const lk = { ...src.links }
        delete lk[linkId]
        next[fromId] = { ...src, links: lk }
      }
    })
  }
  delete next[id]
  const { sidebarCard } = $.learn()
  $.teach({
    cards: next,
    focusedCard: null,
    sidebarOpen: sidebarCard === id ? false : $.learn().sidebarOpen,
    sidebarCard: sidebarCard === id ? null : sidebarCard,
  })
}

function linkCards(fromId, toId, fromDir, toDir, typeId = HYPER_ID) {
  const { cards } = $.learn()
  if (!cards[fromId] || !cards[toId] || fromId === toId) return
  if (!fromDir || !toDir) {
    ;[fromDir, toDir] = bestCompassPair(cards[fromId], cards[toId])
  }
  const linkId = crypto.randomUUID()
  const link = { from: fromId, to: toId, fromDir, toDir, typeId }
  $.teach({
    cards: {
      ...cards,
      [fromId]: { ...cards[fromId], links:     { ...cards[fromId].links,     [linkId]: link } },
      [toId]:   { ...cards[toId],   backlinks: { ...cards[toId].backlinks,   [linkId]: fromId } },
    }
  })
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clientToCanvas(clientX, clientY, host) {
  const { panX, panY, zoom } = $.learn()
  const rect = host ? host.getBoundingClientRect() : { left: 0, top: 0 }
  return [
    (clientX - rect.left - panX) / zoom,
    (clientY - rect.top  - panY) / zoom,
  ]
}

function exitPoint(card, dir) {
  const { x, y, w, h } = card
  const cx = x + w / 2, cy = y + h / 2
  switch (dir) {
    case 'N':  return [cx,   y    ]
    case 'S':  return [cx,   y + h]
    case 'E':  return [x + w, cy  ]
    case 'W':  return [x,    cy   ]
    case 'NE': return [x + w, y   ]
    case 'NW': return [x,     y   ]
    case 'SE': return [x + w, y + h]
    case 'SW': return [x,     y + h]
    default:   return [x + w, cy  ]
  }
}

function bestCompassPair(from, to) {
  let best = ['E', 'W'], bestDist = Infinity
  for (const fd of DIRS) {
    for (const td of DIRS) {
      const [fx, fy] = exitPoint(from, fd)
      const [tx, ty] = exitPoint(to, td)
      const d = (fx - tx) ** 2 + (fy - ty) ** 2
      if (d < bestDist) { bestDist = d; best = [fd, td] }
    }
  }
  return best
}

function createEdgeType(name, color = 'dodgerblue') {
  const { edgeTypes } = $.learn()
  const existing = Object.entries(edgeTypes).find(([, t]) => t.name === name)
  if (existing) return existing[0]
  const id = crypto.randomUUID()
  $.teach({ edgeTypes: { ...edgeTypes, [id]: { name, color } } })
  return id
}

function panToCard(cardId) {
  const { cards } = $.learn()
  const card = cards[cardId]
  if (!card) return
  const host = document.querySelector(tag)
  if (!host) return
  const sidebar = host.querySelector('.card-sidebar')
  const sidebarW = sidebar?.dataset.open === 'true' ? (sidebar.offsetWidth || 280) : 0
  const vw = host.clientWidth
  const vh = host.clientHeight
  const panX = (vw - sidebarW) / 2 - (card.x + card.w / 2)
  const panY = vh / 2 - (card.y + card.h / 2)
  $.teach({ panX, panY, focusedCard: cardId, sidebarCard: cardId, sidebarOpen: true })
}

function modeIcon(mode) {
  return { pan: '✛', create: '✦', link: '⇢', daydream: '✧' }[mode] || '✛'
}

function getStars() {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const rhythm = parseFloat(getComputedStyle(document.documentElement).fontSize)
  canvas.height = rhythm
  canvas.width = rhythm
  ctx.fillStyle = 'rgba(255,255,255,.85)'
  ctx.fillRect(rhythm / 2, rhythm / 2, 1, 1)
  ctx.fillStyle = 'rgba(0,0,0,.85)'
  ctx.fillRect(rhythm / 2 + 1, rhythm / 2 + 1, 1, 1)
  return `url(${canvas.toDataURL()})`
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── render helpers ────────────────────────────────────────────────────────────

function renderCard(id, card, focused, linkSource) {
  const isSource = linkSource === id
  const isFocused = focused === id
  return `
    <div class="card${isSource ? ' link-source' : ''}"
         data-id="${id}"
         data-focused="${isFocused}"
         style="left:${card.x}px; top:${card.y}px; --cw:${card.w}px; --ch:${card.h}px; z-index:${card.z || 3}; background:${card.color || 'lemonchiffon'}; --card-contrast:${contrastColor(card.color || 'lemonchiffon')};">
      <div class="card-title-bar" data-drag="${id}">
        <button class="card-pencil" data-pencil="${id}" title="inspect card">✎</button>
        <button class="card-close" data-close-card="${id}" title="remove card">×</button>
      </div>
      <textarea class="card-body" data-card-id="${id}" ${isFocused ? '' : 'tabindex="-1"'}
        placeholder="...">${escapeHtml(card.text || '')}</textarea>
      <button class="card-resize-se" data-resize="${id}" data-direction="se"></button>
    </div>
  `
}

function renderSidebarBody(id, cards, edgeTypes = {}) {
  const card = cards[id]
  if (!card) return '<p class="sidebar-empty">Card not found.</p>'
  const allTypes = { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' }, ...edgeTypes }
  const linkEntries = Object.entries(card.links || {})
  const backlinkEntries = Object.entries(card.backlinks || {})
  const base = location.origin + '/app/bulletin-board'
  const permalink = `${base}?card=${id}&sidebar=open`
  return `
    <dl class="sidebar-dl">
      <dt>Position</dt><dd><span class="sidebar-pos">x ${Math.round(card.x)}, y ${Math.round(card.y)}</span></dd>
      <dt>Size</dt><dd><span class="sidebar-sz">${Math.round(card.w)} × ${Math.round(card.h)}</span></dd>
      <dt>Start</dt><dd><input class="sidebar-date" type="date" data-date-field="startDate" data-card-id="${id}" value="${card.startDate || ''}"></dd>
      <dt>End</dt><dd><input class="sidebar-date" type="date" data-date-field="endDate" data-card-id="${id}" value="${card.endDate || ''}"></dd>
      <dt>Links out</dt><dd>${linkEntries.length > 0 ? linkEntries.map(([lid, l]) => {
        const typeColor = allTypes[l.typeId || HYPER_ID]?.color || 'dodgerblue'
        const toCard = cards[l.to]
        const label = toCard?.text?.slice(0,12) || l.to.slice(0,8)
        return `<button class="sidebar-ref" data-open-edge="${lid}" data-from-card="${id}" style="--edge-color:${typeColor}">${escapeHtml(label)}</button>`
      }).join('') : 'none'}</dd>
      <dt>Links in</dt><dd>${backlinkEntries.length > 0 ? backlinkEntries.map(([lid, fromId]) => {
        const fromCard = cards[fromId]
        const link = fromCard?.links?.[lid]
        const typeColor = allTypes[link?.typeId || HYPER_ID]?.color || 'dodgerblue'
        const label = fromCard?.text?.slice(0,12) || fromId.slice(0,8)
        return `<button class="sidebar-ref" data-open-edge="${lid}" data-from-card="${fromId}" style="--edge-color:${typeColor}">${escapeHtml(label)}</button>`
      }).join('') : 'none'}</dd>
      <dt>Permalink</dt><dd><a class="sidebar-permalink" href="${permalink}" target="_blank">${id.slice(0,8)}…</a></dd>
    </dl>
    <textarea class="sidebar-editor" data-edit-card="${id}" placeholder="type here...">${escapeHtml(card.text || '')}</textarea>
    <div class="sidebar-palette-section">
      <div class="sidebar-label">Color</div>
      <div class="sidebar-palette-wrap" data-palette-card="${id}">
        <plan98-palette></plan98-palette>
      </div>
    </div>
  `
}

function renderCardMini(id, card) {
  if (!card) return ''
  const contrast = contrastColor(card.color || 'lemonchiffon')
  return `<div data-goto-card="${id}"
    style="background:${card.color || 'lemonchiffon'}; border-radius:2px; padding:.5rem .65rem; min-height:3rem; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.08), 0 3px 8px rgba(0,0,0,.08), 0 6px 20px rgba(0,0,0,.06); transition:box-shadow .15s;">
    <div style="font-size:.75rem; line-height:1.4; color:${contrast}; white-space:pre-wrap; word-break:break-word; pointer-events:none;">${escapeHtml(card.text?.slice(0, 120) || '')}</div>
  </div>`
}

function renderEdgeModal(linkId, fromCardId, cards, edgeTypes) {
  const fromCard = cards[fromCardId]
  if (!fromCard) return '<p>Link not found.</p>'
  const link = fromCard.links?.[linkId]
  if (!link) return '<p>Link not found.</p>'
  const toCard = cards[link.to]
  if (!toCard) return '<p>Target card not found.</p>'
  const allTypes = { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' }, ...edgeTypes }
  const typeId = link.typeId || HYPER_ID
  const edgeType = allTypes[typeId]
  const edgeColor = edgeType?.color || 'dodgerblue'
  const edgeName = edgeType?.name || 'hyper'
  const edgeContrast = contrastColor(edgeColor)

  // Nodes participating in at least one edge of this type (excluding these two)
  const participants = new Set()
  Object.entries(cards).forEach(([cid, card]) => {
    Object.values(card.links || {}).forEach(l => {
      if ((l.typeId || HYPER_ID) === typeId) {
        participants.add(l.from || cid)
        participants.add(l.to)
      }
    })
  })
  participants.delete(fromCardId)
  participants.delete(link.to)

  const typeOptions = Object.values(allTypes).map(t => `<option value="${escapeHtml(t.name)}">`).join('')

  const bodyBg = `color-mix(in srgb, ${edgeColor} 10%, white)`
  const labelStyle = `font-family:'Recursive',sans-serif; font-size:.65rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:rgba(0,0,0,.4); margin-bottom:.35rem;`

  return `
    <div data-modal-close style="min-height:100%; display:flex; align-items:center; justify-content:center; padding:2rem; box-sizing:border-box;">
      <div data-link-id="${linkId}" data-from-card="${fromCardId}"
        style="width:100%; max-width:560px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.18), 0 1px 4px rgba(0,0,0,.12); font-family:'Recursive',sans-serif;">
        <div data-edge-header style="background:${edgeColor}; padding:.5rem .75rem; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(0,0,0,.1);">
          <span data-edge-contrast style="font-family:'Recursive',sans-serif; font-size:.8rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:${edgeContrast};">Relationship Manager</span>
          <span data-edge-contrast style="font-family:'Recursive',sans-serif; font-size:.7rem; color:${edgeContrast}; opacity:.7;">${escapeHtml(edgeName)}</span>
        </div>
        <div data-edge-body style="background:${bodyBg}; padding:1.25rem;">
          <div style="display:grid; grid-template-columns:1fr auto 1fr; gap:.75rem; align-items:center; margin-bottom:1rem;">
            ${renderCardMini(fromCardId, fromCard)}
            <div style="display:flex; flex-direction:column; align-items:center; gap:.4rem;">
              <div data-edge-dot style="width:12px; height:12px; background:${edgeColor}; flex-shrink:0;"></div>
              <div style="${labelStyle} margin-bottom:0;">type</div>
              <input class="edge-type-input" list="bb-edge-types-${linkId}"
                value="${escapeHtml(edgeName)}" placeholder="type name"
                data-link-id="${linkId}" data-from-card="${fromCardId}"
                style="width:90px; border:1px solid rgba(0,0,0,.15); padding:.2rem .35rem; font-family:'Recursive',sans-serif; font-size:.7rem; text-align:center; background:white; color:#3a3020; outline:none;">
              <datalist id="bb-edge-types-${linkId}">${typeOptions}</datalist>
              <div data-palette-edge="${linkId}" data-from-card="${fromCardId}"
                style="width:90px; height:56px; overflow:hidden; border:1px solid rgba(0,0,0,.1); visibility:${edgeName === 'hyper' ? 'hidden' : 'visible'};">
                <plan98-palette style="height:100%; width:100%;"></plan98-palette>
              </div>
            </div>
            ${renderCardMini(link.to, toCard)}
          </div>
          ${participants.size > 0 ? `
            <div style="${labelStyle}">Also in "${escapeHtml(edgeName)}"</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:.5rem;">
              ${[...participants].map(cid => renderCardMini(cid, cards[cid])).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `
}

function renderLinksInner(cards, edgeTypes = {}) {
  const allTypes = { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' }, ...edgeTypes }
  const usedTypeIds = new Set()
  const linkData = []

  Object.entries(cards).forEach(([fromId, card]) => {
    Object.entries(card.links || {}).forEach(([linkId, link]) => {
      const to = cards[link.to]
      if (!to) return
      const typeId = link.typeId || HYPER_ID
      usedTypeIds.add(typeId)
      const [fromDir, toDir] = bestCompassPair(card, to)
      const [x1, y1] = exitPoint(card, fromDir)
      const [x2, y2] = exitPoint(to, toDir)
      linkData.push({ linkId, x1, y1, x2, y2, typeId })
    })
  })

  const markers = [...usedTypeIds].map(tid => {
    const color = allTypes[tid]?.color || 'dodgerblue'
    return `<marker id="bb-arrow-${tid}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="${color}"/>
    </marker>`
  }).join('')

  const lines = linkData.map(({ linkId, x1, y1, x2, y2, typeId }) => {
    const color = allTypes[typeId]?.color || 'dodgerblue'
    return `<g data-link-id="${linkId}">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${color}" stroke-width="2" marker-end="url(#bb-arrow-${typeId})" pointer-events="none"/>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="transparent" stroke-width="16" pointer-events="all" style="cursor:pointer"/>
    </g>`
  })

  return `<defs>${markers}</defs>${lines.join('')}`
}

// 12fps smoothed SVG line update while a card is being dragged
function patchGrabArrows(grabbingId) {
  _smoothArrowX += (dragCardX - _smoothArrowX) * 0.5
  _smoothArrowY += (dragCardY - _smoothArrowY) * 0.5
  const linksLayer = document.querySelector(`${tag} .links-layer`)
  if (!linksLayer) return
  const { cards } = $.learn()
  const card = cards[grabbingId]
  if (!card) return
  const smoothCard = { ...card, x: _smoothArrowX, y: _smoothArrowY }
  Object.entries(card.links || {}).forEach(([linkId, link]) => {
    const toCard = cards[link.to]
    if (!toCard) return
    const g = linksLayer.querySelector(`g[data-link-id="${linkId}"]`)
    if (!g) return
    const [fromDir, toDir] = bestCompassPair(smoothCard, toCard)
    const [x1, y1] = exitPoint(smoothCard, fromDir)
    const [x2, y2] = exitPoint(toCard, toDir)
    g.querySelectorAll('line').forEach(l => {
      l.setAttribute('x1', x1); l.setAttribute('y1', y1)
      l.setAttribute('x2', x2); l.setAttribute('y2', y2)
    })
  })
  Object.entries(card.backlinks || {}).forEach(([linkId, fromCardId]) => {
    const fromCard = cards[fromCardId]
    if (!fromCard) return
    const link = fromCard.links?.[linkId]
    if (!link) return
    const toCard = cards[link.to]
    if (!toCard) return
    const g = linksLayer.querySelector(`g[data-link-id="${linkId}"]`)
    if (!g) return
    const [fromDir, toDir] = bestCompassPair(fromCard, smoothCard)
    const [x1, y1] = exitPoint(fromCard, fromDir)
    const [x2, y2] = exitPoint(smoothCard, toDir)
    g.querySelectorAll('line').forEach(l => {
      l.setAttribute('x1', x1); l.setAttribute('y1', y1)
      l.setAttribute('x2', x2); l.setAttribute('y2', y2)
    })
  })
}

// Patch cards layer without destroying live DOM — preserves focused textareas and
// active pointer capture during drag/resize.
function patchCardsLayer(cardsLayer, cards, focused, linkSource, grabbing) {
  const seen = new Set()

  for (const [id, card] of Object.entries(cards)) {
    seen.add(id)
    let el = cardsLayer.querySelector(`.card[data-id="${id}"]`)

    if (!el) {
      const tmp = document.createElement('div')
      tmp.innerHTML = renderCard(id, card, focused, linkSource).trim()
      el = tmp.firstElementChild
      cardsLayer.appendChild(el)
      if (focused === id) {
        requestAnimationFrame(() => el.querySelector('.card-body')?.focus())
      }
    } else {
      el.dataset.focused = String(focused === id)
      el.dataset.grabbed = String(grabbing === id)
      el.style.left = card.x + 'px'
      el.style.top = card.y + 'px'
      el.style.setProperty('--cw', card.w + 'px')
      el.style.setProperty('--ch', card.h + 'px')
      el.style.zIndex = card.z || 3
      el.style.background = card.color || 'lemonchiffon'
      el.style.setProperty('--card-contrast', contrastColor(card.color || 'lemonchiffon'))
      el.classList.toggle('link-source', linkSource === id)

      // Only update textarea value when it's not the active element
      const ta = el.querySelector('.card-body')
      if (ta && document.activeElement !== ta) {
        ta.value = card.text || ''
      }
    }
  }

  // Remove deleted cards
  cardsLayer.querySelectorAll('.card[data-id]').forEach(el => {
    if (!seen.has(el.dataset.id)) el.remove()
  })
}

function renderCompassButtons(mode) {
  const actions = [
    { cls: 'c-pan',    icon: '✛', label: 'pan',      m: 'pan'      },
    { cls: 'c-create', icon: '✦', label: 'create',   m: 'create'   },
    { cls: 'c-link',   icon: '⇢', label: 'link',     m: 'link'     },
    { cls: 'c-dream',  icon: '✧', label: 'daydream', m: 'daydream' },
  ]
  return actions.map(a => `
    <button class="${a.cls}${mode === a.m ? ' active' : ''}" data-mode="${a.m}" title="${a.label}">
      <span>${a.icon}</span>
    </button>
  `).join('')
}

// ── draw ──────────────────────────────────────────────────────────────────────

$.draw(target => {
  if (target.innerHTML) return update(target)
  mount(target)
}, { beforeUpdate, afterUpdate })

function beforeUpdate(target) {
  const { beltGrabbed } = $.learn()
  target.dataset.belt = beltGrabbed ? 'true' : 'false'
}

function afterUpdate() {}

function mount(target) {
  const { panX, panY, zoom, mode } = $.learn()
  const stars = getStars()

  target.innerHTML = `
    <div class="workspace" style="--pan-x:${panX}px; --pan-y:${panY}px; --zoom:${zoom};">
      <canvas class="bulletin-canvas stars" width="5000" height="5000"></canvas>
      <svg class="links-layer" xmlns="http://www.w3.org/2000/svg" overflow="visible">${renderLinksInner({})}</svg>
      <div class="cards-layer"></div>
      <div class="create-preview"></div>
    </div>
    <div class="the-compass" data-open="false" style="--belt-offset-x:0px; --belt-offset-y:0px;">
      <button class="root" data-toggle-menu title="menu (drag to move)">${modeIcon(mode)}</button>
      ${renderCompassButtons(mode)}
    </div>
    <div class="card-sidebar" data-open="false">
      <div class="sidebar-resizer" data-sidebar-resizer></div>
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <span class="sidebar-heading">Inspector</span>
          <button class="sidebar-close" data-close-sidebar>✕</button>
        </div>
        <div class="sidebar-body"></div>
      </div>
    </div>
  `

  target.querySelector('.bulletin-canvas').style.backgroundImage = stars
  subscribe(target)
}

function update(target) {
  const { panX, panY, zoom, cards, mode, menuOpen, beltOffsetX, beltOffsetY,
          focusedCard, linkSource, isDrawing, createStartX, createStartY, createX, createY,
          sidebarOpen, sidebarCard, grabbing, edgeTypes } = $.learn()

  const workspace = target.querySelector('.workspace')
  workspace.style.setProperty('--pan-x', panX + 'px')
  workspace.style.setProperty('--pan-y', panY + 'px')
  workspace.style.setProperty('--zoom', zoom)

  const compass = target.querySelector('.the-compass')
  compass.dataset.open = menuOpen
  compass.style.setProperty('--belt-offset-x', beltOffsetX + 'px')
  compass.style.setProperty('--belt-offset-y', beltOffsetY + 'px')

  const rootBtn = compass.querySelector('.root')
  if (rootBtn) rootBtn.textContent = modeIcon(mode)

  compass.querySelectorAll('[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode)
  })

  const cardsLayer = target.querySelector('.cards-layer')
  patchCardsLayer(cardsLayer, cards, focusedCard, linkSource, grabbing)

  const cardsJson = JSON.stringify(cards)
  const etColorSig = Object.entries(edgeTypes).map(([k, v]) => `${k}:${v.color}`).join(',')
  const renderSig = cardsJson + '|' + etColorSig
  const linksLayer = target.querySelector('.links-layer')
  if (renderSig !== _lastRenderSig) {
    linksLayer.innerHTML = renderLinksInner(cards, edgeTypes)
    _lastRenderSig = renderSig
  }

  // rubber-band preview
  const preview = target.querySelector('.create-preview')
  if (isDrawing && createStartX !== null) {
    const x = Math.min(createStartX, createStartX + createX)
    const y = Math.min(createStartY, createStartY + createY)
    const w = Math.abs(createX)
    const h = Math.abs(createY)
    preview.style.cssText = `display:block; left:${x}px; top:${y}px; width:${w}px; height:${h}px;`
  } else {
    preview.style.cssText = 'display:none;'
  }

  if (sidebarOpen && sidebarCard && !cards[sidebarCard]) {
    $.teach({ sidebarOpen: false, sidebarCard: null })
    return
  }

  if (sidebarOpen && focusedCard && focusedCard !== sidebarCard) {
    $.teach({ sidebarCard: focusedCard })
    return
  }

  const sidebar = target.querySelector('.card-sidebar')
  sidebar.dataset.open = sidebarOpen && !!sidebarCard ? 'true' : 'false'
  if (sidebarOpen && sidebarCard) {
    const card = cards[sidebarCard]
    const cardColor = card?.color || 'lemonchiffon'
    sidebar.style.setProperty('--sidebar-card-color', cardColor)
    sidebar.style.setProperty('--sidebar-card-contrast', contrastColor(cardColor))

    const sidebarBody = sidebar.querySelector('.sidebar-body')
    const etSig = Object.entries(edgeTypes).map(([k, v]) => `${k}:${v.color}`).join(',')
    const linkTypeSig = Object.entries(card?.links || {}).map(([k, v]) => `${k}:${v.typeId}`).join(',')
      + '|' + Object.keys(card?.backlinks || {}).join(',')
    const cardSwitched = sidebarBody.dataset.card !== sidebarCard
      || sidebarBody.dataset.etSig !== etSig
      || sidebarBody.dataset.linkTypeSig !== linkTypeSig
    if (cardSwitched) {
      sidebarBody.innerHTML = renderSidebarBody(sidebarCard, cards, edgeTypes)
      sidebarBody.dataset.card = sidebarCard
      sidebarBody.dataset.etSig = etSig
      sidebarBody.dataset.linkTypeSig = linkTypeSig
    } else {
      // Patch live stats without destroying plan98-palette or editor focus
      if (card) {
        const pos = sidebarBody.querySelector('.sidebar-pos')
        const sz = sidebarBody.querySelector('.sidebar-sz')
        if (pos) pos.textContent = `x ${Math.round(card.x)}, y ${Math.round(card.y)}`
        if (sz)  sz.textContent  = `${Math.round(card.w)} × ${Math.round(card.h)}`
        const ed = sidebarBody.querySelector('.sidebar-editor')
        if (ed && document.activeElement !== ed) ed.value = card.text || ''
      }
    }
  }

  return null
}

// ── canvas pointer: pan + rubber-band create ─────────────────────────────────

$.when('pointerdown', '.bulletin-canvas', e => {
  e.preventDefault()
  $.teach({ focusedCard: null, sidebarOpen: false, sidebarCard: null })
  const { mode, panX, panY } = $.learn()
  const host = e.target.closest(tag)

  if (mode === 'pan') {
    $.teach({ panHappening: true, panStartClientX: e.clientX, panStartClientY: e.clientY,
              panStartPanX: panX, panStartPanY: panY })
    return
  }

  if (mode === 'create') {
    const [cx, cy] = clientToCanvas(e.clientX, e.clientY, host)
    $.teach({ isDrawing: true, createStartX: cx, createStartY: cy, createX: 0, createY: 0 })
  }
})

$.when('pointermove', '.bulletin-canvas', e => {
  e.preventDefault()
  const { mode, panHappening, panStartClientX, panStartClientY, panStartPanX, panStartPanY,
          isDrawing, createStartX, createStartY, zoom } = $.learn()

  if (mode === 'pan' && panHappening) {
    $.teach({
      panX: panStartPanX + (e.clientX - panStartClientX),
      panY: panStartPanY + (e.clientY - panStartClientY),
    })
    return
  }

  if (mode === 'create' && isDrawing) {
    const host = e.target.closest(tag)
    const [cx, cy] = clientToCanvas(e.clientX, e.clientY, host)
    $.teach({ createX: cx - createStartX, createY: cy - createStartY })
  }
})

$.when('pointerup', '.bulletin-canvas', e => {
  e.preventDefault()
  const { mode, panHappening, isDrawing, createStartX, createStartY, createX, createY } = $.learn()

  if (mode === 'pan' && panHappening) {
    const { panX, panY } = $.learn()
    const rhythm = parseFloat(getComputedStyle(document.documentElement).fontSize)
    $.teach({ panHappening: false, panXmod: panX % rhythm, panYmod: panY % rhythm })
    return
  }

  if (mode === 'create' && isDrawing) {
    const w = Math.abs(createX)
    const h = Math.abs(createY)
    if (w > 40 && h > 40) {
      const x = Math.min(createStartX, createStartX + createX)
      const y = Math.min(createStartY, createStartY + createY)
      createCard(x, y, w, h)
      save(e.target.closest(tag))
    }
    $.teach({ isDrawing: false, createStartX: null, createX: 0, createY: 0 })
  }
})

// ── card drag + resize — document-level pointerdown using closest() ───────────
// $.when delegation uses event.target.matches() (exact), not closest().
// Focused cards have pointer-interactive children so e.target is never .card
// itself — the $.when handler would never fire. Direct document listener fixes
// this for both the title bar and the card body.

let lastDragX, lastDragY
let dragCardX = 0, dragCardY = 0
let hasDragged = false

let lastResizeX, lastResizeY
let resizeCardW = 0, resizeCardH = 0

document.addEventListener('pointerdown', e => {
  // ── resize handle ──
  const resizeEl = e.target.closest('.card-resize-se')
  if (resizeEl) {
    e.preventDefault()
    e.stopPropagation()
    const id = resizeEl.dataset.resize
    if (!id) return
    const { trayZ, cards } = $.learn()
    const newZ = trayZ + 1
    resizeCardW = cards[id]?.w ?? 80
    resizeCardH = cards[id]?.h ?? 60
    $.teach({ trayZ: newZ, focusedCard: id, resizing: id })
    lastResizeX = e.clientX
    lastResizeY = e.clientY
    return
  }

  // ── card drag ──
  // Skip dedicated button handlers — they manage their own events
  if (e.target.closest('.card-close') || e.target.closest('.card-pencil')) return

  const cardEl = e.target.closest('.card')
  if (!cardEl) return

  const id = cardEl.dataset.id

  // Let focused textarea handle its own text editing
  if (e.target.closest('.card-body') && $.learn().focusedCard === id) return

  e.preventDefault()
  const { trayZ, cards } = $.learn()
  const newZ = trayZ + 1
  dragCardX = cards[id]?.x ?? 0
  dragCardY = cards[id]?.y ?? 0

  lastDragX = e.clientX
  lastDragY = e.clientY
  hasDragged = false

  $.teach({
    trayZ: newZ,
    focusedCard: id,
    grabbing: id,
    pickupX: dragCardX,
    pickupY: dragCardY,
    cards: { ...cards, [id]: { ...cards[id], z: newZ } },
  })

  _smoothArrowX = dragCardX
  _smoothArrowY = dragCardY
  if (_arrowInterval) clearInterval(_arrowInterval)
  _arrowInterval = setInterval(() => patchGrabArrows(id), 83)
}, { capture: true })

// ── textarea: save text on input ──────────────────────────────────────────────

let saveTimer
$.when('input', '.card-body', e => {
  const id = e.target.dataset.cardId
  if (!id) return
  updateCard(id, { text: e.target.value })
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(e.target.closest(tag)), 800)
})

// ── sidebar editor syncs back to card ────────────────────────────────────────

$.when('input', '.sidebar-editor', e => {
  const id = e.target.dataset.editCard
  if (!id) return
  updateCard(id, { text: e.target.value })
  // Mirror to card body if it's not currently focused
  const cardTa = document.querySelector(`.card[data-id="${id}"] .card-body`)
  if (cardTa && document.activeElement !== cardTa) cardTa.value = e.target.value
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(e.target.closest(tag)), 800)
})

// ── sidebar date fields ───────────────────────────────────────────────────────

$.when('change', '.sidebar-date', e => {
  const { cardId, dateField } = e.target.dataset
  if (!cardId || !dateField) return
  updateCard(cardId, { [dateField]: e.target.value })
  save(e.target.closest(tag))
})

// ── sidebar resize handle ─────────────────────────────────────────────────────

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('[data-sidebar-resizer]')) return
  const sidebar = e.target.closest('.card-sidebar')
  const host = e.target.closest(tag)
  if (!sidebar || !host) return
  e.preventDefault()

  function onMove(ev) {
    const rect = host.getBoundingClientRect()
    const w = Math.max(200, rect.right - ev.clientX)
    sidebar.style.width = w + 'px'
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}, { capture: true })

// ── card close ────────────────────────────────────────────────────────────────

$.when('click', '.card-close', e => {
  e.stopPropagation()
  const id = e.target.dataset.closeCard
  deleteCard(id)
  save(e.target.closest(tag))
})

// ── pencil: open sidebar inspector ───────────────────────────────────────────

$.when('click', '.card-pencil', e => {
  e.stopPropagation()
  const id = e.target.closest('[data-pencil]').dataset.pencil
  const { sidebarCard } = $.learn()
  if (sidebarCard === id) {
    $.teach({ sidebarOpen: false, sidebarCard: null })
  } else {
    $.teach({ sidebarOpen: true, sidebarCard: id })
  }
})

$.when('click', '[data-close-sidebar]', () => {
  $.teach({ sidebarOpen: false, sidebarCard: null })
})

// ── edge modal ────────────────────────────────────────────────────────────────

$.when('click', '[data-open-edge]', e => {
  const linkId = e.target.dataset.openEdge
  const fromCardId = e.target.dataset.fromCard
  const { cards, edgeTypes } = $.learn()
  showModal(renderEdgeModal(linkId, fromCardId, cards, edgeTypes))
})

// Modal renders outside bulletin-board — use document listeners for modal interactions
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-goto-card]')
  if (btn) {
    hideModal()
    panToCard(btn.dataset.gotoCard)
    return
  }
  const g = e.target.closest('g[data-link-id]')
  if (!g) return
  const linkId = g.dataset.linkId
  const { cards, edgeTypes } = $.learn()
  let fromCardId = null
  outer: for (const [cid, card] of Object.entries(cards)) {
    for (const lid of Object.keys(card.links || {})) {
      if (lid === linkId) { fromCardId = cid; break outer }
    }
  }
  if (!fromCardId) return
  showModal(renderEdgeModal(linkId, fromCardId, cards, edgeTypes))
})

document.addEventListener('change', e => {
  const input = e.target.closest('.edge-type-input')
  if (!input) return
  const { linkId, fromCard: fromCardId } = input.dataset
  const name = input.value.trim()
  if (!linkId || !fromCardId || !name) return
  const { cards, edgeTypes } = $.learn()
  const fromCard = cards[fromCardId]
  const link = fromCard?.links?.[linkId]
  if (!link) return
  const typeId = createEdgeType(name, edgeTypes[link.typeId]?.color || 'dodgerblue')
  const updatedLink = { ...link, typeId }
  $.teach({
    cards: {
      ...cards,
      [fromCardId]: { ...fromCard, links: { ...fromCard.links, [linkId]: updatedLink } }
    }
  })
  // Repaint modal to reflect resolved type's color (name collision hits existing color)
  const resolvedColor = $.learn().edgeTypes[typeId]?.color || 'dodgerblue'
  const resolvedContrast = contrastColor(resolvedColor)
  const panel = document.querySelector(`[data-link-id="${linkId}"]`)
  if (panel) {
    const dot = panel.querySelector('[data-edge-dot]')
    if (dot) dot.style.background = resolvedColor
    const header = panel.querySelector('[data-edge-header]')
    if (header) header.style.background = resolvedColor
    const edgeBody = panel.querySelector('[data-edge-body]')
    if (edgeBody) edgeBody.style.background = `color-mix(in srgb, ${resolvedColor} 10%, white)`
    panel.querySelectorAll('[data-edge-contrast]').forEach(el => el.style.color = resolvedContrast)
  }
  const paletteWrap = document.querySelector(`[data-palette-edge="${linkId}"]`)
  if (paletteWrap) paletteWrap.style.visibility = name === 'hyper' ? 'hidden' : 'visible'
  save(document.querySelector(tag))
})

// palette input from modal (outside bulletin-board element) — document level
document.addEventListener('input', e => {
  if (!e.target.matches('plan98-palette')) return
  const edgeWrap = e.target.closest('[data-palette-edge]')
  if (!edgeWrap) return
  const linkId = edgeWrap.dataset.paletteEdge
  const fromCardId = edgeWrap.dataset.fromCard
  const color = e.detail?.color
  if (!linkId || !fromCardId || !color) return
  const { cards, edgeTypes } = $.learn()
  const fromCard = cards[fromCardId]
  const link = fromCard?.links?.[linkId]
  if (!link) return
  const typeId = link.typeId || HYPER_ID
  $.teach({ edgeTypes: { ...edgeTypes, [typeId]: { ...edgeTypes[typeId], color } } })
  const panel = edgeWrap.closest('[data-link-id]')
  if (panel) {
    const contrast = contrastColor(color)
    const dot = panel.querySelector('[data-edge-dot]')
    if (dot) dot.style.background = color
    const header = panel.querySelector('[data-edge-header]')
    if (header) header.style.background = color
    const edgeBody = panel.querySelector('[data-edge-body]')
    if (edgeBody) edgeBody.style.background = `color-mix(in srgb, ${color} 10%, white)`
    panel.querySelectorAll('[data-edge-contrast]').forEach(el => el.style.color = contrast)
  }
  save(document.querySelector(tag))
})

$.when('input', 'plan98-palette', e => {
  // Card palette (inside sidebar — within bulletin-board element)
  const cardWrap = e.target.closest('[data-palette-card]')
  if (!cardWrap) return
  const id = cardWrap.dataset.paletteCard
  const color = e.detail?.color
  if (!id || !color) return
  updateCard(id, { color })
  const cardEl = document.querySelector(`.card[data-id="${id}"]`)
  if (cardEl) cardEl.style.background = color
  save(e.target.closest(tag))
})

// ── link mode: click card body to select ─────────────────────────────────────

$.when('click', '.card-body', e => {
  const { mode, linkSource } = $.learn()
  if (mode !== 'link') return
  e.preventDefault()
  const id = e.target.closest('.card')?.dataset.id
  if (!id) return
  if (!linkSource) {
    $.teach({ linkSource: id })
  } else {
    linkCards(linkSource, id)
    $.teach({ linkSource: null })
    save(e.target.closest(tag))
  }
})

// ── overlap detection + edge-link algorithm ───────────────────────────────────

function findOverlap(id, cards) {
  const a = cards[id]
  if (!a) return null
  for (const [otherId, b] of Object.entries(cards)) {
    if (otherId === id) continue
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
      return otherId
    }
  }
  return null
}

function bestEdgePair(from, to) {
  const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2
  const tcx = to.x   + to.w   / 2, tcy = to.y   + to.h   / 2
  const dx = tcx - fcx, dy = tcy - fcy
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? ['E', 'W'] : ['W', 'E']
  return dy > 0 ? ['S', 'N'] : ['N', 'S']
}

// ── document-level: drag, resize, belt ───────────────────────────────────────

document.addEventListener('pointermove', e => {
  const { grabbing, resizing, beltGrabbed, zoom } = $.learn()

  if (grabbing) {
    if (lastDragX !== undefined) {
      const dx = (e.clientX - lastDragX) / zoom
      const dy = (e.clientY - lastDragY) / zoom
      if (!hasDragged && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) hasDragged = true
      dragCardX += dx
      dragCardY += dy
      // Update DOM directly — no state change, no re-render
      const cardEl = document.querySelector(`.card[data-id="${grabbing}"]`)
      if (cardEl) { cardEl.style.left = dragCardX + 'px'; cardEl.style.top = dragCardY + 'px' }
    }
    lastDragX = e.clientX
    lastDragY = e.clientY
    return
  }

  if (resizing) {
    if (lastResizeX !== undefined) {
      const { zoom } = $.learn()
      const dx = (e.clientX - lastResizeX) / zoom
      const dy = (e.clientY - lastResizeY) / zoom
      resizeCardW = Math.max(80, resizeCardW + dx)
      resizeCardH = Math.max(60, resizeCardH + dy)
      const cardEl = document.querySelector(`.card[data-id="${resizing}"]`)
      if (cardEl) {
        cardEl.style.setProperty('--cw', resizeCardW + 'px')
        cardEl.style.setProperty('--ch', resizeCardH + 'px')
      }
    }
    lastResizeX = e.clientX
    lastResizeY = e.clientY
    return
  }

  if (beltGrabbed) {
    const { beltOffsetX, beltOffsetY } = $.learn()
    const dx = e.clientX - lastBeltX
    const dy = e.clientY - lastBeltY
    if (!beltDragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) beltDragMoved = true
    if (beltDragMoved) $.teach({ beltOffsetX: beltOffsetX + dx, beltOffsetY: beltOffsetY + dy })
    lastBeltX = e.clientX
    lastBeltY = e.clientY
  }
})

function stopArrowInterval() {
  if (_arrowInterval) { clearInterval(_arrowInterval); _arrowInterval = null }
  _lastRenderSig = null // force SVG rebuild on next draw
}

function cancelGesture() {
  const { grabbing, resizing } = $.learn()
  if (grabbing) {
    stopArrowInterval()
    const { pickupX, pickupY } = $.learn()
    const cardEl = document.querySelector(`.card[data-id="${grabbing}"]`)
    if (cardEl) { cardEl.style.left = pickupX + 'px'; cardEl.style.top = pickupY + 'px' }
  }
  $.teach({ grabbing: null, resizing: null })
  lastDragX = lastDragY = lastResizeX = lastResizeY = undefined
  hasDragged = false
}
document.addEventListener('pointercancel', cancelGesture)

document.addEventListener('pointerup', () => {
  const { grabbing, resizing, beltGrabbed } = $.learn()

  if (grabbing) {
    stopArrowInterval()
    if (hasDragged) {
      const { cards, pickupX, pickupY } = $.learn()
      const dropped = { ...(cards[grabbing] || {}), x: dragCardX, y: dragCardY }
      const tmpCards = { ...cards, [grabbing]: dropped }
      const overlapping = findOverlap(grabbing, tmpCards)
      if (overlapping) {
        const [fromDir, toDir] = bestCompassPair(dropped, tmpCards[overlapping])
        updateCard(grabbing, { x: pickupX, y: pickupY })
        const cardEl = document.querySelector(`.card[data-id="${grabbing}"]`)
        if (cardEl) { cardEl.style.left = pickupX + 'px'; cardEl.style.top = pickupY + 'px' }
        linkCards(grabbing, overlapping, fromDir, toDir)
      } else {
        updateCard(grabbing, { x: dragCardX, y: dragCardY })
      }
      save(document.querySelector(tag))
    }
    $.teach({ grabbing: null })
    lastDragX = undefined
    lastDragY = undefined
    hasDragged = false
    return
  }

  if (resizing) {
    updateCard(resizing, { w: resizeCardW, h: resizeCardH })
    save(document.querySelector(tag))
    $.teach({ resizing: null })
    lastResizeX = undefined
    lastResizeY = undefined
    return
  }

  if (beltGrabbed) {
    $.teach({ beltGrabbed: false })
    lastBeltX = undefined
    lastBeltY = undefined
  }
})

// ── compass drag (root button) ────────────────────────────────────────────────

let lastBeltX, lastBeltY, beltDragMoved = false

$.when('pointerdown', '.root', e => {
  e.preventDefault()
  $.teach({ beltGrabbed: true })
  beltDragMoved = false
  lastBeltX = e.clientX
  lastBeltY = e.clientY
})

$.when('click', '[data-toggle-menu]', () => {
  if (beltDragMoved) { beltDragMoved = false; return }
  $.teach({ menuOpen: !$.learn().menuOpen })
})

$.when('click', '[data-mode]', e => {
  const btn = e.target.closest('[data-mode]')
  if (!btn) return
  $.teach({ mode: btn.dataset.mode, menuOpen: false, linkSource: null })
})

// ── styles ────────────────────────────────────────────────────────────────────

$.style(`
  & {
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    display: block;
    background: white;
  }

  & .workspace {
    position: absolute;
    inset: 0;
    transform: translate(var(--pan-x, 0), var(--pan-y, 0)) scale(var(--zoom, 1));
    transform-origin: 0 0;
  }

  & .bulletin-canvas {
    position: absolute;
    top: 0; left: 0;
    width: 5000px; height: 5000px;
    background-color: white;
    touch-action: none;
    user-select: none;
  }

  & .links-layer {
    position: absolute;
    top: 0; left: 0;
    width: 5000px; height: 5000px;
    pointer-events: auto;
    color: rgba(0,0,0,.35);
    overflow: visible;
  }

  & .cards-layer {
    position: absolute;
    top: 0; left: 0;
    width: 5000px; height: 5000px;
    pointer-events: none;
  }

  & .create-preview {
    position: absolute;
    display: none;
    border: 2px dashed dodgerblue;
    background: rgba(30,144,255,.08);
    pointer-events: none;
    box-sizing: border-box;
  }

  /* ── card — sticky note aesthetic ── */

  & .card {
    position: absolute;
    top: 0; left: 0;
    width: var(--cw, 200px);
    height: var(--ch, 120px);
    display: block;
    border-radius: 2px;
    box-shadow:
      0 1px 2px rgba(0,0,0,.08),
      0 3px 8px rgba(0,0,0,.08),
      0 6px 20px rgba(0,0,0,.06);
    transition: box-shadow .35s cubic-bezier(.2,0,.2,1);
    pointer-events: auto;
    overflow: visible;
    background: lemonchiffon;
  }

  & .card[data-grabbed="true"] {
    box-shadow:
      0 8px 16px rgba(0,0,0,.10),
      0 20px 48px rgba(0,0,0,.12),
      0 40px 80px rgba(0,0,0,.08),
      0 2px 4px rgba(0,0,0,.06);
  }

  & .card.link-source {
    outline: 2px solid dodgerblue;
    outline-offset: 2px;
  }

  /* adhesive strip — overlays the top of the card only when focused */
  & .card-title-bar {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1.5rem;
    display: none;
    align-items: center;
    justify-content: flex-end;
    padding: 0 .2rem;
    border-radius: 2px 2px 0 0;
    background: inherit;
    cursor: grab;
    touch-action: none;
    user-select: none;
    z-index: 2;
  }

  & .card[data-focused="true"] .card-title-bar { display: flex; }
  & .card-title-bar:active { cursor: grabbing; }

  & .card-pencil,
  & .card-close {
    background: none;
    border: none;
    color: var(--card-contrast, #1a1a1a);
    opacity: .35;
    cursor: pointer;
    font-size: .8rem;
    line-height: 1;
    padding: 0 .25rem;
    transition: opacity .1s;
    flex-shrink: 0;
    z-index: 3;
    position: relative;
  }

  & .card-pencil { margin-right: auto; }
  & .card-pencil:hover,
  & .card-close:hover { opacity: 1; }

  & .card-body {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    padding: .4rem .5rem;
    box-sizing: border-box;
    font-size: .875rem;
    line-height: 1.5;
    font-family: 'Recursive', sans-serif;
    color: var(--card-contrast, #1a1a1a);
    border-radius: 2px;
    cursor: grab;
    overflow: auto;
    pointer-events: none;
    z-index: 1;
  }

  /* When focused: title bar sits on top, textarea shifts down to avoid it */
  & .card[data-focused="true"] .card-body {
    top: 1.5rem;
    cursor: text;
    pointer-events: auto;
  }

  & .card-body::placeholder {
    color: var(--card-contrast, #1a1a1a);
    opacity: .3;
    font-style: italic;
  }

  & .card-resize-se {
    position: absolute;
    bottom: 0; right: 0;
    width: 12px; height: 12px;
    background: none;
    border: none;
    border-right: 2px solid rgba(0,0,0,.15);
    border-bottom: 2px solid rgba(0,0,0,.15);
    cursor: se-resize;
    touch-action: none;
    opacity: 0;
    pointer-events: all;
    z-index: 3;
    border-radius: 0 0 2px 0;
    transition: opacity .1s;
  }

  & .card:hover .card-resize-se,
  & .card[data-focused="true"] .card-resize-se { opacity: 1; }
  & .card-resize-se:hover { border-color: dodgerblue; }

  /* ── compass ── */

  & .the-compass {
    position: absolute;
    bottom: 0; right: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: repeat(6, 2rem);
    grid-template-rows: repeat(6, 2rem);
    width: calc(6 * 2rem);
    height: calc(6 * 2rem);
    pointer-events: none;
    transform: translate(var(--belt-offset-x, 0), var(--belt-offset-y, 0));
  }

  & .the-compass button {
    pointer-events: all;
    background: #1a1a1a;
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 50%;
    color: rgba(255,255,255,.85);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: .9rem;
    box-shadow: 0 2px 6px rgba(0,0,0,.3);
    transition: background .1s, color .1s, transform .15s, opacity .15s;
    touch-action: none;
    user-select: none;
  }

  & .the-compass button * { pointer-events: none; }
  & .the-compass button:hover  { background: #333; color: #fff; }
  & .the-compass button.active { background: dodgerblue; color: #fff; border-color: dodgerblue; }

  & .the-compass .root     { grid-row: 5/7; grid-column: 5/7; z-index: 1; cursor: grab; }
  & .the-compass .root:active { cursor: grabbing; }
  & .the-compass .c-pan    { grid-row: 5/7; grid-column: 3/5; }
  & .the-compass .c-create { grid-row: 3/5; grid-column: 5/7; }
  & .the-compass .c-link   { grid-row: 1/3; grid-column: 5/7; }
  & .the-compass .c-edit   { grid-row: 1/3; grid-column: 3/5; }
  & .the-compass .c-dream  { grid-row: 3/5; grid-column: 3/5; }

  & .the-compass[data-open="false"] button:not(.root) {
    opacity: 0; pointer-events: none; transform: scale(0.3);
  }
  & .the-compass[data-open="true"] button:not(.root) {
    opacity: 1; pointer-events: all; transform: scale(1);
  }

  /* ── sidebar inspector ── */

  & .card-sidebar {
    position: absolute;
    top: 0; right: 0;
    height: 100%;
    width: var(--sidebar-w, 280px);
    z-index: 20;
    pointer-events: none;
    transform: translateX(100%);
    transition: transform 220ms cubic-bezier(.4,0,.2,1);
    display: flex;
    flex-direction: row;
  }

  & .card-sidebar[data-open="true"] {
    transform: translateX(0);
    pointer-events: all;
  }

  & .sidebar-resizer {
    width: 6px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background .15s;
  }
  & .sidebar-resizer:hover { background: dodgerblue; opacity: .35; }

  & .sidebar-inner {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: color-mix(in srgb, var(--sidebar-card-color, lemonchiffon) 10%, white);
    box-shadow: -4px 0 12px rgba(0,0,0,.12), -1px 0 3px rgba(0,0,0,.08);
    border-left: 1px solid rgba(0,0,0,.08);
    overflow: hidden;
  }

  & .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .5rem .75rem;
    background: var(--sidebar-card-color, lemonchiffon);
    border-bottom: 1px solid rgba(0,0,0,.1);
    flex-shrink: 0;
    transition: background .2s;
  }

  & .sidebar-heading {
    font-family: 'Recursive', sans-serif;
    font-size: .8rem;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--sidebar-card-contrast, #1a1a1a);
  }

  & .sidebar-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--sidebar-card-contrast, #1a1a1a);
    opacity: .5;
    font-size: .9rem;
    padding: .1rem .3rem;
    line-height: 1;
    border-radius: 2px;
    transition: color .1s, opacity .1s;
  }
  & .sidebar-close:hover { opacity: 1; }

  & .sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: .75rem;
  }

  & .sidebar-title {
    font-family: 'Recursive', sans-serif;
    font-size: .85rem;
    font-weight: 700;
    color: #3a3020;
    margin: 0 0 .75rem;
  }

  & .sidebar-dl {
    display: grid;
    grid-template-columns: 5rem 1fr;
    gap: .25rem .5rem;
    font-family: 'Recursive', sans-serif;
    font-size: .75rem;
    line-height: 1.5;
    margin: 0;
  }

  & .sidebar-dl dt {
    color: rgba(0,0,0,.4);
    font-weight: 600;
    text-transform: uppercase;
    font-size: .65rem;
    letter-spacing: .04em;
    align-self: start;
    padding-top: .1rem;
  }

  & .sidebar-dl dd {
    color: #3a3020;
    margin: 0;
    word-break: break-word;
  }

  & .sidebar-text {
    font-style: italic;
    opacity: .75;
    white-space: pre-wrap;
    max-height: 5rem;
    overflow: hidden;
  }

  & .sidebar-ref {
    display: inline-block;
    background: none;
    border: 1.5px solid var(--edge-color, dodgerblue);
    border-radius: 3px;
    padding: 0 .3rem;
    cursor: pointer;
    font-size: .65rem;
    font-family: 'Recursive', sans-serif;
    color: var(--edge-color, dodgerblue);
    margin: .1rem .1rem 0 0;
    transition: background .1s, color .1s;
  }
  & .sidebar-ref:hover {
    background: var(--edge-color, dodgerblue);
    color: white;
  }

  & .sidebar-permalink {
    color: dodgerblue;
    font-size: .7rem;
    word-break: break-all;
  }

  & .sidebar-empty {
    color: rgba(0,0,0,.3);
    font-style: italic;
    font-size: .8rem;
  }

  & .sidebar-date {
    width: 100%;
    background: white;
    border: 1px solid rgba(0,0,0,.12);
    border-radius: 3px;
    padding: .15rem .3rem;
    font-family: 'Recursive', sans-serif;
    font-size: .75rem;
    color: #3a3020;
    outline: none;
  }
  & .sidebar-date:focus { border-color: dodgerblue; }

  & .sidebar-palette-section {
    margin-top: .75rem;
  }

  & .sidebar-label {
    font-family: 'Recursive', sans-serif;
    font-size: .65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: rgba(0,0,0,.4);
    margin-bottom: .35rem;
  }

  & .sidebar-palette-wrap {
    height: 160px;
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid rgba(0,0,0,.08);
  }

  & .sidebar-palette-wrap plan98-palette {
    height: 100%;
    width: 100%;
  }

  & .sidebar-editor {
    display: block;
    width: 100%;
    min-height: 8rem;
    margin-top: .75rem;
    padding: .5rem;
    box-sizing: border-box;
    background: white;
    border: 1px solid rgba(0,0,0,.12);
    border-radius: 3px;
    font-family: 'Recursive', sans-serif;
    font-size: .8rem;
    line-height: 1.5;
    color: #3a3020;
    resize: vertical;
    outline: none;
    transition: border-color .1s;
  }
  & .sidebar-editor:focus {
    border-color: dodgerblue;
    box-shadow: 0 0 0 2px rgba(30,144,255,.15);
  }

  /* edge modal renders outside this element — all styles are inlined in renderEdgeModal */
`)
