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
import { checkButton } from './debug-gamepads.js'
import * as braid from 'braid-http'
import { showModal, hideModal } from '@plan98/modal'
import { showPanel, hidePanel } from './plan98-panel.js'
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
  parkInspectorId: null,
  parkInspectorCardIds: [],
  openedFromOs: false,
  launchHref: null,
  preLaunchMode: null,
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
  logsOpen: true,
  ops: [],
  _rejectedOps: [],
  edgeTypes: { [HYPER_ID]: { name: 'hyper', color: 'dodgerblue' } },
  players: {},
  ioMode: null,
  ioEngine: null,
  ioStatus: '',
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

let _viewportBroadcastInterval = null
function startViewportBroadcast() {
  if (_viewportBroadcastInterval) return
  _viewportBroadcastInterval = setInterval(() => {
    const { panX, panY, mode } = $.learn()
    if (mode === 'os') return  // generic-park handles 3D position
    broadcastElf(tag, { players: { [PLAN98_NODE_ID]: { bx: -panX, by: -panY, mode: 'pan', ts: Date.now() } } }, PLAYERS_MERGE)
  }, 2000)
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

function wasJsonPath(id) {
  return `/bulletin-board/${id || 'default'}.json`
}

function wasTtlPath(id) {
  return `/bulletin-board/${id || 'default'}.ttl`
}

async function upsertBayunGroup(groupId) {
  try {
    const { getSession, bayunCore } = await import('./cyber-security.js')
    const { sessionId } = getSession()
    if (!sessionId || !bayunCore || !groupId) return
    try {
      await bayunCore.getGroupById({ sessionId, groupId })
    } catch {
      try { await bayunCore.joinPublicGroup({ sessionId, groupId }) } catch {}
    }
  } catch {}
}

async function wasLoad() {
  await ensureSpace().catch(() => null)
  // TTL is canonical — fall back to JSON for boards not yet migrated
  try {
    const blob = await wasGet(wasTtlPath(_boardId))
    if (blob) {
      const { turtleToBoard } = await import('./solid-utils.js')
      const { cards, edgeTypes, groupId } = await turtleToBoard(await blob.text())
      $.teach({ cards, edgeTypes, ...(groupId ? { boardGroupId: groupId } : {}) })
      if (groupId) upsertBayunGroup(groupId)
      return
    }
  } catch {}
  try {
    const blob = await wasGet(wasJsonPath(_boardId))
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
    try {
      const { boardToTurtle } = await import('./solid-utils.js')
      const { boardGroupId } = $.learn()
      const ttl = await boardToTurtle(_boardId || 'default', cards, edgeTypes, boardGroupId || null)
      const path = wasTtlPath(_boardId)
      await wasDel(path).catch(() => null)
      await wasPut(path, ttl, { type: 'text/turtle' })
    } catch {}
  }, 1500)
}

// ── op log ────────────────────────────────────────────────────────────────────

function wasOpsPath(id) {
  return `/bulletin-board/${id || 'default'}.ops.json`
}

async function wasLoadOps() {
  try {
    const blob = await wasGet(wasOpsPath(_boardId))
    if (!blob) return
    const data = JSON.parse(await blob.text())
    if (Array.isArray(data?.ops)) $.teach({ ops: data.ops })
  } catch {}
}

let _wasSaveOpsTimer = null
function wasSaveOps() {
  clearTimeout(_wasSaveOpsTimer)
  _wasSaveOpsTimer = setTimeout(async () => {
    const { ops } = $.learn()
    const path = wasOpsPath(_boardId)
    const json = JSON.stringify({ ops })
    try {
      await wasDel(path).catch(() => null)
      await wasPut(path, json, { type: 'application/json' })
    } catch {}
  }, 1500)
}

function rejectedKey() { return `bb-rejected:${_boardId}` }
function getRejected() {
  try { return new Set(JSON.parse(localStorage.getItem(rejectedKey()) || '[]')) }
  catch { return new Set() }
}
function setRejected(set) {
  localStorage.setItem(rejectedKey(), JSON.stringify([...set]))
  $.teach({ _rejectedOps: [...set] })
}

const _opDebounce = new Map()
const OP_DEBOUNCE_MS = 2000

function appendOp(cardId, op, payload) {
  const author = getKeycard()?.asJSON?.controller || null
  const id = crypto.randomUUID()
  const ts = Date.now()
  const rec = { id, cardId, op, payload, ts, author }

  if (op === 'update' && payload.updates) {
    const fields = Object.keys(payload.updates)
    if (fields.length === 1) {
      const dKey = `${cardId}:${fields[0]}`
      const lastId = _opDebounce.get(dKey)
      if (lastId) {
        const { ops } = $.learn()
        const idx = ops.findIndex(o => o.id === lastId)
        if (idx >= 0 && ts - ops[idx].ts < OP_DEBOUNCE_MS) {
          const next = [...ops]
          next[idx] = { ...ops[idx], payload: { ...payload, old: ops[idx].payload.old }, ts }
          $.teach({ ops: next })
          wasSaveOps()
          return
        }
      }
      _opDebounce.set(dKey, id)
    }
  }

  const { ops } = $.learn()
  $.teach({ ops: [...ops, rec] })
  wasSaveOps()
}

function deriveCardFromOps(cardId) {
  const { ops } = $.learn()
  const rejected = getRejected()
  let card = null
  for (const op of [...ops].filter(o => o.cardId === cardId).sort((a, b) => a.ts - b.ts)) {
    if (rejected.has(op.id)) continue
    if (op.op === 'create') card = { ...op.payload.card }
    else if (op.op === 'update' && card) card = { ...card, ...op.payload.updates }
    else if (op.op === 'delete') card = null
  }
  return card
}

function opSummary(op) {
  if (op.op === 'create') return 'card created'
  if (op.op === 'delete') return 'card deleted'
  if (op.op === 'link') {
    const { cards } = $.learn()
    const toCard = cards[op.payload.to]
    const label = (toCard?.text || op.payload.to || '').slice(0, 20)
    return `linked → ${label}`
  }
  if (op.op === 'update') {
    const keys = Object.keys(op.payload.updates || {})
    if (keys.includes('x') || keys.includes('y')) return 'moved'
    if (keys.includes('w') || keys.includes('h')) return 'resized'
    if (keys.length === 1) {
      const k = keys[0]
      const val = op.payload.updates[k]
      const old = op.payload.old?.[k]
      if (k === 'text') return `text: "${String(val || '').slice(0, 25)}"`
      if (k === 'color') return `color ${old || '?'} → ${val}`
      if (k === 'href') return `href: ${String(val).slice(0, 25)}`
      if (k === 'startDate') return `start: ${val}`
      if (k === 'endDate') return `end: ${val}`
      return `${k}: ${String(val).slice(0, 20)}`
    }
    return `updated: ${keys.join(', ')}`
  }
  return op.op
}

function relTime(ts) {
  const d = Date.now() - ts
  if (d < 60000) return 'just now'
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`
  return `${Math.round(d / 86400000)}d ago`
}

function htmlesc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderLogsBody(cardId, ops) {
  const cardOps = ops.filter(o => o.cardId === cardId).sort((a, b) => b.ts - a.ts)
  if (!cardOps.length) return '<p class="op-empty">No changes logged yet.</p>'
  const rejected = getRejected()
  const { cards } = $.learn()
  const live = cards[cardId]
  const derived = deriveCardFromOps(cardId)
  let derivedSection = ''
  if (rejected.size > 0 && derived && live) {
    const diffs = []
    if (derived.text !== live.text) diffs.push(`text: "${htmlesc((derived.text || '').slice(0, 30))}"`)
    if (derived.color !== live.color) diffs.push(`color: ${derived.color}`)
    if (diffs.length) {
      derivedSection = `<div class="op-derived">
        <span class="op-derived-label">Your canonical:</span>
        ${diffs.map(d => `<span class="op-derived-field">${d}</span>`).join('')}
      </div>`
    }
  }
  return derivedSection + cardOps.map(op => {
    const accepted = !rejected.has(op.id)
    return `<label class="op-row${accepted ? '' : ' op-rejected'}" data-op-id="${op.id}">
      <input type="checkbox" class="op-check" data-op-id="${op.id}"${accepted ? ' checked' : ''}>
      <span class="op-badge op-type-${op.op}">${op.op}</span>
      <span class="op-summary">${htmlesc(opSummary(op))}</span>
      <time class="op-ts" title="${new Date(op.ts).toISOString()}">${relTime(op.ts)}</time>
    </label>`
  }).join('')
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
            const { zoom } = $.learn()
            $.teach({
              ...clampPan(w / 2 - (card.x + card.w / 2) * zoom, h / 2 - (card.y + card.h / 2) * zoom, zoom),
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
  const card = {
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
  $.teach({
    cards: { ...cards, [id]: card },
    trayZ: trayZ + 1,
    focusedCard: id,
  })
  appendOp(id, 'create', { card })
  return id
}

function updateCard(id, updates) {
  const { cards } = $.learn()
  if (!cards[id]) return
  const old = {}
  Object.keys(updates).forEach(k => { old[k] = cards[id][k] })
  $.teach({ cards: { ...cards, [id]: { ...cards[id], ...updates } } })
  appendOp(id, 'update', { updates, old })
}

function deleteCard(id) {
  const { cards } = $.learn()
  const next = { ...cards }
  const card = next[id]
  appendOp(id, 'delete', { snapshot: card })
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
  const alreadyLinked = Object.values(cards[fromId].links || {}).some(l => l.to === toId && l.typeId === typeId)
  if (alreadyLinked) return
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
  appendOp(fromId, 'link', { linkId, from: fromId, to: toId, fromDir, toDir, typeId })
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
  const { cards, zoom } = $.learn()
  const card = cards[cardId]
  if (!card) return
  const host = document.querySelector(tag)
  if (!host) return
  const sidebar = host.querySelector('.card-sidebar')
  const sidebarW = sidebar?.dataset.open === 'true' ? (sidebar.offsetWidth || 280) : 0
  const vw = host.clientWidth
  const vh = host.clientHeight
  const panX = (vw - sidebarW) / 2 - (card.x + card.w / 2) * zoom
  const panY = vh / 2 - (card.y + card.h / 2) * zoom
  $.teach({ ...clampPan(panX, panY, zoom), focusedCard: cardId, sidebarCard: cardId, sidebarOpen: true })
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
        <div class="card-title-grab"></div>
        <button class="card-close" data-close-card="${id}" title="remove card"><sl-icon name="x-lg"></sl-icon></button>
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
    <div class="sidebar-palette-section">
      <div class="sidebar-label">Color</div>
      <div class="sidebar-palette-wrap" data-palette-card="${id}">
        <plan98-palette></plan98-palette>
      </div>
    </div>
  `
}

