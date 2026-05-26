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

import { Self, linkState, broadcastElf, PLAN98_NODE_ID } from '@plan98/types'
import * as braid from 'braid-http'
import { showModal, hideModal } from '@plan98/modal'
import { get as wasGet, put as wasPut, del as wasDel, getKeycard, ensureSpace } from './plan98-wallet.js'

self.braid_fetch = braid.fetch

const tag = 'bulletin-board'
const HYPER_ID = 'hyper'
const DIRS = ['N','S','E','W','NE','NW','SE','SW']

let _lastRenderSig = null
let _arrowInterval = null
let _peerArrowInterval = null
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

// Persistent board identity — generate once, stamp into URL so the QR
// is always a stable entry point for this specific board.
let _boardId = _urlParams.get('id')
if (!_boardId) {
  _boardId = crypto.randomUUID()
  const _u = new URL(location.href)
  _u.searchParams.set('id', _boardId)
  history.replaceState(history.state || null, '', _u.toString())
}

const $ = Self(tag, {
  cards: {},
  trayZ: 3,
  focusedCard: null,
  grabbing: null,
  resizing: null,
  mode: 'pan',
  menuOpen: false,
  launchHref: null,
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
  inspectorOpen: true,
  attachmentsOpen: true,
  edgeTypes: { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' } },
  players: {},
})

// ── presence ─────────────────────────────────────────────────────────────────

// Merge that targets only the players slot — preserves all other state and each
// peer's own slot. Sending null for a player ID removes them.
const PLAYERS_MERGE = `(state, payload) => {
  var inc = payload.players || {}
  var base = Object.assign({}, state.players || {})
  Object.keys(inc).forEach(function(k) {
    if (inc[k] === null) delete base[k]
    else base[k] = Object.assign({}, base[k] || {}, inc[k])
  })
  return Object.assign({}, state, { players: base })
}`

function idToHue(id) {
  var h = 0
  for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff
  return h % 360
}

let _presenceThrottle = 0

function broadcastPresence(cardId, x, y) {
  const now = Date.now()
  if (now - _presenceThrottle < 50) return
  _presenceThrottle = now
  broadcastElf(tag, { players: { [PLAN98_NODE_ID]: { cardId, x, y, ts: now } } }, PLAYERS_MERGE)
}

function clearPresence() {
  broadcastElf(tag, { players: { [PLAN98_NODE_ID]: null } }, PLAYERS_MERGE)
}

function applyPeerPositions(cardsLayer, players) {
  // Clear previous peer-drag state
  cardsLayer.querySelectorAll('.card[data-peer-drag]').forEach(el => {
    el.style.outline = ''
    el.style.outlineOffset = ''
    delete el.dataset.peerDrag
  })
  // Apply live peer positions directly to the real card elements
  Object.entries(players || {}).forEach(([id, p]) => {
    if (!p || id === PLAN98_NODE_ID) return
    if (Date.now() - (p.ts || 0) > 5000) return
    const el = cardsLayer.querySelector(`.card[data-id="${p.cardId}"]`)
    if (!el) return
    const hue = idToHue(id)
    el.style.left = p.x + 'px'
    el.style.top = p.y + 'px'
    el.style.outline = `2px solid hsl(${hue}, 75%, 55%)`
    el.style.outlineOffset = '3px'
    el.dataset.peerDrag = id
  })
}

// ── braid + WAS sync ─────────────────────────────────────────────────────────

function boardUrl(id) {
  return `/braid/bulletin-board/${id || 'default'}`
}

function wasPath(id) {
  return `/bulletin-board/${id || 'default'}.json`
}

async function wasLoad() {
  await ensureSpace().catch(() => null)
  try {
    const blob = await wasGet(wasPath(_boardId))
    if (!blob) return
    const data = JSON.parse(await blob.text())
    if (data?.cards) {
      $.teach({
        cards: data.cards,
        edgeTypes: data.edgeTypes || { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' } },
      })
    }
  } catch {}
}

let _wasSaveTimer = null
function wasSave() {
  clearTimeout(_wasSaveTimer)
  _wasSaveTimer = setTimeout(async () => {
    const { cards, edgeTypes } = $.learn()
    const path = wasPath(_boardId)
    const json = JSON.stringify({ cards, edgeTypes })
    try {
      await wasDel(path).catch(() => null)
      await wasPut(path, json, { type: 'application/json' })
    } catch {}
  }, 1500)
}

function subscribe(target) {
  if (!history.state?.type) {
    history.replaceState({ type: 'bulletin-board-launch', href: null }, '', location.href)
  }
  const id = _boardId
  let _braidInitDone = false
  braid.fetch(boardUrl(id), {
    subscribe: true,
    headers: { 'accept': 'application/json' },
  }).then(async res => {
    for await (const { body } of res) {
      if (!body) continue
      try {
        const data = JSON.parse(body)
        if (data.cards) {
          if (!_braidInitDone) {
            _braidInitDone = true
            const { cards: localCards } = $.learn()
            const localCount = Object.keys(localCards || {}).length
            const braidCount = Object.keys(data.cards).length
            if (braidCount <= localCount) {
              // WAS had more — push our state into braid so other tabs sync
              save(target)
              continue
            }
          }
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
  const { cards, edgeTypes } = $.learn()
  const author = getKeycard()?.asJSON?.controller || null
  fetch(boardUrl(_boardId), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cards, edgeTypes, author }),
  }).catch(() => {})
  wasSave()
  broadcastElf(tag, { cards, edgeTypes })
}

// ── card operations ──────────────────────────────────────────────────────────

function createCard(x, y, w, h) {
  const id = crypto.randomUUID()
  const { cards, trayZ } = $.learn()
  const author = getKeycard()?.asJSON?.controller || null
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
        href: '',
        createdAt: Date.now(),
        startDate: '',
        endDate: '',
        links: {},
        backlinks: {},
        author,
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
      ${card.author ? `<span class="card-author" title="${escapeHtml(card.author)}">${card.author.slice(-8)}</span>` : ''}
      ${card.href ? `<button class="card-play" data-play-card="${id}" title="open"><sl-icon name="play-fill"></sl-icon></button>` : ''}
    </div>
  `
}

function renderInspectorBody(id, cards, edgeTypes = {}) {
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
      <dt>Href</dt><dd><input class="sidebar-href" type="url" data-href-card="${id}" value="${escapeHtml(card.href || '')}" placeholder="https://..."></dd>
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
      <dt>Author</dt><dd><span class="sidebar-author" title="${escapeHtml(card.author || 'unknown')}">${card.author ? card.author.slice(-8) : '—'}</span></dd>
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

function renderAttachments(cardId, card) {
  const attachments = Object.entries(card.attachments || {})
  return `
    <div class="attach-gallery">
      ${attachments.map(([aid, att]) => `
        <button class="attach-thumb" data-open-attachment="${aid}" data-card-id="${cardId}" title="open ${att.type}">
          <canvas class="fb-thumb-canvas" width="80" height="60" data-fb-path="${escapeHtml(att.fbId)}"></canvas>
          <span class="attach-label"><sl-icon name="film"></sl-icon></span>
        </button>
      `).join('')}
      <button class="attach-add" data-add-fb="${cardId}">
        <sl-icon name="plus-circle"></sl-icon>
        <span>flip-book</span>
      </button>
    </div>
  `
}

function renderSidebarSections(id, cards, edgeTypes, inspectorOpen, attachmentsOpen) {
  const card = cards[id]
  if (!card) return '<p class="sidebar-empty">Card not found.</p>'
  return `
    <div class="sidebar-section">
      <button class="section-toggle" data-toggle-section="inspector">
        <sl-icon name="${inspectorOpen ? 'chevron-down' : 'chevron-right'}" class="section-chevron"></sl-icon>
        <span>Inspector</span>
      </button>
      <div class="section-body${inspectorOpen ? '' : ' section-collapsed'}">
        ${renderInspectorBody(id, cards, edgeTypes)}
      </div>
    </div>
    <div class="sidebar-section">
      <button class="section-toggle" data-toggle-section="attachments">
        <sl-icon name="${attachmentsOpen ? 'chevron-down' : 'chevron-right'}" class="section-chevron"></sl-icon>
        <span>Attachments</span>
      </button>
      <div class="section-body${attachmentsOpen ? '' : ' section-collapsed'}">
        ${renderAttachments(id, card)}
      </div>
    </div>
  `
}

async function loadFbThumb(canvas, wasPath) {
  try {
    const blob = await wasGet(wasPath + '.flip-book.json')
    if (!blob) return
    const state = JSON.parse(await blob.text())
    const { frames, frameStrokes, canvasW = 320, canvasH = 240 } = state
    if (!frames?.length) return
    const strokes = frameStrokes?.[frames[0]] || []
    if (!strokes.length) return
    const ctx = canvas.getContext('2d')
    const scaleX = canvas.width / canvasW
    const scaleY = canvas.height / canvasH
    const scale = Math.min(scaleX, scaleY)
    ctx.save()
    ctx.scale(scale, scale)
    strokes.forEach(stroke => {
      if (stroke?.length === 1 && stroke[0].fill) return
      if (!stroke || stroke.length < 2) return
      let curX = stroke[0].x, curY = stroke[0].y
      for (let i = 1; i < stroke.length; i++) {
        const pt = stroke[i]
        const endX = i < stroke.length - 1 ? (stroke[i].x + stroke[i+1].x) / 2 : stroke[i].x
        const endY = i < stroke.length - 1 ? (stroke[i].y + stroke[i+1].y) / 2 : stroke[i].y
        ctx.beginPath()
        ctx.moveTo(curX, curY)
        ctx.strokeStyle = pt.erase ? 'rgba(0,0,0,1)' : (pt.color || '#ebdbb2')
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.globalAlpha = pt.opacity ?? 1
        ctx.lineWidth = pt.lineWidth || 8
        if (i < stroke.length - 1) ctx.quadraticCurveTo(pt.x, pt.y, endX, endY)
        else ctx.lineTo(endX, endY)
        ctx.stroke()
        curX = endX; curY = endY
      }
    })
    ctx.restore()
  } catch {}
}

function queueThumbLoad(sidebarEl) {
  sidebarEl.querySelectorAll('[data-fb-path]').forEach(canvas => {
    loadFbThumb(canvas, canvas.dataset.fbPath)
  })
}

function renderCardMini(id, card) {
  if (!card) return ''
  const contrast = contrastColor(card.color || 'lemonchiffon')
  return `<div data-goto-card="${id}"
    style="background:${card.color || 'lemonchiffon'}; border-radius:2px; padding:.5rem .65rem; min-height:3rem; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.08), 0 3px 8px rgba(0,0,0,.08), 0 6px 20px rgba(0,0,0,.06); transition:box-shadow .15s;">
    <div style="font-size:.75rem; line-height:1.4; color:${contrast}; white-space:pre-wrap; word-break:break-word; pointer-events:none;">${escapeHtml(card.text?.slice(0, 120) || '')}</div>
  </div>`
}

function renderEdgeModalInner(linkId, fromCardId, cards, edgeTypes) {
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
    <div data-link-id="${linkId}" data-from-card="${fromCardId}"
      style="width:100%; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.18), 0 1px 4px rgba(0,0,0,.12); font-family:'Recursive',sans-serif;">
      <div data-edge-header style="background:${edgeColor}; padding:.5rem .75rem; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(0,0,0,.1);">
        <span data-edge-contrast style="font-family:'Recursive',sans-serif; font-size:.8rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:${edgeContrast};">Relationship Manager</span>
        <div style="display:flex; align-items:center; gap:.5rem;">
          <span data-edge-contrast data-edge-type-label style="font-family:'Recursive',sans-serif; font-size:.7rem; color:${edgeContrast}; opacity:.7;">${escapeHtml(edgeName)}</span>
          <button data-delete-link="${linkId}" data-from-card="${fromCardId}"
            style="background:rgba(0,0,0,.25); border:none; border-radius:3px; color:${edgeContrast}; cursor:pointer; font-size:.7rem; padding:.15rem .4rem; font-family:'Recursive',sans-serif; opacity:.7; transition:opacity .1s;"
            onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7"
            title="delete this relationship">✕ delete</button>
        </div>
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
  `
}

function openEdgeModal(linkId, fromCardId) {
  showModal(`<div data-modal-close style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:2rem;box-sizing:border-box;"><${tag} shell="true" data-link-id="${linkId}" data-from-card="${fromCardId}" style="display:block;width:100%;max-width:560px;"></${tag}></div>`)
}

function updateShell(target) {
  const linkId = target.dataset.linkId
  const fromCardId = target.dataset.fromCard
  const { cards, edgeTypes } = $.learn()

  if (!target.querySelector('[data-edge-header]')) {
    target.innerHTML = renderEdgeModalInner(linkId, fromCardId, cards, edgeTypes)
    return null
  }

  const allTypes = { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' }, ...edgeTypes }
  const link = cards[fromCardId]?.links?.[linkId]
  if (!link) return null
  const typeId = link.typeId || HYPER_ID
  const color = allTypes[typeId]?.color || 'dodgerblue'
  const name = allTypes[typeId]?.name || 'hyper'
  const contrast = contrastColor(color)

  const header = target.querySelector('[data-edge-header]')
  if (header) header.style.background = color
  const dot = target.querySelector('[data-edge-dot]')
  if (dot) dot.style.background = color
  const body = target.querySelector('[data-edge-body]')
  if (body) body.style.background = `color-mix(in srgb, ${color} 10%, white)`
  target.querySelectorAll('[data-edge-contrast]').forEach(el => el.style.color = contrast)
  const paletteWrap = target.querySelector('[data-palette-edge]')
  if (paletteWrap) paletteWrap.style.visibility = name === 'hyper' ? 'hidden' : 'visible'
  const typeLabel = target.querySelector('[data-edge-type-label]')
  if (typeLabel) typeLabel.textContent = name

  return null
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

function patchPeerArrows() {
  const linksLayer = document.querySelector(`${tag} .links-layer`)
  if (!linksLayer) return
  const { cards, players } = $.learn()
  const now = Date.now()
  Object.entries(players || {}).forEach(([id, p]) => {
    if (!p || id === PLAN98_NODE_ID) return
    if (now - (p.ts || 0) > 5000) return
    const card = cards[p.cardId]
    if (!card) return
    const peerCard = { ...card, x: p.x, y: p.y }
    Object.entries(card.links || {}).forEach(([linkId, link]) => {
      const toCard = cards[link.to]
      if (!toCard) return
      const g = linksLayer.querySelector(`g[data-link-id="${linkId}"]`)
      if (!g) return
      const [fromDir, toDir] = bestCompassPair(peerCard, toCard)
      const [x1, y1] = exitPoint(peerCard, fromDir)
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
      const g = linksLayer.querySelector(`g[data-link-id="${linkId}"]`)
      if (!g) return
      const [fromDir, toDir] = bestCompassPair(fromCard, peerCard)
      const [x1, y1] = exitPoint(fromCard, fromDir)
      const [x2, y2] = exitPoint(peerCard, toDir)
      g.querySelectorAll('line').forEach(l => {
        l.setAttribute('x1', x1); l.setAttribute('y1', y1)
        l.setAttribute('x2', x2); l.setAttribute('y2', y2)
      })
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

      // Sync play button
      const existingPlay = el.querySelector('.card-play')
      if (card.href && !existingPlay) {
        const btn = document.createElement('button')
        btn.className = 'card-play'
        btn.dataset.playCard = id
        btn.title = `open`
        btn.innerHTML = '<sl-icon name="play-fill"></sl-icon>'
        el.appendChild(btn)
      } else if (!card.href && existingPlay) {
        existingPlay.remove()
      }
    }
  }

  // Remove deleted cards
  cardsLayer.querySelectorAll('.card[data-id]').forEach(el => {
    if (!seen.has(el.dataset.id)) el.remove()
  })
}

const MODE_META = {
  pan:    { icon: 'arrows-move',   color: 'mediumseagreen' },
  link:   { icon: 'link-45deg',    color: 'dodgerblue'     },
  manage: { icon: 'pencil-square', color: 'firebrick'      },
  browse: { icon: 'folder2-open',  color: 'darkorange'     },
  camera: { icon: 'camera-fill',   color: 'mediumpurple'   },
}

function renderCompassButtons(mode) {
  return `
    <button class="c-manage${mode === 'manage' ? ' active' : ''}" data-mode="manage" title="manage cards">
      <sl-icon name="pencil-square"></sl-icon>
    </button>
    <button class="c-browse${mode === 'browse' ? ' active' : ''}" data-mode="browse" title="browse files">
      <sl-icon name="folder2-open"></sl-icon>
    </button>
    <button class="c-qr" data-action="qr" title="share via QR">
      <sl-icon name="qr-code"></sl-icon>
    </button>
    <button class="c-move${mode === 'pan' ? ' active' : ''}" data-mode="pan" title="move canvas">
      <sl-icon name="arrows-move"></sl-icon>
    </button>
    <button class="c-link${mode === 'link' ? ' active' : ''}" data-mode="link" title="link cards">
      <sl-icon name="link-45deg"></sl-icon>
    </button>
    <button class="c-camera${mode === 'camera' ? ' active' : ''}" data-mode="camera" title="camera">
      <sl-icon name="camera-fill"></sl-icon>
    </button>
  `
}

// ── draw ──────────────────────────────────────────────────────────────────────

$.draw(target => {
  if (target.getAttribute('shell')) return updateShell(target)
  if (target.innerHTML) return update(target)
  mount(target)
}, { beforeUpdate, afterUpdate })

function beforeUpdate(target) {
  const { beltGrabbed, mode } = $.learn()
  target.dataset.belt = beltGrabbed ? 'true' : 'false'
  target.dataset.mode = mode || 'pan'
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
      <button class="root" data-toggle-menu title="menu (drag to move)" style="background:${(MODE_META[mode] || MODE_META.pan).color}"><sl-icon name="${(MODE_META[mode] || MODE_META.pan).icon}"></sl-icon></button>
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
    <div class="card-launch" data-open="false"></div>
    <div class="camera-overlay" data-open="false"></div>
  `

  target.querySelector('.bulletin-canvas').style.backgroundImage = stars
  wasLoad().then(() => {
    subscribe(target)
    linkState(tag, _boardId)
    if (!_peerArrowInterval) {
      _peerArrowInterval = setInterval(patchPeerArrows, 83)
    }
  })
}

function update(target) {
  const { panX, panY, zoom, cards, mode, menuOpen, beltOffsetX, beltOffsetY,
          focusedCard, linkSource, isDrawing, createStartX, createStartY, createX, createY,
          sidebarOpen, sidebarCard, grabbing, edgeTypes, launchHref, players,
          inspectorOpen, attachmentsOpen } = $.learn()

  const workspace = target.querySelector('.workspace')
  workspace.style.setProperty('--pan-x', panX + 'px')
  workspace.style.setProperty('--pan-y', panY + 'px')
  workspace.style.setProperty('--zoom', zoom)

  const compass = target.querySelector('.the-compass')
  compass.dataset.open = menuOpen
  compass.style.setProperty('--belt-offset-x', beltOffsetX + 'px')
  compass.style.setProperty('--belt-offset-y', beltOffsetY + 'px')

  compass.querySelectorAll('[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode)
  })

  const rootBtn = compass.querySelector('.root')
  if (rootBtn) {
    const md = MODE_META[mode] || MODE_META.pan
    rootBtn.style.background = md.color
    const icon = rootBtn.querySelector('sl-icon')
    if (icon) icon.setAttribute('name', md.icon)
  }

  const launchEl = target.querySelector('.card-launch')
  if (launchEl) {
    const currentHref = launchEl.dataset.href || ''
    launchEl.dataset.open = launchHref ? 'true' : 'false'
    if ((launchHref || '') !== currentHref) {
      launchEl.dataset.href = launchHref || ''
      launchEl.innerHTML = launchHref ? `<iframe src="${escapeHtml(launchHref)}"></iframe>` : ''
    }
  }

  const cardsLayer = target.querySelector('.cards-layer')
  patchCardsLayer(cardsLayer, cards, focusedCard, linkSource, grabbing)
  applyPeerPositions(cardsLayer, players)

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
    const attachSig = Object.keys(card?.attachments || {}).join(',')
    const sectionSig = `${inspectorOpen}|${attachmentsOpen}`
    const cardSwitched = sidebarBody.dataset.card !== sidebarCard
      || sidebarBody.dataset.etSig !== etSig
      || sidebarBody.dataset.linkTypeSig !== linkTypeSig
      || sidebarBody.dataset.attachSig !== attachSig
      || sidebarBody.dataset.sectionSig !== sectionSig
    if (cardSwitched) {
      sidebarBody.innerHTML = renderSidebarSections(sidebarCard, cards, edgeTypes, inspectorOpen, attachmentsOpen)
      sidebarBody.dataset.card = sidebarCard
      sidebarBody.dataset.etSig = etSig
      sidebarBody.dataset.linkTypeSig = linkTypeSig
      sidebarBody.dataset.attachSig = attachSig
      sidebarBody.dataset.sectionSig = sectionSig
      queueThumbLoad(sidebarBody)
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

  if (mode === 'manage') {
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

  if (mode === 'manage' && isDrawing) {
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

  if (mode === 'manage' && isDrawing) {
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
  // ── resize handle (manage mode only) ──
  const resizeEl = e.target.closest('.card-resize-se')
  if (resizeEl) {
    if ($.learn().mode !== 'manage') return
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

  // ── card drag (manage mode only) ──
  // Skip dedicated button handlers — they manage their own events
  if (e.target.closest('.card-close') || e.target.closest('.card-pencil') || e.target.closest('.card-play')) return

  const cardEl = e.target.closest('.card')
  if (!cardEl) return

  const id = cardEl.dataset.id

  // Let focused textarea handle its own text editing
  if (e.target.closest('.card-body') && $.learn().focusedCard === id) return

  if ($.learn().mode !== 'manage') return

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
  _arrowInterval = setInterval(() => { patchGrabArrows(id); patchPeerArrows() }, 83)
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

$.when('click', '[data-toggle-section]', e => {
  const section = e.target.closest('[data-toggle-section]')?.dataset.toggleSection
  if (section === 'inspector') $.teach({ inspectorOpen: !$.learn().inspectorOpen })
  else if (section === 'attachments') $.teach({ attachmentsOpen: !$.learn().attachmentsOpen })
})

$.when('click', '[data-add-fb]', e => {
  const cardId = e.target.closest('[data-add-fb]')?.dataset.addFb
  if (!cardId) return
  const { cards } = $.learn()
  const card = cards[cardId]
  if (!card) return
  const attachId = crypto.randomUUID()
  const fbId = `/bb/${_boardId}/${attachId}`
  const attachments = { ...(card.attachments || {}), [attachId]: { type: 'flip-book', fbId, createdAt: new Date().toISOString() } }
  updateCard(cardId, { attachments })
  save(document.querySelector(tag))
  $.teach({ launchHref: `/app/flip-book?id=${encodeURIComponent(fbId)}` })
})

$.when('click', '[data-open-attachment]', e => {
  const btn = e.target.closest('[data-open-attachment]')
  if (!btn) return
  const { cards } = $.learn()
  const att = cards[btn.dataset.cardId]?.attachments?.[btn.dataset.openAttachment]
  if (!att) return
  $.teach({ launchHref: `/app/flip-book?id=${encodeURIComponent(att.fbId)}` })
})

// ── edge modal ────────────────────────────────────────────────────────────────

$.when('click', '[data-open-edge]', e => {
  openEdgeModal(e.target.dataset.openEdge, e.target.dataset.fromCard)
})

// Modal renders outside bulletin-board — use document listeners for modal interactions
document.addEventListener('click', e => {
  const delBtn = e.target.closest('[data-delete-link]')
  if (delBtn) {
    const linkId = delBtn.dataset.deleteLink
    const fromCardId = delBtn.dataset.fromCard
    const { cards } = $.learn()
    const fromCard = cards[fromCardId]
    const link = fromCard?.links?.[linkId]
    if (link) {
      const toId = link.to
      const fromLinks = { ...fromCard.links }
      delete fromLinks[linkId]
      const toCard = cards[toId]
      const toBacklinks = { ...(toCard?.backlinks || {}) }
      delete toBacklinks[linkId]
      $.teach({
        cards: {
          ...cards,
          [fromCardId]: { ...fromCard, links: fromLinks },
          ...(toCard ? { [toId]: { ...toCard, backlinks: toBacklinks } } : {}),
        }
      })
      save(document.querySelector(tag))
    }
    hideModal()
    return
  }

  const btn = e.target.closest('[data-goto-card]')
  if (btn) {
    hideModal()
    panToCard(btn.dataset.gotoCard)
    return
  }
  const g = e.target.closest('g[data-link-id]')
  if (!g) return
  const linkId = g.dataset.linkId
  const { cards } = $.learn()
  let fromCardId = null
  outer: for (const [cid, card] of Object.entries(cards)) {
    for (const lid of Object.keys(card.links || {})) {
      if (lid === linkId) { fromCardId = cid; break outer }
    }
  }
  if (!fromCardId) return
  openEdgeModal(linkId, fromCardId)
})

$.when('change', '.edge-type-input', e => {
  const { linkId, fromCard: fromCardId } = e.target.dataset
  const name = e.target.value.trim()
  if (!linkId || !fromCardId || !name) return
  const { cards, edgeTypes } = $.learn()
  const fromCard = cards[fromCardId]
  const link = fromCard?.links?.[linkId]
  if (!link) return
  const typeId = createEdgeType(name, edgeTypes[link.typeId]?.color || 'dodgerblue')
  const updatedLink = { ...link, typeId }
  $.teach({
    cards: { ...cards, [fromCardId]: { ...fromCard, links: { ...fromCard.links, [linkId]: updatedLink } } }
  })
  save(document.querySelector(tag))
})

$.when('input', 'plan98-palette', e => {
  const cardWrap = e.target.closest('[data-palette-card]')
  if (cardWrap) {
    const id = cardWrap.dataset.paletteCard
    const color = e.detail?.color
    if (!id || !color) return
    updateCard(id, { color })
    const cardEl = document.querySelector(`.card[data-id="${id}"]`)
    if (cardEl) cardEl.style.background = color
    save(e.target.closest(tag))
    return
  }
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
  save(document.querySelector(tag))
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
      broadcastPresence(grabbing, dragCardX, dragCardY)
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
    if (beltDragMoved) {
      const host = document.querySelector(tag)
      const compassEl = host?.querySelector('.the-compass')
      const hostW = host ? host.clientWidth : window.innerWidth
      const hostH = host ? host.clientHeight : window.innerHeight
      const cW = compassEl ? compassEl.offsetWidth : 160
      const cH = compassEl ? compassEl.offsetHeight : 160
      const newX = beltOffsetX + dx
      const newY = beltOffsetY + dy
      $.teach({
        beltOffsetX: Math.max(-(hostW - cW), Math.min(0, newX)),
        beltOffsetY: Math.max(-(hostH - cH), Math.min(0, newY)),
      })
    }
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
    clearPresence()
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
    clearPresence()
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
  const { mode: prev } = $.learn()
  const next = btn.dataset.mode

  // tear down previous overlay
  if (prev === 'camera') closeCamera(false)
  if (prev === 'browse') $.teach({ launchHref: null })

  // open new overlay
  if (next === 'camera') openCamera()
  else if (next === 'browse') {
    const href = '/app/lore-baby'
    $.teach({ launchHref: href })
    history.pushState({ type: 'bulletin-board-launch', href }, '', href)
  }

  $.teach({ mode: next, menuOpen: false, linkSource: null })
})

// ── sidebar href field ────────────────────────────────────────────────────────

$.when('change', '.sidebar-href', e => {
  const id = e.target.dataset.hrefCard
  if (!id) return
  updateCard(id, { href: e.target.value.trim() })
  save(e.target.closest(tag))
})

// ── play button: launch card href in full-screen iframe ───────────────────────

$.when('click', '.card-play', e => {
  e.stopPropagation()
  const btn = e.target.closest('[data-play-card]')
  if (!btn) return
  const { cards } = $.learn()
  const href = cards[btn.dataset.playCard]?.href
  if (!href) return
  $.teach({ launchHref: href })
  history.pushState({ type: 'bulletin-board-launch', href }, '', href)
})

// ── compass action buttons ────────────────────────────────────────────────────

$.when('click', '[data-action]', e => {
  const btn = e.target.closest('[data-action]')
  if (!btn) return
  const action = btn.dataset.action
  $.teach({ menuOpen: false })

  if (action === 'qr') {
    const { focusedCard } = $.learn()
    const base = `${location.origin}/app/bulletin-board?id=${_boardId}`
    const url = focusedCard ? `${base}&card=${focusedCard}&sidebar=open` : base
    showModal(`<div data-modal-close style="display:flex;align-items:center;justify-content:center;min-height:100%;padding:2rem;box-sizing:border-box;"><div style="width:240px;background:white;padding:1rem;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.2);"><qr-code src="${escapeHtml(url)}" no-link="true"></qr-code><p style="text-align:center;font-family:'Recursive',sans-serif;font-size:.65rem;word-break:break-all;margin:.5rem 0 0;color:#555;">${escapeHtml(url)}</p></div></div>`)
  }
})

// ── camera overlay (imperative — not through $.draw) ─────────────────────────

let _cameraStream = null

async function openCamera() {
  const host = document.querySelector(tag)
  if (!host) return
  const overlay = host.querySelector('.camera-overlay')
  if (!overlay) return

  try {
    _cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    const video = document.createElement('video')
    video.muted = true; video.autoplay = true; video.playsInline = true
    video.style.cssText = 'width:100%;max-width:480px;border-radius:6px;display:block;'
    video.srcObject = _cameraStream

    const closeBtn = document.createElement('button')
    closeBtn.className = 'camera-close-btn'
    closeBtn.innerHTML = '✕'
    closeBtn.onclick = closeCamera

    const captureBtn = document.createElement('button')
    captureBtn.className = 'camera-capture-btn'
    captureBtn.innerHTML = '<sl-icon name="camera-fill"></sl-icon> capture'
    captureBtn.onclick = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      canvas.getContext('2d').drawImage(video, 0, 0)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `capture-${Date.now()}.png`
      a.click()
    }

    overlay.innerHTML = ''
    overlay.appendChild(closeBtn)
    overlay.appendChild(video)
    overlay.appendChild(captureBtn)
    overlay.dataset.open = 'true'
    await video.play().catch(() => {})
  } catch {
    overlay.innerHTML = '<p class="camera-err">Camera access denied</p>'
    overlay.dataset.open = 'true'
  }
}

function closeCamera(resetMode = true) {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(t => t.stop())
    _cameraStream = null
  }
  const overlay = document.querySelector(`${tag} .camera-overlay`)
  if (overlay) { overlay.innerHTML = ''; overlay.dataset.open = 'false' }
  if (resetMode && $.learn().mode === 'camera') $.teach({ mode: 'pan' })
}

// ── launch iframe: popstate closes it ────────────────────────────────────────

window.addEventListener('popstate', e => {
  const { type, href } = e.state || {}
  if (type === 'bulletin-board-launch') {
    $.teach({ launchHref: href || null })
    if (!href && $.learn().mode === 'browse') $.teach({ mode: 'pan' })
  }
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

  & [data-mode="pan"] .card {
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
    z-index: 200;
    display: grid;
    grid-template-columns: repeat(6, calc(10rem / 6));
    grid-template-rows: repeat(6, calc(10rem / 6));
    width: 10rem;
    height: 10rem;
    pointer-events: none;
    transform: translate(var(--belt-offset-x, 0), var(--belt-offset-y, 0));
  }

  & .the-compass button {
    position: relative;
    pointer-events: all;
    border: none;
    border-radius: 50%;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    box-shadow: 0 2px 8px rgba(0,0,0,.35);
    transition: transform .15s, opacity .15s, filter .1s;
    touch-action: none;
    user-select: none;
    overflow: hidden;
  }

  & .the-compass button * { pointer-events: none; }
  & .the-compass button:hover { filter: brightness(1.18); }
  & .the-compass button.active { box-shadow: 0 0 0 3px rgba(255,255,255,.6), 0 2px 8px rgba(0,0,0,.35); filter: brightness(1.1); }

  & .the-compass .root {
    grid-row: 3/5; grid-column: 3/5;
    background: #1a1a1a;
    border: 2px solid rgba(255,255,255,.3);
    z-index: 1;
    cursor: grab;
    font-size: 1.3rem;
  }
  & .the-compass .root:active { cursor: grabbing; }

  /* hex petals — 1 o'clock clockwise */
  & .the-compass .c-manage { grid-row: 1/3; grid-column: 4/6; background: firebrick; }
  & .the-compass .c-browse { grid-row: 3/5; grid-column: 5/7; background: darkorange; }
  & .the-compass .c-qr     { grid-row: 5/7; grid-column: 4/6; background: gold; color: #333; }
  & .the-compass .c-move   { grid-row: 5/7; grid-column: 2/4; background: mediumseagreen; }
  & .the-compass .c-link   { grid-row: 3/5; grid-column: 1/3; background: dodgerblue; }
  & .the-compass .c-camera { grid-row: 1/3; grid-column: 2/4; background: mediumpurple; }

  & .the-compass[data-open="false"] button:not(.root) {
    opacity: 0; pointer-events: none; transform: scale(0.4);
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
    padding: 0;
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

  & .sidebar-section {
    border-bottom: 1px solid rgba(0,0,0,.07);
  }

  & .section-toggle {
    display: flex;
    align-items: center;
    gap: .35rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: .45rem .75rem;
    font-family: 'Recursive', sans-serif;
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: rgba(0,0,0,.45);
    text-align: left;
    transition: color .1s, background .1s;
  }
  & .section-toggle:hover { background: rgba(0,0,0,.04); color: rgba(0,0,0,.7); }

  & .section-chevron { font-size: .75rem; flex-shrink: 0; }

  & .section-body {
    padding: .5rem .75rem .75rem;
    overflow: hidden;
  }
  & .section-body.section-collapsed { display: none; }

  & .attach-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: .5rem;
  }

  & .attach-thumb {
    background: rgba(0,0,0,.05);
    border: 1.5px solid rgba(0,0,0,.1);
    border-radius: 4px;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    transition: border-color .15s, box-shadow .15s;
    aspect-ratio: 4/3;
  }
  & .attach-thumb:hover { border-color: dodgerblue; box-shadow: 0 0 0 2px rgba(30,144,255,.2); }

  & .fb-thumb-canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    background: #1d2021;
  }

  & .attach-label {
    position: absolute;
    bottom: 2px; right: 4px;
    font-size: .6rem;
    color: rgba(255,255,255,.6);
  }

  & .attach-add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .25rem;
    background: none;
    border: 1.5px dashed rgba(0,0,0,.2);
    border-radius: 4px;
    padding: .5rem .25rem;
    cursor: pointer;
    font-family: 'Recursive', sans-serif;
    font-size: .6rem;
    color: rgba(0,0,0,.4);
    aspect-ratio: 4/3;
    transition: border-color .15s, color .15s;
  }
  & .attach-add:hover { border-color: dodgerblue; color: dodgerblue; }
  & .attach-add sl-icon { font-size: 1.1rem; }

  /* ── play button ── */

  & .card-play {
    position: absolute;
    bottom: 3px; left: 3px;
    width: 18px; height: 18px;
    background: none;
    border: none;
    color: var(--card-contrast, #1a1a1a);
    opacity: 0.35;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: .75rem;
    padding: 0;
    pointer-events: all;
    z-index: 3;
    transition: opacity .1s;
    border-radius: 2px;
  }
  & .card-play * { pointer-events: none; }
  & .card-play:hover { opacity: 1; }

  & .card-author {
    position: absolute;
    bottom: 3px; right: 6px;
    font-size: .55rem;
    font-family: monospace;
    color: var(--card-contrast, #1a1a1a);
    opacity: 0.3;
    pointer-events: none;
    letter-spacing: .02em;
  }

  /* ── card launch overlay ── */

  & .card-launch {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: none;
    pointer-events: none;
  }
  & .card-launch[data-open="true"] {
    display: block;
    pointer-events: all;
  }
  & .card-launch iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }

  /* ── camera overlay ── */

  & .camera-overlay {
    position: absolute;
    inset: 0;
    z-index: 60;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    background: rgba(0,0,0,.85);
    backdrop-filter: blur(6px);
    padding: 2rem;
    box-sizing: border-box;
  }
  & .camera-overlay[data-open="true"] { display: flex; }

  & .camera-close-btn {
    position: absolute;
    top: .75rem; right: .75rem;
    background: rgba(255,255,255,.15);
    border: 1px solid rgba(255,255,255,.3);
    color: white;
    width: 32px; height: 32px;
    border-radius: 50%;
    cursor: pointer;
    font-size: .9rem;
    display: flex; align-items: center; justify-content: center;
  }
  & .camera-close-btn:hover { background: rgba(255,255,255,.25); }

  & .camera-capture-btn {
    background: mediumpurple;
    border: none;
    color: white;
    padding: .5rem 1.25rem;
    border-radius: 4px;
    cursor: pointer;
    font-family: 'Recursive', sans-serif;
    font-size: .85rem;
    display: flex; align-items: center; gap: .4rem;
  }
  & .camera-capture-btn:hover { filter: brightness(1.15); }

  & .camera-err {
    color: rgba(255,255,255,.6);
    font-family: 'Recursive', sans-serif;
    font-size: .85rem;
    text-align: center;
  }

  /* edge modal renders outside this element — all styles are inlined in renderEdgeModal */

  /* ── peer drag — outline on the real card while a remote peer holds it ── */

  & .card[data-peer-drag] {
    box-shadow:
      0 8px 16px rgba(0,0,0,.10),
      0 20px 48px rgba(0,0,0,.12),
      0 40px 80px rgba(0,0,0,.08);
  }
`)