function renderAttachThumb(cardId, aid, att) {
  if (att.type === 'gallery') {
    const rec = att.record || {}
    const type = rec.$type || ''
    let preview = ''
    if (type === 'computer.sillyz.data.image' && rec.src) {
      preview = `<was-image src="${escapeHtml(rec.src)}" style="width:100%;height:100%;object-fit:cover;pointer-events:none;display:block;"></was-image>`
    } else if (type === 'computer.sillyz.data.video' && rec.src) {
      preview = `<was-video src="${escapeHtml(rec.src)}" nocontrols style="width:100%;height:100%;object-fit:cover;pointer-events:none;display:block;"></was-video>`
    } else if (type === 'computer.sillyz.data.audio') {
      preview = `<div class="attach-media-label"><sl-icon name="music-note-beamed"></sl-icon></div>`
    } else {
      preview = `<div class="attach-text-preview">${escapeHtml((rec.text || '').slice(0, 80))}</div>`
    }
    const iconName = type === 'computer.sillyz.data.video' ? 'camera-video'
      : type === 'computer.sillyz.data.audio' ? 'music-note-beamed'
      : type === 'computer.sillyz.data.image' ? 'image'
      : 'file-text'
    return `
      <button class="attach-thumb" data-open-attachment="${aid}" data-card-id="${cardId}" title="${escapeHtml(type)}">
        ${preview}
        <span class="attach-label"><sl-icon name="${iconName}"></sl-icon></span>
      </button>
    `
  }
  return `
    <button class="attach-thumb" data-open-attachment="${aid}" data-card-id="${cardId}" title="open flip-book">
      <canvas class="fb-thumb-canvas" width="80" height="60" data-fb-path="${escapeHtml(att.fbId || '')}"></canvas>
      <span class="attach-label"><sl-icon name="film"></sl-icon></span>
    </button>
  `
}

function renderAttachments(cardId, card) {
  const attachments = Object.entries(card.attachments || {})
  return `
    <div class="attach-section">
      <button class="attach-manage-btn" data-manage-attachments="${escapeHtml(cardId)}">
        <sl-icon name="images"></sl-icon>
        Manage Attachments
      </button>
      <div class="attach-gallery">
        ${attachments.map(([aid, att]) => renderAttachThumb(cardId, aid, att)).join('')}
      </div>
    </div>
  `
}

function renderIoPanel(ioMode, ioEngine) {
  const isImport = ioMode === 'import'
  const verb = isImport ? 'Import from' : 'Export to'

  if (!ioEngine) {
    const importOpts = isImport ? `
      <button class="io-btn" data-io-engine="bsky">
        <sl-icon name="twitter"></sl-icon> Bluesky follows
      </button>` : ''
    return `
      <div class="io-picker">
        <div class="io-picker-title">${verb}…</div>
        ${importOpts}
        <button class="io-btn" data-io-engine="json">
          <sl-icon name="file-earmark-code"></sl-icon> JSON file
        </button>
        <button class="io-btn" data-io-cancel>cancel</button>
      </div>
    `
  }

  if (ioEngine === 'json') return `
    <div class="io-picker">
      <div class="io-picker-title">${verb} JSON file</div>
      <button class="io-btn io-btn-primary" data-io-do>
        ${isImport ? 'Choose file…' : 'Download .json'}
      </button>
      <div class="io-status" data-io-status></div>
      <button class="io-btn" data-io-cancel>cancel</button>
    </div>
  `

  if (ioEngine === 'bsky') return `
    <div class="io-picker">
      <div class="io-picker-title">Import from Bluesky</div>
      <div class="io-tabs">
        <button class="io-tab io-tab-active" data-bsky-tab="follows">Follows</button>
        <button class="io-tab" data-bsky-tab="starter-pack">Starter pack</button>
      </div>
      <label class="io-label" data-bsky-follows-section>
        Handle
        <input class="io-input" type="text" placeholder="tychi.me" data-bsky-handle autocomplete="off">
      </label>
      <label class="io-label" data-bsky-pack-section style="display:none">
        Starter pack URL
        <input class="io-input" type="text" placeholder="https://bsky.app/starter-pack/..." data-bsky-pack-url autocomplete="off">
      </label>
      <button class="io-btn io-btn-primary" data-io-do-bsky>Load</button>
      <div class="io-status" data-io-status></div>
      <button class="io-btn" data-io-cancel>cancel</button>
    </div>
  `

  return ''
}

function renderSidebarSections(id, cards, edgeTypes, inspectorOpen, attachmentsOpen, logsOpen, ops = []) {
  const card = cards[id]
  if (!card) return '<p class="sidebar-empty">Card not found.</p>'
  const bg = card.color || 'lemonchiffon'
  const fg = contrastColor(bg)
  return `
    <div class="sidebar-editor-zone">
      <textarea class="sidebar-editor" data-edit-card="${id}" placeholder="type here..."
        style="background:${bg}; color:${fg};">${escapeHtml(card.text || '')}</textarea>
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
      <button class="section-toggle" data-toggle-section="logs">
        <sl-icon name="${logsOpen ? 'chevron-down' : 'chevron-right'}" class="section-chevron"></sl-icon>
        <span>Logs</span>
      </button>
      <div class="section-body logs-section-body${logsOpen ? '' : ' section-collapsed'}">
        <div class="op-log">${renderLogsBody(id, ops)}</div>
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

async function loadSagaInto(sidebarEl, cardId) {
  const el = sidebarEl.querySelector(`[data-saga-card="${cardId}"]`)
  if (!el) return
  try {
    const blob = await wasGet(`/accessibility-mode/${cardId}.saga`)
    if (!blob) { el.innerHTML = '<span class="saga-preview-empty">no saga yet</span>'; return }
    const text = await blob.text()
    el.innerHTML = `<div class="saga-preview-text">${escapeHtml(text)}</div>`
  } catch {
    el.innerHTML = '<span class="saga-preview-empty">no saga yet</span>'
  }
}

function queueThumbLoad(sidebarEl) {
  sidebarEl.querySelectorAll('[data-fb-path]').forEach(canvas => {
    loadFbThumb(canvas, canvas.dataset.fbPath)
  })
}

function deleteAttachment(cardId, aid) {
  const { cards } = $.learn()
  const card = cards[cardId]
  if (!card) return
  const attachments = { ...(card.attachments || {}) }
  delete attachments[aid]
  updateCard(cardId, { attachments })
  save(document.querySelector(tag))
}

function showAttachMenu(thumb, cardId, aid) {
  document.querySelector('.attach-quick-menu')?.remove()

  const menu = document.createElement('div')
  menu.className = 'attach-quick-menu'
  menu.style.cssText = `
    position:fixed; z-index:9999;
    display:flex; flex-direction:column; gap:3px;
    background:#1d2021; border:1px solid #504945;
    border-radius:3px; padding:4px;
    box-shadow:0 4px 16px rgba(0,0,0,.7);
    font-family:'Recursive';
  `

  const mkBtn = (label, danger) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `
      background:#3c3836; border:1px solid ${danger ? '#fb4934' : '#504945'};
      color:${danger ? '#fb4934' : '#a89984'};
      font-family:'Recursive'; font-size:.65rem;
      padding:.35rem .7rem; cursor:pointer; border-radius:2px;
      text-align:left; white-space:nowrap; display:block; width:100%;
    `
    b.addEventListener('pointerover', () => { b.style.background = danger ? 'rgba(251,73,52,.15)' : 'rgba(215,153,33,.15)'; b.style.borderColor = danger ? '#fb4934' : '#d79921'; b.style.color = danger ? '#fb4934' : '#fabd2f' })
    b.addEventListener('pointerout',  () => { b.style.background = '#3c3836'; b.style.borderColor = danger ? '#fb4934' : '#504945'; b.style.color = danger ? '#fb4934' : '#a89984' })
    return b
  }

  const delBtn = mkBtn('✕  remove', true)
  menu.appendChild(delBtn)
  document.body.appendChild(menu)

  const rect = thumb.getBoundingClientRect()
  const mh = menu.offsetHeight
  menu.style.left = `${rect.left}px`
  menu.style.top  = `${Math.max(4, rect.top - mh - 8)}px`

  delBtn.addEventListener('pointerdown', e => {
    e.stopPropagation()
    menu.remove()
    deleteAttachment(cardId, aid)
  })

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', dismiss) }
  }
  setTimeout(() => document.addEventListener('pointerdown', dismiss), 0)
}

function attachThumbHoldListeners(container) {
  container.querySelectorAll('.attach-thumb').forEach(thumb => {
    if (thumb._holdBound) return
    thumb._holdBound = true

    let pressTimer = null
    const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } }

    thumb.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      const startX = e.clientX, startY = e.clientY
      let moved = false

      cancelPress()
      pressTimer = setTimeout(() => {
        pressTimer = null
        if (!moved) {
          thumb._suppressNextClick = true
          showAttachMenu(thumb, thumb.dataset.cardId, thumb.dataset.openAttachment)
        }
      }, 400)

      const onMove = e => {
        const dx = e.clientX - startX, dy = e.clientY - startY
        if (!moved && Math.sqrt(dx * dx + dy * dy) > 6) { moved = true; cancelPress() }
      }

      const onUp = () => {
        thumb.removeEventListener('pointermove', onMove)
        thumb.removeEventListener('pointerup', onUp)
        thumb.removeEventListener('pointercancel', onUp)
        cancelPress()
      }

      thumb.addEventListener('pointermove', onMove)
      thumb.addEventListener('pointerup', onUp)
      thumb.addEventListener('pointercancel', onUp)
    })

    thumb.addEventListener('contextmenu', e => e.preventDefault())
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
// screen px of slack around the viewport before a card is culled — keeps cards
// that are about to be panned into view from popping in, same overscan idea as
// flip-book.js's REEL_OVERSCAN, just in world coordinates instead of frame indices
const CULL_OVERSCAN_PX = 400

function visibleWorldRect({ panX, panY, zoom, viewportW, viewportH }) {
  // .workspace does transform: translate(panX,panY) scale(zoom), so
  // screenX = worldX * zoom + panX  =>  worldX = (screenX - panX) / zoom
  const pad = CULL_OVERSCAN_PX / zoom
  return {
    left:   (0 - panX) / zoom - pad,
    top:    (0 - panY) / zoom - pad,
    right:  (viewportW - panX) / zoom + pad,
    bottom: (viewportH - panY) / zoom + pad,
  }
}

function cardInRect(card, rect) {
  return card.x < rect.right && card.x + card.w > rect.left &&
         card.y < rect.bottom && card.y + card.h > rect.top
}

function patchCardsLayer(cardsLayer, cards, focused, linkSource, grabbing, viewport) {
  const seen = new Set()
  // viewport is optional so callers (e.g. tests) can skip culling by omitting it
  const rect = viewport ? visibleWorldRect(viewport) : null

  for (const [id, card] of Object.entries(cards)) {
    seen.add(id)
    let el = cardsLayer.querySelector(`.card[data-id="${id}"]`)

    // never cull the card someone's actively focused on or dragging, even if
    // fast panning has momentarily pushed its coordinates outside the rect
    const exempt = focused === id || grabbing === id
    if (rect && !exempt && !cardInRect(card, rect)) {
      el?.remove()
      continue
    }

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
  browse: { icon: 'people-fill',   color: 'darkorange'     },
  gallery: { icon: 'images',        color: 'mediumpurple'   },
  share:  { icon: 'question-circle', color: 'gold', textColor: '#333' },
}

function renderCompassButtons(mode) {
  return `
    <button class="c-manage${mode === 'manage' ? ' active' : ''}" data-mode="manage" title="manage cards">
      <sl-icon name="pencil-square"></sl-icon>
    </button>
    <button class="c-browse${mode === 'browse' ? ' active' : ''}" data-mode="browse" title="team chat">
      <sl-icon name="people-fill"></sl-icon>
    </button>
    <button class="c-share${mode === 'share' ? ' active' : ''}" data-mode="share" title="info &amp; share">
      <sl-icon name="question-circle"></sl-icon>
    </button>
    <button class="c-move${mode === 'pan' ? ' active' : ''}" data-mode="pan" title="move canvas">
      <sl-icon name="arrows-move"></sl-icon>
    </button>
    <button class="c-os${mode === 'os' ? ' active' : ''}" data-mode="os" title="3D world">
      <sl-icon name="layers-fill"></sl-icon>
    </button>
    <button class="c-camera${mode === 'gallery' ? ' active' : ''}" data-mode="gallery" title="drop media">
      <sl-icon name="images"></sl-icon>
    </button>
  `
}

let _prevOsMode = false

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
  target.dataset.os = mode === 'os' ? 'true' : 'false'
}

let _lastCardsJson = null
function dispatchParkCards() {
  const { cards, edgeTypes } = $.learn()
  const json = JSON.stringify({ cards, edgeTypes })
  if (json === _lastCardsJson) return
  _lastCardsJson = json
  window.dispatchEvent(new CustomEvent('park:cards', { detail: { cards, edgeTypes } }))
}

window.addEventListener('park:ready', () => {
  _lastCardsJson = null
  const { mode } = $.learn()
  if (mode === 'os') dispatchParkCards()
})

window.addEventListener('park:inspector', ({ detail }) => {
  $.teach({ parkInspectorId: detail.cardId || null, parkInspectorCardIds: detail.cardIds || [] })
})

window.addEventListener('park:open-card', ({ detail }) => {
  $.teach({ mode: 'pan', menuOpen: false, linkSource: null, sidebarOpen: true, sidebarCard: detail.cardId, parkInspectorId: null })
})


function openInBoard(cardId) {
  const { cards, zoom } = $.learn()
  const card = cards[cardId]
  const host = document.querySelector(tag)
  const vw = host ? host.clientWidth : window.innerWidth
  const vh = host ? host.clientHeight : window.innerHeight
  const panX = card ? vw / 2 - (card.x + card.w / 2) * zoom : 0
  const panY = card ? vh / 2 - (card.y + card.h / 2) * zoom : 0
  $.teach({
    mode: 'pan', menuOpen: false, openedFromOs: true,
    sidebarOpen: true, sidebarCard: cardId, focusedCard: cardId,
    ...clampPan(panX, panY, zoom),
  })
  window.dispatchEvent(new CustomEvent('park:panel-state', { detail: { open: false } }))
}

window.addEventListener('park:open-in-board', ({ detail }) => {
  hidePanel()
  openInBoard(detail.cardId)
})

window.addEventListener('park:manage-island', ({ detail }) => {
  const { parkInspectorCardIds, cards } = $.learn()
  const ids = parkInspectorCardIds.length ? parkInspectorCardIds : (detail.cardId ? [detail.cardId] : [])
  if (!ids.length) return
  if (ids.length === 1) { openInBoard(ids[0]); return }
  const items = ids.map(id => {
    const c = cards[id]
    if (!c) return ''
    const bg = c.color || 'lemonchiffon'
    return `<button onclick="window.dispatchEvent(new CustomEvent('park:open-in-board',{detail:{cardId:'${id}'}}));" style="display:block;width:100%;text-align:left;padding:.6rem .75rem;border:none;border-bottom:1px solid rgba(0,0,0,.08);background:${bg};cursor:pointer;font-family:'Recursive',sans-serif;font-size:.9rem;">
      <strong>${c.name || 'untitled'}</strong>
      ${c.text ? `<span style="display:block;font-size:.75rem;opacity:.6;margin-top:.15rem;">${c.text.slice(0, 60)}${c.text.length > 60 ? '…' : ''}</span>` : ''}
    </button>`
  }).join('')
  showPanel(`<div style="padding:.5rem 0">${items}</div>`)
})

window.addEventListener('park:close-island', () => {
  hidePanel()
})

function afterUpdate(target) {
  const { mode, cards } = $.learn()
  const osBtn = target.querySelector('.c-os')
  let park = target.querySelector('.os-overlay')
  const entering = mode === 'os' && !_prevOsMode
  _prevOsMode = mode === 'os'

  if (mode === 'os') {
    if (osBtn) osBtn.classList.add('active')
    if (!park) {
      park = document.createElement('generic-park')
      park.className = 'os-overlay'
      target.appendChild(park)
      setTimeout(dispatchParkCards, 300)
    }
    park.style.display = 'block'
    dispatchParkCards()
  } else {
    if (osBtn) osBtn.classList.remove('active')
    if (park) park.style.display = 'none'
  }

  const shareOverlay = target.querySelector('.share-overlay')
  if (shareOverlay) {
    const { launchHref, ioMode, ioEngine, ioStatus } = $.learn()
    if (mode === 'share' && !launchHref) {
      shareOverlay.style.display = 'flex'
      const url = `${location.origin}/app/bulletin-board?id=${_boardId}`
      const safe = escapeHtml(url)

      const joinDiv = shareOverlay.querySelector('.share-join')
      if (joinDiv && joinDiv.dataset.url !== url) {
        joinDiv.dataset.url = url
        joinDiv.innerHTML = `
          <join-cta
            url="${safe}"
            title="bulletin-board"
            description="the elves need your help. the rainbow connection is down and if you don't get it back online, no one will. good luck. team up with friends to solve fact-based mysteries."
          ></join-cta>
        `
      }

      const ioDiv = shareOverlay.querySelector('.share-io')
      if (ioDiv) {
        const ioSig = `${ioMode}|${ioEngine}`
        if (ioDiv.dataset.sig !== ioSig) {
          ioDiv.dataset.sig = ioSig
          ioDiv.innerHTML = ioMode ? renderIoPanel(ioMode, ioEngine) : ''
        }
        const statusEl = ioDiv.querySelector('[data-io-status]')
        if (statusEl && statusEl.textContent !== ioStatus) statusEl.textContent = ioStatus
      }
    } else {
      shareOverlay.style.display = 'none'
    }
  }
}


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
    <div class="zoom-widget" style="display:${(mode === 'pan' || mode === 'manage' || mode === 'link') ? 'flex' : 'none'}">
      <button class="zoom-btn" data-zoom-out>−</button>
      <button class="zoom-label" data-zoom-reset data-zoom-lbl>${zoom >= 1 ? `${zoom * 100 | 0}%` : `${Math.round(zoom * 100)}%`}</button>
      <button class="zoom-btn" data-zoom-in>+</button>
    </div>
    <div class="the-compass" data-open="false" style="--belt-offset-x:0px; --belt-offset-y:0px;">
      <button class="root" data-toggle-menu title="menu (drag to move)" style="background:${(MODE_META[mode] || MODE_META.pan).color}"><sl-icon name="${(MODE_META[mode] || MODE_META.pan).icon}"></sl-icon></button>
      ${renderCompassButtons(mode)}
    </div>
    <div class="card-sidebar" data-open="false">
      <div class="sidebar-resizer" data-sidebar-resizer></div>
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <span class="sidebar-heading"></span>
          <button class="sidebar-close" data-close-sidebar>✕</button>
        </div>
        <div class="sidebar-body"></div>
      </div>
    </div>
    <div class="card-launch" data-open="false"></div>
    <div class="camera-overlay" data-open="false"></div>
    <div class="share-overlay" style="display:none">
      <div class="share-join"></div>
      <div class="share-io"></div>
    </div>
    <div class="park-hud" hidden></div>
    <board-call></board-call>
  `

  target.querySelector('.bulletin-canvas').style.backgroundImage = stars

  target.addEventListener('wheel', e => {
    const { mode, zoom, panX, panY } = $.learn()
    if (mode !== 'pan' && mode !== 'manage') return
    if (e.target.closest('.card-sidebar')) return
    e.preventDefault()
    if (e.ctrlKey) {
      const rect = target.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const delta = -e.deltaY * (e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? 400 : 1)
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(delta * 0.01)))
      const anchorX = (cursorX - panX) / zoom
      const anchorY = (cursorY - panY) / zoom
      $.teach({ zoom: newZoom, ...clampPan(cursorX - anchorX * newZoom, cursorY - anchorY * newZoom, newZoom) })
    } else {
      $.teach(clampPan(panX - e.deltaX * 0.6, panY - e.deltaY * 0.6, zoom))
    }
  }, { passive: false })

  wasLoad().then(() => {
    wasLoadOps()
    subscribe(target)
    linkState(tag, _boardId)
    startViewportBroadcast()
    if (!_peerArrowInterval) {
      _peerArrowInterval = setInterval(patchPeerArrows, 83)
    }
  })
}

function update(target) {
  const { panX, panY, zoom, cards, mode, menuOpen, beltOffsetX, beltOffsetY,
          focusedCard, linkSource, isDrawing, createStartX, createStartY, createX, createY,
          sidebarOpen, sidebarCard, grabbing, edgeTypes, launchHref, players,
          inspectorOpen, attachmentsOpen, logsOpen, ops, _rejectedOps } = $.learn()

  const workspace = target.querySelector('.workspace')
  workspace.style.setProperty('--pan-x', panX + 'px')
  workspace.style.setProperty('--pan-y', panY + 'px')
  workspace.style.setProperty('--zoom', zoom)

  const zoomWidget = target.querySelector('.zoom-widget')
  if (zoomWidget) zoomWidget.style.display = (!launchHref && (mode === 'pan' || mode === 'manage' || mode === 'link')) ? 'flex' : 'none'
  const zoomLbl = target.querySelector('[data-zoom-lbl]')
  if (zoomLbl) zoomLbl.textContent = zoom >= 1 ? `${zoom * 100 | 0}%` : `${Math.round(zoom * 100)}%`

  const compass = target.querySelector('.the-compass')
  compass.dataset.open = menuOpen
  compass.style.setProperty('--belt-offset-x', beltOffsetX + 'px')
  compass.style.setProperty('--belt-offset-y', beltOffsetY + 'px')

  compass.querySelectorAll('[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode)
  })

  const rootBtn = compass.querySelector('.root')
  if (rootBtn) {
    rootBtn.dataset.closeLaunch = launchHref ? 'true' : ''
    const md = launchHref ? MODE_META.browse : (MODE_META[mode] || MODE_META.pan)
    rootBtn.style.background = md.color
    rootBtn.style.color = md.textColor || ''
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
  patchCardsLayer(cardsLayer, cards, focusedCard, linkSource, grabbing, {
    panX, panY, zoom, viewportW: target.clientWidth, viewportH: target.clientHeight,
  })
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
    $.teach({ sidebarOpen: false, sidebarCard: null, openedFromOs: false })
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

    const heading = sidebar.querySelector('.sidebar-heading')
    if (heading) heading.textContent = sidebarCard.slice(0, 8)

    const sidebarBody = sidebar.querySelector('.sidebar-body')
    const etSig = Object.entries(edgeTypes).map(([k, v]) => `${k}:${v.color}`).join(',')
    const linkTypeSig = Object.entries(card?.links || {}).map(([k, v]) => `${k}:${v.typeId}`).join(',')
      + '|' + Object.keys(card?.backlinks || {}).join(',')
    const attachSig = Object.keys(card?.attachments || {}).join(',')
    const sectionSig = `${inspectorOpen}|${attachmentsOpen}|${logsOpen}`
    const cardSwitched = sidebarBody.dataset.card !== sidebarCard
      || sidebarBody.dataset.etSig !== etSig
      || sidebarBody.dataset.linkTypeSig !== linkTypeSig
      || sidebarBody.dataset.attachSig !== attachSig
      || sidebarBody.dataset.sectionSig !== sectionSig
    if (cardSwitched) {
      sidebarBody.innerHTML = renderSidebarSections(sidebarCard, cards, edgeTypes, inspectorOpen, attachmentsOpen, logsOpen, ops)
      sidebarBody.dataset.card = sidebarCard
      sidebarBody.dataset.etSig = etSig
      sidebarBody.dataset.linkTypeSig = linkTypeSig
      sidebarBody.dataset.attachSig = attachSig
      sidebarBody.dataset.sectionSig = sectionSig
      queueThumbLoad(sidebarBody)
      attachThumbHoldListeners(sidebarBody)
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
      // Patch op-log without full rebuild
      const opLog = sidebarBody.querySelector('.op-log')
      if (opLog && logsOpen) opLog.innerHTML = renderLogsBody(sidebarCard, ops)
    }
  }

  // park HUD — rendered above A-Frame canvas
  const { parkInspectorId } = $.learn()
  const parkHud = target.querySelector('.park-hud')
  if (parkHud) {
    const inspCard = parkInspectorId ? cards[parkInspectorId] : null
    if (inspCard && mode === 'os') {
      parkHud.hidden = false
      const bg = inspCard.color || 'lemonchiffon'
      parkHud.innerHTML = `
        <div class="park-hud-inner" style="background:${bg}">
          ${(inspCard.text || '').split('\n')[0].trim() ? `<strong>${(inspCard.text || '').split('\n')[0].trim()}</strong>` : ''}
          <span class="park-hud-hint">press A to manage island</span>
        </div>`
    } else {
      parkHud.hidden = true
    }
  }

  return null
}

// ── canvas pointer: pan + rubber-band create + pinch zoom ────────────────────

const _canvasPointers = new Map()  // pointerId → {clientX, clientY}
let _pinching = false
let _pinchStartDist = 0
let _pinchStartZoom = 1
let _pinchStartPanX = 0
let _pinchStartPanY = 0
let _pinchMidClientX = 0
let _pinchMidClientY = 0
const ZOOM_MIN = 0.2
const ZOOM_MAX = 4
const CANVAS_SIZE = 5000

function clampPan(panX, panY, zoom) {
  const host = document.querySelector(tag)
  if (!host) return { panX, panY }
  const hw = host.clientWidth, hh = host.clientHeight
  return {
    panX: Math.max(hw / 2 - CANVAS_SIZE * zoom, Math.min(hw / 2, panX)),
    panY: Math.max(hh / 2 - CANVAS_SIZE * zoom, Math.min(hh / 2, panY)),
  }
}

function setZoom(newZ) {
  const { zoom: oldZoom, panX, panY } = $.learn()
  const host = document.querySelector(tag)
  if (!host) return
  const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZ))
  const cx = host.clientWidth / 2
  const cy = host.clientHeight / 2
  const anchorX = (cx - panX) / oldZoom
  const anchorY = (cy - panY) / oldZoom
  $.teach({ zoom: newZoom, ...clampPan(cx - anchorX * newZoom, cy - anchorY * newZoom, newZoom) })
}

function pinchDist(a, b) {
  const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

$.when('pointerdown', '.bulletin-canvas', e => {
  e.preventDefault()
  _canvasPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })

  const { mode, panX, panY, zoom } = $.learn()
  const pts = [..._canvasPointers.values()]

  if (pts.length === 2 && (mode === 'pan' || mode === 'manage')) {
    _pinching = true
    _pinchStartDist = pinchDist(pts[0], pts[1])
    _pinchStartZoom = zoom
    _pinchStartPanX = panX
    _pinchStartPanY = panY
    _pinchMidClientX = (pts[0].clientX + pts[1].clientX) / 2
    _pinchMidClientY = (pts[0].clientY + pts[1].clientY) / 2
    $.teach({ panHappening: false, isDrawing: false })
    return
  }

  $.teach({ focusedCard: null, sidebarOpen: false, sidebarCard: null, openedFromOs: false })
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
  _canvasPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })

  if (_pinching) {
    const pts = [..._canvasPointers.values()]
    if (pts.length < 2) return
    const dist = pinchDist(pts[0], pts[1])
    const scale = dist / _pinchStartDist
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, _pinchStartZoom * scale))
    const midX = (pts[0].clientX + pts[1].clientX) / 2
    const midY = (pts[0].clientY + pts[1].clientY) / 2
    const anchorX = (_pinchMidClientX - _pinchStartPanX) / _pinchStartZoom
    const anchorY = (_pinchMidClientY - _pinchStartPanY) / _pinchStartZoom
    $.teach({ zoom: newZoom, ...clampPan(midX - anchorX * newZoom, midY - anchorY * newZoom, newZoom) })
    return
  }

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
  _canvasPointers.delete(e.pointerId)

  if (_pinching) {
    if (_canvasPointers.size < 2) {
      _pinching = false
      const { panX, panY } = $.learn()
      const rhythm = parseFloat(getComputedStyle(document.documentElement).fontSize)
      $.teach({ panXmod: panX % rhythm, panYmod: panY % rhythm })
    }
    return
  }

  const { mode, panHappening, isDrawing, createStartX, createStartY, createX, createY } = $.learn()

  if (mode === 'pan' && panHappening) {
    const { panX, panY, zoom } = $.learn()
    const clamped = clampPan(panX, panY, zoom)
    const rhythm = parseFloat(getComputedStyle(document.documentElement).fontSize)
    $.teach({ panHappening: false, panXmod: clamped.panX % rhythm, panYmod: clamped.panY % rhythm, ...clamped })
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

$.when('dblclick', '.bulletin-canvas', e => {
  e.preventDefault()
  const { mode } = $.learn()
  if (mode !== 'pan' && mode !== 'manage') return
  setZoom(1)
})

// ── import / export ───────────────────────────────────────────────────────────

$.when('cta-export', 'join-cta', () => {
  $.teach({ ioMode: 'export', ioEngine: null, ioStatus: '' })
})

$.when('cta-import', 'join-cta', () => {
  $.teach({ ioMode: 'import', ioEngine: null, ioStatus: '' })
})

$.when('click', '[data-io-engine]', (e) => {
  $.teach({ ioEngine: e.target.dataset.ioEngine, ioStatus: '' })
})

$.when('click', '[data-io-cancel]', () => {
  $.teach({ ioMode: null, ioEngine: null, ioStatus: '' })
})

$.when('click', '[data-io-do]', async (e) => {
  const { ioMode, ioEngine } = $.learn()

  if (ioEngine === 'json' && ioMode === 'export') {
    const { cards, edgeTypes } = $.learn()
    const blob = new Blob([JSON.stringify({ cards, edgeTypes }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), {
      href: url, download: `bulletin-board-${_boardId.slice(0, 8)}.json`
    }).click()
    URL.revokeObjectURL(url)
    $.teach({ ioMode: null, ioEngine: null, ioStatus: '' })
  }

  if (ioEngine === 'json' && ioMode === 'import') {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' })
    input.onchange = async () => {
      try {
        const { cards, edgeTypes } = JSON.parse(await input.files[0].text())
        $.teach({ cards: cards || {}, edgeTypes: edgeTypes || {}, ioMode: null, ioEngine: null, ioStatus: '' })
        save(document.querySelector(tag))
      } catch (err) {
        $.teach({ ioStatus: `error: ${err.message}` })
      }
    }
    input.click()
  }

})

$.when('click', '[data-bsky-tab]', (e) => {
  const btn = e.target.closest('[data-bsky-tab]')
  if (!btn) return
  const picker = btn.closest('.io-picker')
  if (!picker) return
  const tab = btn.dataset.bskyTab
  picker.querySelectorAll('[data-bsky-tab]').forEach(b => b.classList.toggle('io-tab-active', b.dataset.bskyTab === tab))
  picker.querySelector('[data-bsky-follows-section]').style.display = tab === 'follows' ? '' : 'none'
  picker.querySelector('[data-bsky-pack-section]').style.display = tab === 'starter-pack' ? '' : 'none'
})

$.when('click', '[data-io-do-bsky]', async (e) => {
  const picker = e.target.closest('.io-picker')
  if (!picker) return

  const activeTab = picker.querySelector('.io-tab-active')?.dataset.bskyTab || 'follows'
  const BASE = 'https://public.api.bsky.app/xrpc'

  const CARD_W = 200, CARD_H = 120, GAP = 24
  const STRIDE_X = CARD_W + GAP
  const STRIDE_Y = CARD_H + GAP

  function actorToText(a) {
    return [a.displayName || a.handle, `@${a.handle}`, '', (a.description || '').slice(0, 240)].join('\n').trim()
  }

  function layoutCards(actor, members) {
    const cards = {}
    const now = new Date().toISOString()
    const COLS = Math.max(1, Math.ceil(Math.sqrt(members.length)))
    const gridW = COLS * STRIDE_X - GAP
    const cx = Math.round(gridW / 2 - CARD_W / 2)

    const actorId = crypto.randomUUID()
    cards[actorId] = {
      text: actorToText(actor), x: cx, y: 0,
      w: CARD_W, h: CARD_H, color: 'lightcyan',
      createdAt: now, links: {}, backlinks: {}, attachments: {},
    }

    members.forEach((m, i) => {
      cards[crypto.randomUUID()] = {
        text: actorToText(m),
        x: (i % COLS) * STRIDE_X,
        y: STRIDE_Y + CARD_H + Math.floor(i / COLS) * STRIDE_Y,
        w: CARD_W, h: CARD_H, color: 'lemonchiffon',
        createdAt: now, links: {}, backlinks: {}, attachments: {},
      }
    })
    return cards
  }

  if (activeTab === 'follows') {
    const handle = picker.querySelector('[data-bsky-handle]')?.value?.trim().replace(/^@/, '')
    if (!handle) { $.teach({ ioStatus: 'enter a handle first' }); return }

    $.teach({ ioStatus: 'loading…' })
    try {
      const [profileRes, followsRes] = await Promise.all([
        fetch(`${BASE}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`),
        fetch(`${BASE}/app.bsky.graph.getFollows?actor=${encodeURIComponent(handle)}&limit=100`),
      ])
      if (!profileRes.ok) throw new Error(`profile ${profileRes.status}`)
      if (!followsRes.ok) throw new Error(`follows ${followsRes.status}`)
      const profile = await profileRes.json()
      const { follows } = await followsRes.json()

      $.teach({ ioStatus: `placing ${follows.length + 1} cards…` })
      const cards = layoutCards(profile, follows)
      const { edgeTypes } = $.learn()
      $.teach({ cards, edgeTypes, ioMode: null, ioEngine: null, ioStatus: '' })
      save(document.querySelector(tag))
    } catch (err) {
      $.teach({ ioStatus: `error: ${err.message}` })
    }
  }

  if (activeTab === 'starter-pack') {
    const raw = picker.querySelector('[data-bsky-pack-url]')?.value?.trim()
    if (!raw) { $.teach({ ioStatus: 'enter a starter pack URL first' }); return }

    // extract rkey and creator from URL: /starter-pack/{handle}/{rkey}
    const m = raw.match(/starter-pack\/([^/]+)\/([^/?#]+)/)
    if (!m) { $.teach({ ioStatus: 'unrecognised starter pack URL' }); return }
    const [, creator, rkey] = m

    $.teach({ ioStatus: 'loading starter pack…' })
    try {
      const creatorRes = await fetch(`${BASE}/app.bsky.actor.getProfile?actor=${encodeURIComponent(creator)}`)
      if (!creatorRes.ok) throw new Error(`creator ${creatorRes.status}`)
      const creatorProfile = await creatorRes.json()
      const did = creatorProfile.did

      const packRes = await fetch(`${BASE}/app.bsky.graph.getStarterPack?starterPack=${encodeURIComponent(`at://${did}/app.bsky.graph.starterpack/${rkey}`)}`)
      if (!packRes.ok) throw new Error(`starter pack ${packRes.status}`)
      const { starterPack } = await packRes.json()

      const listUri = starterPack?.list?.uri
      if (!listUri) throw new Error('no list in starter pack')

      $.teach({ ioStatus: 'loading members…' })
      const membersRes = await fetch(`${BASE}/app.bsky.graph.getList?list=${encodeURIComponent(listUri)}&limit=100`)
      if (!membersRes.ok) throw new Error(`list ${membersRes.status}`)
      const { items } = await membersRes.json()
      const members = items.map(i => i.subject)

      $.teach({ ioStatus: `placing ${members.length + 1} cards…` })
      const cards = layoutCards(creatorProfile, members)
      const { edgeTypes } = $.learn()
      $.teach({ cards, edgeTypes, ioMode: null, ioEngine: null, ioStatus: '' })
      save(document.querySelector(tag))
    } catch (err) {
      $.teach({ ioStatus: `error: ${err.message}` })
    }
  }
})

$.when('click', '[data-zoom-in]', e => {
  if (!e.target.closest(tag)) return
  setZoom($.learn().zoom + 0.25)
})

$.when('click', '[data-zoom-out]', e => {
  if (!e.target.closest(tag)) return
  setZoom($.learn().zoom - 0.25)
})

$.when('click', '[data-zoom-reset]', e => {
  if (!e.target.closest(tag)) return
  setZoom(1)
})

document.addEventListener('keydown', e => {
  const host = document.querySelector(tag)
  if (!host?.isConnected) return
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
  const { mode } = $.learn()
  if (mode !== 'pan' && mode !== 'manage') return
  if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom($.learn().zoom + 0.25) }
  if (e.key === '-') { e.preventDefault(); setZoom($.learn().zoom - 0.25) }
  if (e.key === '0') { e.preventDefault(); setZoom(1) }
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
  const { openedFromOs } = $.learn()
  if (openedFromOs) {
    $.teach({ sidebarOpen: false, sidebarCard: null, mode: 'os', openedFromOs: false })
  } else {
    $.teach({ sidebarOpen: false, sidebarCard: null })
  }
})

$.when('click', '[data-toggle-section]', e => {
  const section = e.target.closest('[data-toggle-section]')?.dataset.toggleSection
  if (section === 'inspector') $.teach({ inspectorOpen: !$.learn().inspectorOpen })
  else if (section === 'attachments') $.teach({ attachmentsOpen: !$.learn().attachmentsOpen })
  else if (section === 'logs') $.teach({ logsOpen: !$.learn().logsOpen })
})

$.when('change', '.op-check', e => {
  const opId = e.target.dataset.opId
  if (!opId) return
  const rejected = getRejected()
  if (e.target.checked) rejected.delete(opId)
  else rejected.add(opId)
  setRejected(rejected)
})

let _attachmentCardId = null

function openAttachmentGallery(cardId) {
  _attachmentCardId = cardId
  showModal(`<div data-modal-close style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:2rem;box-sizing:border-box;"><div style="width:100%;max-width:640px;height:70vh;display:flex;flex-direction:column;background:white;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.2);"><plan98-gallery mode="picker" style="display:block;flex:1;overflow:auto;"></plan98-gallery></div></div>`)
}

document.addEventListener('gallery-share', e => {
  if (!_attachmentCardId) return
  const cardId = _attachmentCardId
  _attachmentCardId = null
  const { cards } = $.learn()
  const card = cards[cardId]
  if (!card) return
  const newAttachments = {}
  e.detail.items.forEach(item => {
    const aid = crypto.randomUUID()
    newAttachments[aid] = { type: 'gallery', record: item.record, createdAt: new Date().toISOString() }
  })
  updateCard(cardId, { attachments: { ...(card.attachments || {}), ...newAttachments } })
  save(document.querySelector(tag))
  hideModal()
})

document.addEventListener('gallery-create-media', e => {
  const { mediaType } = e.detail || {}
  if (!mediaType) return
  _attachmentCardId = null
  closeGallery()
  hideModal()
  if (mediaType === 'image') openLaunch('/app/plan98-camera')
  else if (mediaType === 'video') openLaunch('/app/v-log')
  else if (mediaType === 'audio') openLaunch('/app/v-log')
  else if (mediaType === 'flip-book') openLaunch('/app/flip-book')
})

$.when('click', '[data-manage-attachments]', e => {
  const cardId = e.target.closest('[data-manage-attachments]')?.dataset.manageAttachments
  if (!cardId) return
  openAttachmentGallery(cardId)
})

function openAttachment(cardId, aid) {
  const { cards } = $.learn()
  const att = cards[cardId]?.attachments?.[aid]
  if (!att) return
  if (att.type === 'gallery') {
    const rec = att.record || {}
    const src = rec.src || ''
    const type = rec.$type || ''
    if (type === 'computer.sillyz.data.video') openLaunch(`/app/was-video?src=${encodeURIComponent(src)}`)
    else if (type === 'computer.sillyz.data.image') openLaunch(`/app/was-image?src=${encodeURIComponent(src)}`)
    else if (type === 'computer.sillyz.data.audio') openLaunch(`/app/v-log?src=${encodeURIComponent(src)}`)
    return
  }
  openLaunch(`/app/flip-book?id=${encodeURIComponent(att.fbId)}`)
}

$.when('click', '[data-open-attachment]', e => {
  const btn = e.target.closest('[data-open-attachment]')
  if (!btn) return
  if (btn._suppressNextClick) { btn._suppressNextClick = false; return }
  openAttachment(btn.dataset.cardId, btn.dataset.openAttachment)
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

function findOverlaps(id, cards) {
  const a = cards[id]
  if (!a) return []
  return Object.entries(cards)
    .filter(([otherId, b]) => otherId !== id &&
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
    .map(([otherId]) => otherId)
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

function cancelGesture(e) {
  if (e) { _canvasPointers.delete(e.pointerId); _pinching = false }
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

document.addEventListener('pointerup', e => {
  const { grabbing, resizing, beltGrabbed } = $.learn()

  if (grabbing) {
    stopArrowInterval()
    clearPresence()
    if (hasDragged) {
      const { cards, pickupX, pickupY } = $.learn()
      const dropped = { ...(cards[grabbing] || {}), x: dragCardX, y: dragCardY }
      const tmpCards = { ...cards, [grabbing]: dropped }
      const overlapping = findOverlaps(grabbing, tmpCards)
      updateCard(grabbing, { x: dragCardX, y: dragCardY })
      for (const otherId of overlapping) {
        const [fromDir, toDir] = bestCompassPair(dropped, tmpCards[otherId])
        linkCards(grabbing, otherId, fromDir, toDir)
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
    e.target.closest(tag)?.querySelector('.card-launch')?.style.removeProperty('pointer-events')
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
  e.target.closest(tag)?.querySelector('.card-launch')?.style.setProperty('pointer-events', 'none')
})

$.when('click', '[data-toggle-menu]', e => {
  if (beltDragMoved) { beltDragMoved = false; return }
  const { launchHref } = $.learn()
  if (launchHref) return closeLaunch()
  $.teach({ menuOpen: !$.learn().menuOpen })
})

$.when('click', '[data-mode]', e => {
  const btn = e.target.closest('[data-mode]')
  if (!btn) return
  const { mode: prev } = $.learn()
  const next = btn.dataset.mode

  // os is a true toggle — always returns to pan
  if (next === 'os') {
    $.teach({ mode: prev === 'os' ? 'pan' : 'os', menuOpen: false, linkSource: null })
    return
  }

  // tear down previous overlay
  if (prev === 'gallery') closeGallery(false)
  if (prev === 'browse') closeLaunch()

  // open new overlay
  if (next === 'gallery') openGallery()
  else if (next === 'browse') {
    const { boardGroupId } = $.learn()
    const href = `/app/group-chat?room=${encodeURIComponent(_boardId)}${boardGroupId ? `&group=${encodeURIComponent(boardGroupId)}` : ''}`
    openLaunch(href)
    history.pushState({ type: 'bulletin-board-launch', href }, '', href)
  }

  if (next !== 'browse') $.teach({ mode: next, menuOpen: false, linkSource: null })
  else $.teach({ mode: 'pan', menuOpen: false, linkSource: null })
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
  openLaunch(href)
  history.pushState({ type: 'bulletin-board-launch', href }, '', href)
})

// ── compass action buttons ────────────────────────────────────────────────────

$.when('click', '[data-action]', e => {
  const btn = e.target.closest('[data-action]')
  if (!btn) return
  const action = btn.dataset.action
  $.teach({ menuOpen: false })

})

// ── gallery overlay — pick media, drop as spiral of cards ────────────────────

function openGallery() {
  const host = document.querySelector(tag)
  if (!host) return
  const overlay = host.querySelector('.camera-overlay')
  if (!overlay) return

  const gallery = document.createElement('plan98-gallery')
  gallery.setAttribute('mode', 'picker')
  gallery.style.cssText = 'display:block;width:100%;height:100%;overflow:auto;'

  overlay.innerHTML = ''
  overlay.appendChild(gallery)
  overlay.dataset.open = 'true'

  overlay.addEventListener('gallery-share', e => {
    try { dropMediaSpiral(e.detail.items) } finally { closeGallery() }
  }, { once: true })
}

function closeGallery(resetMode = true) {
  const overlay = document.querySelector(`${tag} .camera-overlay`)
  if (overlay) { overlay.innerHTML = ''; overlay.dataset.open = 'false' }
  if (resetMode && $.learn().mode === 'gallery') $.teach({ mode: 'pan' })
}

function dropMediaSpiral(items) {
  const { panX, panY, zoom } = $.learn()
  const host = document.querySelector(tag)
  // use host dimensions for viewport size, not the 5000×5000 canvas element
  const vw = host?.clientWidth  || window.innerWidth
  const vh = host?.clientHeight || window.innerHeight

  // viewport center in canvas coords
  const cx = (vw / 2 - panX) / zoom
  const cy = (vh / 2 - panY) / zoom

  const W = 180, H = 140
  const spacing = 220
  const angleStep = Math.PI * (3 - Math.sqrt(5)) // golden angle

  items.forEach((item, i) => {
    const r = i === 0 ? 0 : spacing * Math.sqrt(i)
    const angle = i * angleStep
    const x = cx + r * Math.cos(angle) - W / 2
    const y = cy + r * Math.sin(angle) - H / 2
    const id = createCard(x, y, W, H)
    const src = item.record?.src || item.record?.url || ''
    if (src) {
      const t = item.record?.$type || ''
      const href = t === 'computer.sillyz.data.video'
        ? `/app/was-video?src=${encodeURIComponent(src)}`
        : t === 'computer.sillyz.data.image'
          ? `/app/was-image?src=${encodeURIComponent(src)}`
          : src
      updateCard(id, { href, text: item.record?.name || '' })
    }
  })
  wasSave()
}

// ── launch iframe: open / close / popstate ───────────────────────────────────

function openLaunch(href) {
  const { mode } = $.learn()
  $.teach({ launchHref: href, preLaunchMode: mode, menuOpen: false })
}

let _closingLaunch = false

function closeLaunch() {
  const { preLaunchMode } = $.learn()
  const hadEntry = history.state?.type === 'bulletin-board-launch' && history.state?.href
  $.teach({ launchHref: null, mode: preLaunchMode || 'pan', menuOpen: true, preLaunchMode: null })
  if (hadEntry) { _closingLaunch = true; history.back() }
  else history.replaceState({ type: 'bulletin-board-launch', href: null }, '', location.href)
}

window.addEventListener('popstate', e => {
  if (_closingLaunch) { _closingLaunch = false; return }
  const { type, href } = e.state || {}
  if (type === 'bulletin-board-launch') {
    if (href) {
      openLaunch(href)
    } else {
      const { preLaunchMode } = $.learn()
      $.teach({ launchHref: null, mode: preLaunchMode || 'pan', menuOpen: true, preLaunchMode: null })
    }
  }
})

// ── gamepad OS button (button 16) + select (button 8) ────────────────────────

const _toggleCache = {}
function toggleSpam(code, value, callback) {
  if (!_toggleCache[code] && value === 1) callback()
  _toggleCache[code] = value
}

function toggleWorldMode() {
  const { mode } = $.learn()
  $.teach({ mode: mode === 'os' ? 'pan' : 'os', menuOpen: false, linkSource: null })
}

function osLoop() {
  const os = checkButton(0, 16)
  toggleSpam('os', os, toggleWorldMode)
  const sel = checkButton(0, 8)
  toggleSpam('select', sel, toggleWorldMode)
  requestAnimationFrame(osLoop)
}

requestAnimationFrame(osLoop)

window.addEventListener('bb:world-toggle', toggleWorldMode)

// ── styles ────────────────────────────────────────────────────────────────────

$.style(`
  & {
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    display: block;
    background: lemonchiffon;
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

  &[data-mode="pan"] .card,
  &[data-mode="pan"] .card * {
    pointer-events: none;
  }
  &[data-mode="pan"] .card .card-play {
    pointer-events: all;
  }
  &[data-belt="true"] .card-launch {
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

  /* grab bar — full card width, height counter-scales to stay visually constant */
  & .card-title-bar {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: calc(1.5rem / var(--zoom, 1));
    display: none;
    align-items: flex-start;
    justify-content: flex-end;
    border-radius: 2px 2px 0 0;
    background: rgba(0,0,0,.05);
    cursor: grab;
    touch-action: none;
    user-select: none;
    z-index: 2;
  }
  &[data-mode="manage"] .card-title-bar,
  & .card[data-focused="true"] .card-title-bar { display: flex; }
  & .card-title-bar:active { cursor: grabbing; }


  & .card-pencil,
  & .card-close {
    background: none;
    border: none;
    color: var(--card-contrast, #1a1a1a);
    opacity: .35;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: .15rem .3rem;
    transition: opacity .1s;
    flex-shrink: 0;
    z-index: 3;
    position: relative;
    display: flex;
    align-items: center;
  }

  & .card-title-grab {
    flex: 1;
    min-width: min(calc(1.5rem / var(--zoom, 1)), 33%);
    cursor: grab;
  }
  & .card-pencil {
    transform: scale(calc(1 / var(--zoom, 1)));
    transform-origin: top left;
  }
  & .card-close {
    transform: scale(calc(1 / var(--zoom, 1)));
    transform-origin: top right;
  }
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

  &[data-mode="manage"] .card-body,
  & .card[data-focused="true"] .card-body {
    top: calc(1.5rem / var(--zoom, 1));
  }
  & .card[data-focused="true"] .card-body {
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

  &[data-mode="manage"] .card:hover .card-resize-se,
  &[data-mode="manage"] .card[data-focused="true"] .card-resize-se { opacity: 1; }
  & .card-resize-se:hover { border-color: dodgerblue; }

  /* ── compass ── */

  & .zoom-widget {
    position: absolute;
    bottom: .5rem; right: .5rem;
    z-index: 200;
    display: inline-flex; align-items: center;
    background: white; border-radius: 4px;
    box-shadow: 0 1px 6px rgba(0,0,0,.15); overflow: hidden;
  }
  & .zoom-widget button {
    background: transparent; border: none; color: dodgerblue;
    font-family: 'Recursive'; font-size: .75rem;
    padding: .5rem; cursor: pointer; line-height: 1; font-size: 1rem; min-width: 2rem; text-align: center;
    transition: background 80ms, color 80ms;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  & .zoom-widget button:hover { background: dodgerblue; color: white; }
  & .zoom-widget [data-zoom-lbl] { min-width: 3.2em; text-align: center; }
  &:not([data-mode="pan"]):not([data-mode="manage"]) .zoom-widget { display: none; }

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
  & .the-compass .c-share  { grid-row: 5/7; grid-column: 4/6; background: gold; color: #333; }
  & .the-compass .c-move   { grid-row: 5/7; grid-column: 2/4; background: mediumseagreen; }
  & .the-compass .c-os     { grid-row: 3/5; grid-column: 1/3; background: dodgerblue; }
  & .the-compass .c-camera { grid-row: 1/3; grid-column: 2/4; background: mediumpurple; }
  & .io-picker {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    min-width: 260px;
    display: flex;
    flex-direction: column;
    gap: .75rem;
    box-shadow: 0 4px 24px rgba(0,0,0,.2);
  }
  & .io-picker-title {
    font-family: 'Recursive', sans-serif;
    font-weight: 700;
    font-size: .95rem;
    margin-bottom: .25rem;
  }
  & .io-btn {
    font-family: 'Recursive', sans-serif;
    font-size: .85rem;
    padding: .5rem .75rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    text-align: left;
  }
  & .io-btn:hover { background: #f5f5f5; }
  & .io-btn-primary { border-color: dodgerblue; color: dodgerblue; }
  & .io-btn-primary:hover { background: dodgerblue; color: white; }
  & .io-label {
    font-family: 'Recursive', sans-serif;
    font-size: .8rem;
    display: flex;
    flex-direction: column;
    gap: .25rem;
  }
  & .io-input {
    font-family: 'Recursive', sans-serif;
    font-size: .8rem;
    padding: .3rem .5rem;
    border: 1px solid #ccc;
    border-radius: 3px;
  }
  & .io-status {
    font-family: 'Recursive', sans-serif;
    font-size: .75rem;
    opacity: .7;
    min-height: 1.2em;
    word-break: break-all;
  }
  & .io-tabs {
    display: flex;
    gap: .25rem;
    border-bottom: 1px solid #e0e0e0;
    margin-bottom: .25rem;
  }
  & .io-tab {
    font-family: 'Recursive', sans-serif;
    font-size: .8rem;
    padding: .3rem .65rem;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    cursor: pointer;
    color: rgba(0,0,0,.5);
    border-radius: 3px 3px 0 0;
  }
  & .io-tab:hover { color: rgba(0,0,0,.8); }
  & .io-tab.io-tab-active { color: dodgerblue; border-bottom-color: dodgerblue; font-weight: 600; }

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

  & .saga-preview {
    padding: .5rem;
    min-height: 2rem;
  }
  & .saga-preview-text {
    font-family: 'Recursive', sans-serif;
    font-size: .8rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    color: #1a1a1a;
    line-height: 1.6;
  }
  & .saga-preview-loading,
  & .saga-preview-empty {
    font-size: .75rem;
    color: rgba(0,0,0,.3);
    font-style: italic;
  }
  & .open-accessibility-link {
    display: block;
    padding: .4rem .75rem .6rem;
    font-size: .75rem;
    color: dodgerblue;
    text-decoration: none;
  }
  & .open-accessibility-link:hover { text-decoration: underline; }

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

  & .sidebar-editor-zone {
    background: #000;
    padding: .5rem;
    flex-shrink: 0;
  }
  & .sidebar-editor {
    display: block;
    width: 100%;
    max-width: 320px;
    aspect-ratio: 1;
    margin: 0 auto;
    padding: .5rem;
    box-sizing: border-box;
    border: none;
    border-radius: 2px;
    font-family: 'Recursive', sans-serif;
    font-size: .8rem;
    line-height: 1.5;
    resize: none;
    outline: none;
  }
  & .sidebar-editor:focus {
    box-shadow: 0 0 0 2px dodgerblue;
  }

  & .sidebar-section {
    border-bottom: 1px solid rgba(0,0,0,.07);
  }

  & .section-toggle {
    display: flex;
    align-items: center;
    gap: .35rem;
    width: 100%;
    background: var(--sidebar-card-color, lemonchiffon);
    border: none;
    cursor: pointer;
    padding: .45rem .75rem;
    font-family: 'Recursive', sans-serif;
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--sidebar-card-contrast, #1a1a1a) 50%, transparent);
    text-align: left;
    transition: color .1s, background .1s;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  & .section-toggle:hover {
    filter: brightness(.94);
    color: color-mix(in srgb, var(--sidebar-card-contrast, #1a1a1a) 80%, transparent);
  }

  & .section-chevron { font-size: .75rem; flex-shrink: 0; }

  & .section-body {
    padding: .5rem .75rem .75rem;
    overflow: hidden;
  }
  & .section-body.section-collapsed { display: none; }

  & .attach-section {
    display: flex;
    flex-direction: column;
    gap: .5rem;
  }

  & .attach-manage-btn {
    display: flex;
    align-items: center;
    gap: .35rem;
    background: none;
    border: 1.5px solid rgba(0,0,0,.15);
    border-radius: 4px;
    padding: .35rem .6rem;
    cursor: pointer;
    font-family: 'Recursive', sans-serif;
    font-size: .72rem;
    color: rgba(0,0,0,.55);
    width: 100%;
    transition: border-color .15s, color .15s;
  }
  & .attach-manage-btn:hover { border-color: var(--sidebar-card-color, dodgerblue); color: rgba(0,0,0,.85); }
  & .attach-manage-btn sl-icon { font-size: 1rem; pointer-events: none; }

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

  & .attach-text-preview {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: .4rem;
    font-size: .6rem;
    line-height: 1.3;
    color: rgba(255,255,255,.8);
    background: rgba(0,0,0,.8);
    overflow: hidden;
    word-break: break-word;
    text-align: center;
    box-sizing: border-box;
    pointer-events: none;
  }

  & .attach-media-label {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    color: rgba(0,0,0,.35);
    pointer-events: none;
  }


  & .logs-section-body {
    padding: 0;
  }

  & .op-log {
    display: flex;
    flex-direction: column;
    gap: 0;
    font-size: .72rem;
    max-height: 320px;
    overflow-y: auto;
  }

  & .op-empty {
    padding: 8px 10px;
    color: rgba(0,0,0,.4);
    font-style: italic;
    margin: 0;
  }

  & .op-derived {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    padding: 6px 10px;
    background: #fffde7;
    border-bottom: 1px solid rgba(0,0,0,.08);
    font-size: .68rem;
  }
  & .op-derived-label { font-weight: 600; color: #b45309; }
  & .op-derived-field { background: #fef3c7; padding: 1px 4px; border-radius: 3px; }

  & .op-row {
    display: grid;
    grid-template-columns: 18px auto 1fr auto;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    border-bottom: 1px solid rgba(0,0,0,.06);
    cursor: pointer;
    user-select: none;
  }
  & .op-row:hover { background: rgba(0,0,0,.03); }
  & .op-row.op-rejected { opacity: .45; text-decoration: line-through; }

  & .op-check { cursor: pointer; margin: 0; }

  & .op-badge {
    font-size: .6rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 4px;
    border-radius: 3px;
    white-space: nowrap;
    color: #fff;
  }
  & .op-type-create  { background: #16a34a; }
  & .op-type-update  { background: #2563eb; }
  & .op-type-delete  { background: #dc2626; }
  & .op-type-link    { background: #9333ea; }

  & .op-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(0,0,0,.75);
  }

  & .op-ts {
    color: rgba(0,0,0,.38);
    white-space: nowrap;
    font-size: .63rem;
  }

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

  &[data-os="true"] .workspace,
  &[data-os="true"] .card-sidebar,
  &[data-os="true"] .card-launch,
  &[data-os="true"] .camera-overlay {
    display: none !important;
  }

  & .os-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
  }
  & .share-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    background: #0d0d0d;
    color: white;
    overflow-y: auto;
    padding: 2rem;
    box-sizing: border-box;
    display: flex;
    place-content: center;
    align-items: center;
  }
  & .park-hud {
    position: fixed;
    bottom: 1.5rem; left: 1.5rem;
    z-index: 9999;
    min-width: 200px; max-width: 320px;
    pointer-events: auto;
  }
  & .park-hud-inner {
    padding: .75rem 1rem;
    box-shadow: 0 2px 12px rgba(0,0,0,.4);
    display: flex; flex-direction: column; gap: .75rem;
    font-family: monospace;
  }
  & .park-hud-hint {
    align-self: flex-end;
    font-size: .75rem;
    opacity: .6;
    font-family: monospace;
  }

  & .camera-overlay {
    position: absolute;
    inset: 0;
    z-index: 150;
    display: none;
  }
  & .camera-overlay[data-open="true"] { display: block; }

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

